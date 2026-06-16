import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { config } from "../../config/env";
import { LoggerService } from "../logger/logger.service";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import { calculateCryptoTakerFee } from "../backtesting/short-term-exit-backtest.service";
import { EntryRiskModelService } from "../learning/entry-risk-model.service";
import { RealisticShortExitExecutionService } from "./realistic-short-exit-execution.service";
import { LiveShortExitTradingService } from "../trading/live-short-exit-trading.service";

const STAKE_USD = 1;
const TAKER_FEE_RATE = 0.07;
const FIVE_MINUTE_STRATEGY_VERSION = "EARLY_WINDOW_FILTERED_5M_V3";
const FIFTEEN_MINUTE_STRATEGY_VERSION = "EARLY_WINDOW_MULTI_BAND_15M_V2";
export const FILTERED_FIVE_MINUTE_STRATEGY_VERSION =
  "EARLY_WINDOW_XRP_SOL_5M_V1";
export const STRICT_FIFTEEN_MINUTE_STRATEGY_VERSION =
  "EARLY_WINDOW_STRICT_BTC_ETH_15M_V2";
export const ALL_ASSETS_FIFTEEN_MINUTE_STRATEGY_VERSION =
  "EARLY_WINDOW_STRICT_ALL_CRYPTO_15M_V1";
export const ORDER_FLOW_STRATEGY_VERSION = "ORDER_FLOW_CONFIRMATION_V1";
const ENTRY_PRICE_MIN = 0.2;
const ENTRY_PRICE_MAX = 0.7;
const MAX_SPREAD = 0.06;
const MIN_LIQUIDITY = 100;
const MIN_SECONDS_TO_CLOSE = 240;
const MAX_SECONDS_TO_CLOSE = 300;
const TAKE_PROFIT_ROI = 0.02;
const FORCE_EXIT_SECONDS_TO_CLOSE = 60;
export const EXIT_SCENARIO_THRESHOLDS = [180, 120, 90, 60] as const;
const ENTRY_SIGNAL_MIN_CHANGE = 0.01;
const TIGHT_SPREAD = 0.03;
const ENTRY_WINDOW_LAST_CHANCE_SECONDS = 245;
const FIFTEEN_MINUTE_ENTRY_PRICE_MIN = 0.15;
const FIFTEEN_MINUTE_ENTRY_PRICE_MAX = 0.75;
const FIFTEEN_MINUTE_MIN_SECONDS_TO_CLOSE = 720;
const FIFTEEN_MINUTE_MAX_SECONDS_TO_CLOSE = 900;
const FIFTEEN_MINUTE_LAST_CHANCE_SECONDS = 725;
const FIFTEEN_MINUTE_MAX_OPEN_OBSERVATIONS = 18;
const FIFTEEN_MINUTE_MAX_OPEN_STAKE_USD = 18;
const ORDER_FLOW_MIN_SAMPLES = 3;
const ORDER_FLOW_MIN_OBSERVATION_SECONDS = 10;
const ORDER_FLOW_MAX_SPREAD = 0.04;
const ORDER_FLOW_MIN_DEPTH_IMBALANCE = 0.05;
const ORDER_FLOW_MIN_BID_CHANGE = 0.01;
const ORDER_FLOW_EXIT_MIN_HOLD_SECONDS = 15;

export const FIFTEEN_MINUTE_ENTRY_BANDS = [
  { name: "CHEAP", min: 0.15, max: 0.34 },
  { name: "MID", min: 0.35, max: 0.54 },
  { name: "STRONG", min: 0.55, max: 0.75 }
] as const;
export type FifteenMinuteEntryBand =
  (typeof FIFTEEN_MINUTE_ENTRY_BANDS)[number]["name"];

export interface LiveShortTermExitMarketInput {
  marketId: string;
  assetSymbol: string;
  timeframe: "5m" | "15m";
  liquidity: number | null;
  secondsToClose: number | null;
  upOrderBook: PolymarketOrderBook | null;
  downOrderBook: PolymarketOrderBook | null;
}

export interface ExecutableBookQuote {
  bestBid: number;
  bidSize: number;
  bestAsk: number;
  askSize: number;
  bidDepth5?: number;
  askDepth5?: number;
  depthImbalance?: number;
  microPrice?: number;
  spread: number;
  observedAt?: Date;
}

export interface ShortTermEntryCandidate {
  outcome: "UP" | "DOWN";
  quote: ExecutableBookQuote;
  previousQuotes: ExecutableBookQuote[];
}

export interface ShortTermEntrySelection {
  outcome: "UP" | "DOWN";
  quote: ExecutableBookQuote;
  trigger: "FAVORABLE_DROP_WITH_BID_SUPPORT" | "RISING_BID_TIGHT_SPREAD" |
    "WINDOW_END_EXECUTABLE" | "ORDER_FLOW_CONFIRMATION";
  entryBand?: FifteenMinuteEntryBand | "STRICT" | "ORDER_FLOW";
}

export interface OrderFlowExitRisk {
  shouldExit: boolean;
  score: number;
  reasons: string[];
}

interface StoredOrderFlowQuote {
  bestBid: Prisma.Decimal;
  bidDepth5: Prisma.Decimal | null;
  depthImbalance: Prisma.Decimal | null;
  microPrice: Prisma.Decimal | null;
  spread: Prisma.Decimal;
  orderFlowRiskScore: number | null;
}

interface StoredExitQuote {
  bestBid: Prisma.Decimal;
  netExitValue: Prisma.Decimal;
  netProfit: Prisma.Decimal;
  netRoi: Prisma.Decimal;
  secondsToClose: number;
  createdAt: Date;
}

interface ObservationStrategyProfile {
  timeframe: "5m" | "15m";
  strategyVersion: string;
  entryPriceMin: number;
  entryPriceMax: number;
  maxSpread: number;
  minSecondsToClose: number;
  maxSecondsToClose: number;
  lastChanceSeconds: number;
  keepObservingAfterTakeProfit: boolean;
}

export interface ExitScenarioEvaluation {
  thresholdSeconds: number;
  status: "RESOLVED" | "PENDING";
  exitReason: "TAKE_PROFIT_BEFORE_THRESHOLD" | "FORCED_AT_THRESHOLD" |
    "CONSERVATIVE_NO_EXIT" | null;
  exitBid: number | null;
  finalValue: number | null;
  profit: number | null;
  roi: number | null;
  evaluatedAt: Date | null;
}

export class ShortTermExitObservationService {
  private readonly realisticExecutionService: RealisticShortExitExecutionService;
  private readonly entryRiskModelService: EntryRiskModelService;

  constructor(
    private readonly logger: LoggerService,
    private readonly liveTradingService?: LiveShortExitTradingService
  ) {
    this.realisticExecutionService = new RealisticShortExitExecutionService(logger);
    this.entryRiskModelService = new EntryRiskModelService(logger);
  }

  async observeMarket(input: LiveShortTermExitMarketInput): Promise<void> {
    if (
      input.liquidity === null ||
      input.secondsToClose === null ||
      input.secondsToClose < 0
    ) {
      return;
    }

    const quotes = {
      UP: getExecutableBookQuote(input.upOrderBook),
      DOWN: getExecutableBookQuote(input.downOrderBook)
    };
    const profile = getObservationStrategyProfile(input.timeframe);
    let existing = await prisma.shortTermExitObservation.findMany({
      where: { marketId: input.marketId },
      orderBy: { createdAt: "asc" }
    });

    if (
      input.secondsToClose >= profile.minSecondsToClose &&
      input.secondsToClose <= profile.maxSecondsToClose
    ) {
      await this.observeEntryWindow(input, quotes);
      existing = await prisma.shortTermExitObservation.findMany({
        where: { marketId: input.marketId },
        orderBy: { createdAt: "asc" }
      });
    }

    for (const observation of existing) {
      const orderBook =
        observation.outcome === "UP" ? input.upOrderBook : input.downOrderBook;
      const entryQuote =
        observation.outcome === "UP" ? quotes.UP : quotes.DOWN;
      if (
        observation.strategyVersion === FIVE_MINUTE_STRATEGY_VERSION &&
        entryQuote &&
        input.secondsToClose >= profile.minSecondsToClose &&
        input.secondsToClose <= profile.maxSecondsToClose
      ) {
        await this.liveTradingService?.tryOpen({
          observationId: observation.id,
          marketId: input.marketId,
          assetSymbol: input.assetSymbol,
          outcome: observation.outcome as "UP" | "DOWN",
          timeframe: input.timeframe,
          strategyVersion: observation.strategyVersion,
          entryAsk: entryQuote.bestAsk,
          entrySpread: entryQuote.spread,
          entryTrigger: observation.entryTrigger ?? "",
          tokenId: orderBook?.tokenId ?? ""
        });
      }

      await this.liveTradingService?.tryExit({
        observationId: observation.id,
        secondsToClose: input.secondsToClose,
        orderBook
      });

      if (observation.status !== "OPEN") {
        continue;
      }

      const quote = observation.outcome === "UP" ? quotes.UP : quotes.DOWN;
      const orderFlowRisk = quote &&
        observation.strategyVersion === ORDER_FLOW_STRATEGY_VERSION
        ? evaluateOrderFlowExitRisk(
            {
              entryBid: Number(observation.entryBid),
              entrySpread: Number(observation.entrySpread),
              openedAt: observation.createdAt
            },
            (
              await prisma.shortTermExitQuote.findMany({
                where: { observationId: observation.id },
                orderBy: { createdAt: "desc" },
                take: 3,
                select: {
                  bestBid: true,
                  bidDepth5: true,
                  depthImbalance: true,
                  microPrice: true,
                  spread: true,
                  orderFlowRiskScore: true
                }
              })
            ).reverse(),
            quote
          )
        : null;

      await this.realisticExecutionService.observeExit({
        observationId: observation.id,
        secondsToClose: input.secondsToClose,
        orderBook,
        forceExitTrigger: orderFlowRisk?.shouldExit
          ? "ORDER_FLOW_RISK_EXIT"
          : undefined
      });

      if (quote) {
        await this.monitorOpenObservation(
          input,
          observation,
          quote,
          orderFlowRisk
        );
      }
    }
  }

  async closeExpiredObservations(): Promise<number> {
    const expired = await prisma.shortTermExitObservation.findMany({
      where: {
        status: "OPEN",
        market: {
          endDate: {
            lte: new Date()
          }
        }
      },
      select: {
        id: true,
        stake: true,
        shares: true
      },
      take: 100
    });

    for (const observation of expired) {
      const lastExecutableQuote = await prisma.shortTermExitQuote.findFirst({
        where: {
          observationId: observation.id,
          executable: true,
          secondsToClose: {
            lte: FORCE_EXIT_SECONDS_TO_CLOSE
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      if (!lastExecutableQuote) {
        await prisma.shortTermExitObservation.update({
          where: { id: observation.id },
          data: {
            status: "NO_EXIT",
            exitReason: "NO_EXECUTABLE_BID_BEFORE_CLOSE",
            exitedAt: new Date()
          }
        });
        await this.persistScenarioEvaluations(
          observation.id,
          Number(observation.stake),
          await prisma.shortTermExitQuote.findMany({
            where: { observationId: observation.id, executable: true },
            orderBy: { createdAt: "asc" }
          }),
          false
        );
        continue;
      }

      const exit = calculateExit(
        Number(observation.stake),
        Number(observation.shares),
        Number(lastExecutableQuote.bestBid)
      );

      await prisma.shortTermExitObservation.update({
        where: { id: observation.id },
        data: {
          status: "CLOSED",
          exitBid: lastExecutableQuote.bestBid,
          sellFee: new Prisma.Decimal(exit.sellFee),
          finalValue: new Prisma.Decimal(exit.finalValue),
          profit: new Prisma.Decimal(exit.profit),
          roi: new Prisma.Decimal(exit.roi),
          exitReason: "LAST_EXECUTABLE_BID_BEFORE_CLOSE",
          exitedAt: lastExecutableQuote.createdAt
        }
      });
      await this.persistScenarioEvaluations(
        observation.id,
        Number(observation.stake),
        await prisma.shortTermExitQuote.findMany({
          where: { observationId: observation.id, executable: true },
          orderBy: { createdAt: "asc" }
        }),
        false
      );
    }

    return expired.length;
  }

  async backfillExitScenarios(
    strategyVersion = FIVE_MINUTE_STRATEGY_VERSION
  ): Promise<number> {
    const observations = await prisma.shortTermExitObservation.findMany({
      where: { strategyVersion },
      include: {
        quotes: {
          where: { executable: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    for (const observation of observations) {
      await this.persistScenarioEvaluations(
        observation.id,
        Number(observation.stake),
        observation.quotes,
        observation.status === "OPEN"
      );
    }

    return observations.length;
  }

  private async observeEntryWindow(
    input: LiveShortTermExitMarketInput,
    quotes: Record<"UP" | "DOWN", ExecutableBookQuote | null>
  ): Promise<void> {
    const profile = getObservationStrategyProfile(input.timeframe);
    if (
      input.liquidity === null ||
      input.secondsToClose === null ||
      input.secondsToClose < profile.minSecondsToClose ||
      input.secondsToClose > profile.maxSecondsToClose
    ) {
      return;
    }

    const outcomes = (["UP", "DOWN"] as const).filter((outcome) => quotes[outcome] !== null);
    if (outcomes.length === 0) {
      return;
    }

    const previousByOutcome = await Promise.all(
      outcomes.map(async (outcome) => ({
        outcome,
        quotes: (
          await prisma.shortTermEntryQuote.findMany({
            where: {
              marketId: input.marketId,
              outcome
            },
            orderBy: { createdAt: "desc" },
            take: 20
          })
        ).reverse().map(toExecutableBookQuote)
      }))
    );

    await prisma.shortTermEntryQuote.createMany({
      data: outcomes.map((outcome) =>
        buildEntryQuoteData(
          input.marketId,
          input.assetSymbol,
          outcome,
          quotes[outcome]!,
          input.liquidity!,
          input.secondsToClose!
        )
      )
    });

    const candidates = outcomes.map((outcome) => ({
        outcome,
        quote: quotes[outcome]!,
        previousQuotes:
          previousByOutcome.find((candidate) => candidate.outcome === outcome)?.quotes ?? []
      }));

    const orderFlowExisting = await prisma.shortTermExitObservation.findFirst({
      where: {
        marketId: input.marketId,
        strategyVersion: ORDER_FLOW_STRATEGY_VERSION
      },
      select: { id: true }
    });
    const orderFlowSelection = orderFlowExisting
      ? null
      : selectOrderFlowEntry(
          candidates,
          input.liquidity,
          input.secondsToClose,
          input.timeframe
        );
    if (orderFlowSelection) {
      await this.openObservation(
        input,
        orderFlowSelection,
        orderFlowSelection.outcome === "UP"
          ? input.upOrderBook
          : input.downOrderBook,
        {
          strategyVersion: ORDER_FLOW_STRATEGY_VERSION,
          allowLiveTrading: false
        }
      );
    }

    if (input.timeframe === "15m") {
      const strictExisting = await prisma.shortTermExitObservation.findFirst({
        where: {
          marketId: input.marketId,
          strategyVersion: ALL_ASSETS_FIFTEEN_MINUTE_STRATEGY_VERSION
        },
        select: { id: true }
      });
      const strictSelection = strictExisting
        ? null
        : selectStrictFifteenMinuteEntry(
            input.assetSymbol,
            candidates,
            input.liquidity,
            input.secondsToClose
          );
      if (
        strictSelection &&
        (await this.hasFifteenMinuteObservationCapacity())
      ) {
        await this.openObservation(
          input,
          strictSelection,
          strictSelection.outcome === "UP"
            ? input.upOrderBook
            : input.downOrderBook,
          {
            strategyVersion: ALL_ASSETS_FIFTEEN_MINUTE_STRATEGY_VERSION,
            allowLiveTrading: false
          }
        );
      }
      return;
    }

    const existingFiveMinute = await prisma.shortTermExitObservation.findMany({
      where: {
        marketId: input.marketId,
        strategyVersion: {
          in: [
            FIVE_MINUTE_STRATEGY_VERSION,
            FILTERED_FIVE_MINUTE_STRATEGY_VERSION
          ]
        }
      },
      select: {
        strategyVersion: true
      }
    });
    const existingStrategies = new Set(
      existingFiveMinute.map((observation) => observation.strategyVersion)
    );

    if (!existingStrategies.has(FIVE_MINUTE_STRATEGY_VERSION)) {
      const selection = selectShortTermEntry(
        candidates,
        input.liquidity,
        input.secondsToClose,
        input.timeframe
      );

      if (
        selection &&
        matchesObservationEntryFilter(
          input.assetSymbol,
          input.timeframe,
          selection
        )
      ) {
        await this.openObservation(
          input,
          selection,
          selection.outcome === "UP" ? input.upOrderBook : input.downOrderBook
        );
      }
    }

    if (!existingStrategies.has(FILTERED_FIVE_MINUTE_STRATEGY_VERSION)) {
      const filteredSelection = selectFilteredFiveMinuteEntry(
        input.assetSymbol,
        candidates,
        input.liquidity,
        input.secondsToClose
      );
      if (filteredSelection) {
        await this.openObservation(
          input,
          filteredSelection,
          filteredSelection.outcome === "UP"
            ? input.upOrderBook
            : input.downOrderBook,
          {
            strategyVersion: FILTERED_FIVE_MINUTE_STRATEGY_VERSION,
            allowLiveTrading: false
          }
        );
      }
    }
  }

  private async openObservation(
    input: LiveShortTermExitMarketInput,
    selection: ShortTermEntrySelection,
    orderBook: PolymarketOrderBook | null,
    options?: {
      strategyVersion?: string;
      allowLiveTrading?: boolean;
    }
  ): Promise<void> {
    const { outcome, quote, trigger } = selection;
    const profile = getObservationStrategyProfile(input.timeframe);
    const strategyVersion = options?.strategyVersion ?? profile.strategyVersion;
    const shares = sharesForCashBudget(STAKE_USD, quote.bestAsk);
    const buyFee = calculateCryptoTakerFee(shares, quote.bestAsk, TAKER_FEE_RATE);
    const exit = calculateExit(STAKE_USD, shares, quote.bestBid);
    const mlScore = config.mlShadowEnabled
      ? this.entryRiskModelService.score({
          assetSymbol: input.assetSymbol,
          timeframe: input.timeframe,
          outcome,
          entryBid: quote.bestBid,
          entryAsk: quote.bestAsk,
          spread: quote.spread,
          liquidity: input.liquidity!,
          secondsToClose: input.secondsToClose!,
          bidSize: quote.bidSize,
          askSize: quote.askSize,
          bidDepth5: quote.bidDepth5 ?? quote.bidSize,
          askDepth5: quote.askDepth5 ?? quote.askSize,
          depthImbalance: getDepthImbalance(quote),
          microPrice: getMicroPrice(quote)
        })
      : null;

    const observation = await prisma.shortTermExitObservation.create({
      data: {
        marketId: input.marketId,
        assetSymbol: input.assetSymbol,
        outcome,
        strategyVersion,
        entryBand: selection.entryBand ?? "DEFAULT",
        entryTrigger: trigger,
        stake: new Prisma.Decimal(STAKE_USD),
        entryAsk: new Prisma.Decimal(quote.bestAsk),
        entryBid: new Prisma.Decimal(quote.bestBid),
        entrySpread: new Prisma.Decimal(quote.spread),
        shares: new Prisma.Decimal(shares),
        buyFee: new Prisma.Decimal(buyFee),
        entrySecondsToClose: input.secondsToClose!,
        maxExecutableBid: new Prisma.Decimal(quote.bestBid),
        minExecutableBid: new Prisma.Decimal(quote.bestBid),
        maxNetRoi: new Prisma.Decimal(exit.roi),
        minNetRoi: new Prisma.Decimal(exit.roi),
        mlRiskLabel: mlScore?.label,
        mlRiskProbability: mlScore
          ? new Prisma.Decimal(mlScore.probability)
          : null,
        mlModelVersion: mlScore?.modelVersion,
        mlFeatures: mlScore ? JSON.stringify(mlScore.features) : null,
        mlScoredAt: mlScore ? new Date() : null,
        quotes: {
          create: buildQuoteData(quote, input.liquidity!, input.secondsToClose!, shares)
        },
        exitScenarios: {
          create: EXIT_SCENARIO_THRESHOLDS.map((thresholdSeconds) => ({
            thresholdSeconds
          }))
        }
      }
    });

    await this.realisticExecutionService.createForObservation({
      observationId: observation.id,
      marketId: input.marketId,
      assetSymbol: input.assetSymbol,
      outcome,
      budget: STAKE_USD,
      secondsToClose: input.secondsToClose!,
      orderBook
    });
    if (options?.allowLiveTrading !== false) {
      await this.liveTradingService?.tryOpen({
        observationId: observation.id,
        marketId: input.marketId,
        assetSymbol: input.assetSymbol,
        outcome,
        timeframe: input.timeframe,
        strategyVersion,
        entryAsk: quote.bestAsk,
        entrySpread: quote.spread,
        entryTrigger: trigger,
        tokenId: orderBook?.tokenId ?? ""
      });
    }

    this.logger.info("Short-term exit live observation opened.", {
      observationId: observation.id,
      marketId: input.marketId,
      strategyVersion,
      timeframe: input.timeframe,
      entryTrigger: trigger,
      entryBand: selection.entryBand ?? "DEFAULT",
      asset: input.assetSymbol,
      outcome,
      stakeUsd: STAKE_USD,
      entryAsk: quote.bestAsk,
      entryBid: quote.bestBid,
      spread: quote.spread,
      secondsToClose: input.secondsToClose,
      mlRiskLabel: mlScore?.label,
      mlRiskProbability: mlScore?.probability
    });
  }

  private async monitorOpenObservation(
    input: LiveShortTermExitMarketInput,
    existing: {
      id: string;
      marketId: string;
      outcome: string;
      stake: Prisma.Decimal;
      shares: Prisma.Decimal;
      createdAt: Date;
      maxExecutableBid: Prisma.Decimal;
      minExecutableBid: Prisma.Decimal;
      maxNetRoi: Prisma.Decimal;
      minNetRoi: Prisma.Decimal;
      firstTakeProfit2At: Date | null;
      firstTakeProfit3At: Date | null;
      firstTakeProfit5At: Date | null;
      firstTakeProfit10At: Date | null;
      firstStopLoss3At: Date | null;
      firstStopLoss5At: Date | null;
      firstStopLoss10At: Date | null;
      strategyVersion: string;
    },
    quote: ExecutableBookQuote,
    orderFlowRisk: OrderFlowExitRisk | null = null
  ): Promise<void> {
    const shares = Number(existing.shares);
    const exit = calculateExit(Number(existing.stake), shares, quote.bestBid);
    const executable = quote.bidSize >= shares;
    const now = new Date();
    const exitReason = executable
      ? orderFlowRisk?.shouldExit
        ? "ORDER_FLOW_RISK_EXIT"
        : shouldCloseObservationAtTakeProfit(existing.strategyVersion, input.timeframe)
          ? determineExitReason(exit.roi, input.secondsToClose!)
          : null
      : null;
    const shouldClose = exitReason !== null;
    const scenarioUpdates = executable && input.timeframe === "5m"
      ? buildLiveScenarioUpdates(
          existing.id,
          quote,
          exit,
          input.secondsToClose!,
          now
        )
      : [];

    await prisma.$transaction([
      prisma.shortTermExitQuote.create({
        data: {
          observationId: existing.id,
          ...buildQuoteData(
            quote,
            input.liquidity!,
            input.secondsToClose!,
            shares,
            orderFlowRisk
          )
        }
      }),
      prisma.shortTermExitObservation.update({
        where: { id: existing.id },
        data: {
          ...(executable
            ? {
                maxExecutableBid: new Prisma.Decimal(
                  Math.max(Number(existing.maxExecutableBid), quote.bestBid)
                ),
                minExecutableBid: new Prisma.Decimal(
                  Math.min(Number(existing.minExecutableBid), quote.bestBid)
                ),
                maxNetRoi: new Prisma.Decimal(Math.max(Number(existing.maxNetRoi), exit.roi)),
                minNetRoi: new Prisma.Decimal(Math.min(Number(existing.minNetRoi), exit.roi)),
                ...missingThresholdTimestamps(existing, exit.roi, now)
              }
            : {}),
          ...(shouldClose
            ? {
                status: "CLOSED",
                exitBid: new Prisma.Decimal(quote.bestBid),
                sellFee: new Prisma.Decimal(exit.sellFee),
                finalValue: new Prisma.Decimal(exit.finalValue),
                profit: new Prisma.Decimal(exit.profit),
                roi: new Prisma.Decimal(exit.roi),
                exitReason,
                exitedAt: now
              }
            : {})
        }
      }),
      ...scenarioUpdates
    ]);

    if (shouldClose) {
      this.logger.info("Short-term exit live observation closed.", {
        observationId: existing.id,
        marketId: input.marketId,
        strategyVersion: existing.strategyVersion,
        asset: input.assetSymbol,
        outcome: existing.outcome,
        exitBid: quote.bestBid,
        profit: exit.profit,
        roi: exit.roi,
        reason: exitReason
      });
    }
  }

  private async persistScenarioEvaluations(
    observationId: string,
    stake: number,
    quotes: StoredExitQuote[],
    isOpen: boolean
  ): Promise<void> {
    const evaluations = evaluateExitScenarios(quotes, stake, isOpen);

    await prisma.$transaction(
      evaluations.map((evaluation) =>
        prisma.shortTermExitScenario.upsert({
          where: {
            observationId_thresholdSeconds: {
              observationId,
              thresholdSeconds: evaluation.thresholdSeconds
            }
          },
          create: {
            observationId,
            ...toScenarioData(evaluation)
          },
          update: toScenarioData(evaluation)
        })
      )
    );
  }

  private async hasFifteenMinuteObservationCapacity(): Promise<boolean> {
    const open = await prisma.shortTermExitObservation.findMany({
      where: {
        status: "OPEN",
        market: {
          timeframe: "15m"
        }
      },
      select: {
        stake: true
      }
    });
    const totalStake = open.reduce(
      (sum, observation) => sum + Number(observation.stake),
      0
    );

    return open.length < FIFTEEN_MINUTE_MAX_OPEN_OBSERVATIONS &&
      totalStake + STAKE_USD <= FIFTEEN_MINUTE_MAX_OPEN_STAKE_USD;
  }
}

export function evaluateExitScenarios(
  quotes: StoredExitQuote[],
  stake: number,
  isOpen: boolean
): ExitScenarioEvaluation[] {
  return EXIT_SCENARIO_THRESHOLDS.map((thresholdSeconds) => {
    const takeProfit = quotes.find(
      (quote) =>
        quote.secondsToClose > thresholdSeconds &&
        Number(quote.netRoi) >= TAKE_PROFIT_ROI
    );
    const forcedExit = quotes.find((quote) => quote.secondsToClose <= thresholdSeconds);
    const selected = takeProfit ?? forcedExit;

    if (selected) {
      return {
        thresholdSeconds,
        status: "RESOLVED",
        exitReason: takeProfit ? "TAKE_PROFIT_BEFORE_THRESHOLD" : "FORCED_AT_THRESHOLD",
        exitBid: Number(selected.bestBid),
        finalValue: Number(selected.netExitValue),
        profit: Number(selected.netProfit),
        roi: Number(selected.netRoi),
        evaluatedAt: selected.createdAt
      };
    }

    if (isOpen) {
      return pendingScenario(thresholdSeconds);
    }

    return {
      thresholdSeconds,
      status: "RESOLVED",
      exitReason: "CONSERVATIVE_NO_EXIT",
      exitBid: null,
      finalValue: 0,
      profit: -stake,
      roi: -1,
      evaluatedAt: quotes.at(-1)?.createdAt ?? new Date()
    };
  });
}

function buildLiveScenarioUpdates(
  observationId: string,
  quote: ExecutableBookQuote,
  exit: ReturnType<typeof calculateExit>,
  secondsToClose: number,
  evaluatedAt: Date
) {
  const data = {
    status: "RESOLVED",
    exitBid: new Prisma.Decimal(quote.bestBid),
    finalValue: new Prisma.Decimal(exit.finalValue),
    profit: new Prisma.Decimal(exit.profit),
    roi: new Prisma.Decimal(exit.roi),
    evaluatedAt
  };

  if (exit.roi >= TAKE_PROFIT_ROI) {
    return [
      prisma.shortTermExitScenario.updateMany({
        where: { observationId, status: "PENDING" },
        data: {
          ...data,
          exitReason: "TAKE_PROFIT_BEFORE_THRESHOLD"
        }
      })
    ];
  }

  return [
    prisma.shortTermExitScenario.updateMany({
      where: {
        observationId,
        status: "PENDING",
        thresholdSeconds: { gte: secondsToClose }
      },
      data: {
        ...data,
        exitReason: "FORCED_AT_THRESHOLD"
      }
    })
  ];
}

function pendingScenario(thresholdSeconds: number): ExitScenarioEvaluation {
  return {
    thresholdSeconds,
    status: "PENDING",
    exitReason: null,
    exitBid: null,
    finalValue: null,
    profit: null,
    roi: null,
    evaluatedAt: null
  };
}

function toScenarioData(evaluation: ExitScenarioEvaluation) {
  return {
    thresholdSeconds: evaluation.thresholdSeconds,
    status: evaluation.status,
    exitReason: evaluation.exitReason,
    exitBid: evaluation.exitBid === null ? null : new Prisma.Decimal(evaluation.exitBid),
    finalValue: evaluation.finalValue === null ? null : new Prisma.Decimal(evaluation.finalValue),
    profit: evaluation.profit === null ? null : new Prisma.Decimal(evaluation.profit),
    roi: evaluation.roi === null ? null : new Prisma.Decimal(evaluation.roi),
    evaluatedAt: evaluation.evaluatedAt
  };
}

export function getExecutableBookQuote(
  orderBook: PolymarketOrderBook | null
): ExecutableBookQuote | null {
  if (!orderBook || orderBook.bids.length === 0 || orderBook.asks.length === 0) {
    return null;
  }

  const bids = orderBook.bids
    .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size));
  const asks = orderBook.asks
    .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size));
  if (bids.length === 0 || asks.length === 0) {
    return null;
  }

  const bestBid = bids.reduce((best, level) => (level.price > best.price ? level : best));
  const bestAsk = asks.reduce((best, level) => (level.price < best.price ? level : best));
  const topBids = [...bids].sort((left, right) => right.price - left.price).slice(0, 5);
  const topAsks = [...asks].sort((left, right) => left.price - right.price).slice(0, 5);
  const bidDepth5 = topBids.reduce((sum, level) => sum + level.size, 0);
  const askDepth5 = topAsks.reduce((sum, level) => sum + level.size, 0);
  const totalDepth = bidDepth5 + askDepth5;
  const topSize = bestBid.size + bestAsk.size;

  return {
    bestBid: bestBid.price,
    bidSize: bestBid.size,
    bestAsk: bestAsk.price,
    askSize: bestAsk.size,
    bidDepth5,
    askDepth5,
    depthImbalance: totalDepth <= 0 ? 0 : (bidDepth5 - askDepth5) / totalDepth,
    microPrice: topSize <= 0
      ? (bestBid.price + bestAsk.price) / 2
      : (bestAsk.price * bestBid.size + bestBid.price * bestAsk.size) / topSize,
    spread: bestAsk.price - bestBid.price
  };
}

export function selectOrderFlowEntry(
  candidates: ShortTermEntryCandidate[],
  liquidity: number,
  secondsToClose: number,
  timeframe: "5m" | "15m"
): ShortTermEntrySelection | null {
  const eligible = candidates.flatMap((candidate) => {
    const history = candidate.previousQuotes.slice(-6);
    if (
      history.length < ORDER_FLOW_MIN_SAMPLES ||
      !isEligibleShortTermExitEntry(
        candidate.quote,
        liquidity,
        secondsToClose,
        timeframe
      ) ||
      candidate.quote.spread > ORDER_FLOW_MAX_SPREAD
    ) {
      return [];
    }

    const first = history[0];
    const last = history.at(-1)!;
    const elapsedSeconds =
      first.observedAt && last.observedAt
        ? (last.observedAt.getTime() - first.observedAt.getTime()) / 1_000
        : history.length * 5;
    if (elapsedSeconds < ORDER_FLOW_MIN_OBSERVATION_SECONDS) {
      return [];
    }

    const series = [...history, candidate.quote];
    const bidSteps = series.slice(1).map(
      (quote, index) => quote.bestBid - series[index].bestBid
    );
    const positiveBidSteps = bidSteps.filter((change) => change > 0).length;
    const negativeBidSteps = bidSteps.filter((change) => change < 0).length;
    const bidChange = candidate.quote.bestBid - first.bestBid;
    const currentImbalance = getDepthImbalance(candidate.quote);
    const firstImbalance = getDepthImbalance(first);
    const imbalanceChange = currentImbalance - firstImbalance;
    const midpoint = (candidate.quote.bestBid + candidate.quote.bestAsk) / 2;
    const microPricePremium = getMicroPrice(candidate.quote) - midpoint;
    const flowConfirmed =
      currentImbalance >= ORDER_FLOW_MIN_DEPTH_IMBALANCE &&
      imbalanceChange >= 0 &&
      microPricePremium > 0;
    const persistentBid =
      positiveBidSteps >= 2 &&
      positiveBidSteps > negativeBidSteps &&
      bidChange >= ORDER_FLOW_MIN_BID_CHANGE;

    if (!flowConfirmed || !persistentBid) {
      return [];
    }

    return [{
      outcome: candidate.outcome,
      quote: candidate.quote,
      trigger: "ORDER_FLOW_CONFIRMATION" as const,
      entryBand: "ORDER_FLOW" as const,
      score:
        bidChange * 4 +
        currentImbalance * 0.5 +
        imbalanceChange * 0.5 +
        microPricePremium * 3 -
        candidate.quote.spread * 2
    }];
  }).sort((left, right) => right.score - left.score);

  const selected = eligible[0];
  return selected
    ? {
        outcome: selected.outcome,
        quote: selected.quote,
        trigger: selected.trigger,
        entryBand: selected.entryBand
      }
    : null;
}

export function isEligibleShortTermExitEntry(
  quote: ExecutableBookQuote,
  liquidity: number,
  secondsToClose: number,
  timeframe: "5m" | "15m" = "5m"
): boolean {
  const profile = getObservationStrategyProfile(timeframe);
  const shares = sharesForCashBudget(STAKE_USD, quote.bestAsk);
  return (
    quote.bestAsk >= profile.entryPriceMin &&
    quote.bestAsk <= profile.entryPriceMax &&
    quote.spread >= 0 &&
    quote.spread <= profile.maxSpread &&
    quote.askSize >= shares &&
    liquidity >= MIN_LIQUIDITY &&
    secondsToClose >= profile.minSecondsToClose &&
    secondsToClose <= profile.maxSecondsToClose
  );
}

export function selectShortTermEntry(
  candidates: ShortTermEntryCandidate[],
  liquidity: number,
  secondsToClose: number,
  timeframe: "5m" | "15m" = "5m"
): ShortTermEntrySelection | null {
  const profile = getObservationStrategyProfile(timeframe);
  const eligible: Array<ShortTermEntrySelection & { score: number }> = [];

  for (const candidate of candidates) {
    if (
      !isEligibleShortTermExitEntry(
        candidate.quote,
        liquidity,
        secondsToClose,
        timeframe
      ) ||
      candidate.previousQuotes.length === 0
    ) {
      continue;
    }

    const first = candidate.previousQuotes[0];
    const previous = candidate.previousQuotes.at(-1)!;
    const lowestAsk = Math.min(...candidate.previousQuotes.map((quote) => quote.bestAsk));
    const askDrop = first.bestAsk - candidate.quote.bestAsk;
    const bidChange = candidate.quote.bestBid - previous.bestBid;
    const atObservedLow = candidate.quote.bestAsk <= lowestAsk;

    if (
      atObservedLow &&
      askDrop >= ENTRY_SIGNAL_MIN_CHANGE &&
      bidChange >= 0
    ) {
      eligible.push({
        outcome: candidate.outcome,
        quote: candidate.quote,
        trigger: "FAVORABLE_DROP_WITH_BID_SUPPORT" as const,
        score: askDrop * 3 + bidChange * 2 - candidate.quote.spread
      });
      continue;
    }

    if (
      candidate.quote.spread <= TIGHT_SPREAD &&
      bidChange >= ENTRY_SIGNAL_MIN_CHANGE
    ) {
      eligible.push({
        outcome: candidate.outcome,
        quote: candidate.quote,
        trigger: "RISING_BID_TIGHT_SPREAD" as const,
        score: bidChange * 3 - candidate.quote.spread
      });
      continue;
    }

    if (secondsToClose <= profile.lastChanceSeconds) {
      eligible.push({
        outcome: candidate.outcome,
        quote: candidate.quote,
        trigger: "WINDOW_END_EXECUTABLE" as const,
        score: -candidate.quote.spread + bidChange
      });
    }
  }

  eligible.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.quote.bestAsk - right.quote.bestAsk;
  });

  const selected = eligible[0];
  return selected
    ? {
        outcome: selected.outcome,
        quote: selected.quote,
        trigger: selected.trigger
      }
    : null;
}

export function selectFifteenMinuteBandEntries(
  candidates: ShortTermEntryCandidate[],
  liquidity: number,
  secondsToClose: number
): ShortTermEntrySelection[] {
  const selections: ShortTermEntrySelection[] = [];

  for (const band of FIFTEEN_MINUTE_ENTRY_BANDS) {
    const eligible: Array<ShortTermEntrySelection & { score: number }> = [];

    for (const candidate of candidates) {
      if (
        candidate.quote.bestAsk < band.min ||
        candidate.quote.bestAsk > band.max ||
        !isEligibleShortTermExitEntry(
          candidate.quote,
          liquidity,
          secondsToClose,
          "15m"
        ) ||
        candidate.previousQuotes.length === 0
      ) {
        continue;
      }

      const first = candidate.previousQuotes[0];
      const previous = candidate.previousQuotes.at(-1)!;
      const lowestAsk = Math.min(
        ...candidate.previousQuotes.map((quote) => quote.bestAsk)
      );
      const askDrop = first.bestAsk - candidate.quote.bestAsk;
      const bidChange = candidate.quote.bestBid - previous.bestBid;
      const atObservedLow = candidate.quote.bestAsk <= lowestAsk;

      if (
        atObservedLow &&
        askDrop >= ENTRY_SIGNAL_MIN_CHANGE &&
        bidChange >= 0
      ) {
        eligible.push({
          outcome: candidate.outcome,
          quote: candidate.quote,
          trigger: "FAVORABLE_DROP_WITH_BID_SUPPORT",
          entryBand: band.name,
          score: askDrop * 3 + bidChange * 2 - candidate.quote.spread
        });
        continue;
      }

      if (
        candidate.quote.spread <= TIGHT_SPREAD &&
        bidChange >= ENTRY_SIGNAL_MIN_CHANGE
      ) {
        eligible.push({
          outcome: candidate.outcome,
          quote: candidate.quote,
          trigger: "RISING_BID_TIGHT_SPREAD",
          entryBand: band.name,
          score: bidChange * 3 - candidate.quote.spread
        });
        continue;
      }

      if (secondsToClose <= FIFTEEN_MINUTE_LAST_CHANCE_SECONDS) {
        eligible.push({
          outcome: candidate.outcome,
          quote: candidate.quote,
          trigger: "WINDOW_END_EXECUTABLE",
          entryBand: band.name,
          score: -candidate.quote.spread + bidChange
        });
      }
    }

    eligible.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.quote.bestAsk - right.quote.bestAsk;
    });

    const selected = eligible[0];
    if (selected) {
      selections.push({
        outcome: selected.outcome,
        quote: selected.quote,
        trigger: selected.trigger,
        entryBand: selected.entryBand
      });
    }
  }

  return selections;
}

export function selectFilteredFiveMinuteEntry(
  assetSymbol: string,
  candidates: ShortTermEntryCandidate[],
  liquidity: number,
  secondsToClose: number
): ShortTermEntrySelection | null {
  if (
    !["XRP", "SOL"].includes(assetSymbol) ||
    secondsToClose < 280 ||
    secondsToClose > 300
  ) {
    return null;
  }

  const eligible = candidates
    .filter((candidate) => {
      const priceAllowed = assetSymbol === "XRP"
        ? candidate.quote.bestAsk >= 0.52 && candidate.quote.bestAsk <= 0.58
        : candidate.quote.bestAsk >= 0.65 && candidate.quote.bestAsk <= 0.70;
      if (
        !priceAllowed ||
        candidate.quote.spread > 0.02 ||
        candidate.previousQuotes.length < 2 ||
        !isEligibleShortTermExitEntry(
          candidate.quote,
          liquidity,
          secondsToClose,
          "5m"
        )
      ) {
        return false;
      }

      const previous = candidate.previousQuotes.at(-1)!;
      const beforePrevious = candidate.previousQuotes.at(-2)!;
      return (
        candidate.quote.bestBid - previous.bestBid >= ENTRY_SIGNAL_MIN_CHANGE &&
        previous.bestBid - beforePrevious.bestBid >= ENTRY_SIGNAL_MIN_CHANGE
      );
    })
    .map((candidate) => ({
      outcome: candidate.outcome,
      quote: candidate.quote,
      trigger: "RISING_BID_TIGHT_SPREAD" as const,
      score:
        candidate.quote.bestBid -
        candidate.previousQuotes.at(-2)!.bestBid -
        candidate.quote.spread
    }))
    .sort((left, right) => right.score - left.score);

  const selected = eligible[0];
  return selected
    ? {
        outcome: selected.outcome,
        quote: selected.quote,
        trigger: selected.trigger
      }
    : null;
}

export function selectStrictFifteenMinuteEntry(
  assetSymbol: string,
  candidates: ShortTermEntryCandidate[],
  liquidity: number,
  secondsToClose: number
): ShortTermEntrySelection | null {
  if (
    !["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"].includes(assetSymbol) ||
    secondsToClose < 840 ||
    secondsToClose > 900
  ) {
    return null;
  }

  const eligible = candidates
    .filter((candidate) => {
      if (
        candidate.quote.bestAsk < 0.5 ||
        candidate.quote.bestAsk > 0.7 ||
        candidate.quote.spread > 0.02 ||
        candidate.previousQuotes.length === 0 ||
        !isEligibleShortTermExitEntry(
          candidate.quote,
          liquidity,
          secondsToClose,
          "15m"
        )
      ) {
        return false;
      }

      const previous = candidate.previousQuotes.at(-1)!;
      return candidate.quote.bestBid - previous.bestBid >= ENTRY_SIGNAL_MIN_CHANGE;
    })
    .map((candidate) => ({
      outcome: candidate.outcome,
      quote: candidate.quote,
      trigger: "RISING_BID_TIGHT_SPREAD" as const,
      entryBand: "STRICT" as const,
      score:
        candidate.quote.bestBid -
        candidate.previousQuotes.at(-1)!.bestBid -
        candidate.quote.spread
    }))
    .sort((left, right) => right.score - left.score);

  const selected = eligible[0];
  return selected
    ? {
        outcome: selected.outcome,
        quote: selected.quote,
        trigger: selected.trigger,
        entryBand: selected.entryBand
      }
    : null;
}

export function matchesObservationEntryFilter(
  assetSymbol: string,
  timeframe: "5m" | "15m",
  selection: ShortTermEntrySelection
): boolean {
  if (timeframe === "15m") {
    return selection.quote.bestAsk >= FIFTEEN_MINUTE_ENTRY_PRICE_MIN &&
      selection.quote.bestAsk <= FIFTEEN_MINUTE_ENTRY_PRICE_MAX &&
      selection.quote.spread <= MAX_SPREAD;
  }

  switch (assetSymbol) {
    case "BTC":
      return selection.quote.bestAsk >= 0.55 &&
        selection.quote.bestAsk <= 0.60 &&
        selection.quote.spread <= 0.015 &&
        selection.trigger === "RISING_BID_TIGHT_SPREAD";
    case "ETH":
      return selection.outcome === "UP" &&
        selection.quote.bestAsk >= 0.50 &&
        selection.quote.bestAsk <= 0.60 &&
        selection.quote.spread <= 0.015 &&
        selection.trigger === "RISING_BID_TIGHT_SPREAD";
    case "SOL":
      return selection.quote.bestAsk >= 0.65 &&
        selection.quote.bestAsk <= 0.70 &&
        selection.quote.spread <= 0.03;
    case "XRP":
      return selection.quote.bestAsk >= 0.52 &&
        selection.quote.bestAsk <= 0.58 &&
        selection.quote.spread <= 0.03;
    case "DOGE":
    case "BNB":
      return selection.quote.bestAsk >= ENTRY_PRICE_MIN &&
        selection.quote.bestAsk <= ENTRY_PRICE_MAX &&
        selection.quote.spread <= MAX_SPREAD;
    default:
      return false;
  }
}

export function getObservationStrategyProfile(
  timeframe: "5m" | "15m"
): ObservationStrategyProfile {
  if (timeframe === "15m") {
    return {
      timeframe,
      strategyVersion: FIFTEEN_MINUTE_STRATEGY_VERSION,
      entryPriceMin: FIFTEEN_MINUTE_ENTRY_PRICE_MIN,
      entryPriceMax: FIFTEEN_MINUTE_ENTRY_PRICE_MAX,
      maxSpread: MAX_SPREAD,
      minSecondsToClose: FIFTEEN_MINUTE_MIN_SECONDS_TO_CLOSE,
      maxSecondsToClose: FIFTEEN_MINUTE_MAX_SECONDS_TO_CLOSE,
      lastChanceSeconds: FIFTEEN_MINUTE_LAST_CHANCE_SECONDS,
      keepObservingAfterTakeProfit: true
    };
  }

  return {
    timeframe,
    strategyVersion: FIVE_MINUTE_STRATEGY_VERSION,
    entryPriceMin: ENTRY_PRICE_MIN,
    entryPriceMax: ENTRY_PRICE_MAX,
    maxSpread: MAX_SPREAD,
    minSecondsToClose: MIN_SECONDS_TO_CLOSE,
    maxSecondsToClose: MAX_SECONDS_TO_CLOSE,
    lastChanceSeconds: ENTRY_WINDOW_LAST_CHANCE_SECONDS,
    keepObservingAfterTakeProfit: false
  };
}

export function determineExitReason(
  roi: number,
  secondsToClose: number
): "TAKE_PROFIT" | "LAST_MINUTE_EXIT" | null {
  if (roi >= TAKE_PROFIT_ROI) {
    return "TAKE_PROFIT";
  }
  if (secondsToClose <= FORCE_EXIT_SECONDS_TO_CLOSE) {
    return "LAST_MINUTE_EXIT";
  }
  return null;
}

export function shouldCloseObservationAtTakeProfit(
  strategyVersion: string,
  timeframe: "5m" | "15m"
): boolean {
  return timeframe === "5m" ||
    strategyVersion === ORDER_FLOW_STRATEGY_VERSION ||
    strategyVersion === STRICT_FIFTEEN_MINUTE_STRATEGY_VERSION ||
    strategyVersion === ALL_ASSETS_FIFTEEN_MINUTE_STRATEGY_VERSION;
}

function sharesForCashBudget(stake: number, price: number): number {
  const feePerShare = TAKER_FEE_RATE * price * (1 - price);
  return stake / (price + feePerShare);
}

function calculateExit(stake: number, shares: number, bid: number) {
  const sellFee = calculateCryptoTakerFee(shares, bid, TAKER_FEE_RATE);
  const finalValue = shares * bid - sellFee;
  const profit = finalValue - stake;
  return {
    sellFee,
    finalValue,
    profit,
    roi: profit / stake
  };
}

function buildQuoteData(
  quote: ExecutableBookQuote,
  liquidity: number,
  secondsToClose: number,
  shares: number,
  orderFlowRisk: OrderFlowExitRisk | null = null
) {
  const exit = calculateExit(STAKE_USD, shares, quote.bestBid);
  return {
    bestBid: new Prisma.Decimal(quote.bestBid),
    bidSize: new Prisma.Decimal(quote.bidSize),
    bestAsk: new Prisma.Decimal(quote.bestAsk),
    askSize: new Prisma.Decimal(quote.askSize),
    bidDepth5: new Prisma.Decimal(quote.bidDepth5 ?? quote.bidSize),
    askDepth5: new Prisma.Decimal(quote.askDepth5 ?? quote.askSize),
    depthImbalance: new Prisma.Decimal(getDepthImbalance(quote)),
    microPrice: new Prisma.Decimal(getMicroPrice(quote)),
    spread: new Prisma.Decimal(quote.spread),
    liquidity: new Prisma.Decimal(liquidity),
    secondsToClose,
    netExitValue: new Prisma.Decimal(exit.finalValue),
    netProfit: new Prisma.Decimal(exit.profit),
    netRoi: new Prisma.Decimal(exit.roi),
    orderFlowRiskScore: orderFlowRisk?.score,
    orderFlowRiskReasons: orderFlowRisk
      ? JSON.stringify(orderFlowRisk.reasons)
      : null,
    executable: quote.bidSize >= shares
  };
}

export function evaluateOrderFlowExitRisk(
  entry: {
    entryBid: number;
    entrySpread: number;
    openedAt: Date;
  },
  previousQuotes: StoredOrderFlowQuote[],
  current: ExecutableBookQuote,
  now = new Date()
): OrderFlowExitRisk {
  const reasons: string[] = [];
  const imbalance = getDepthImbalance(current);
  const midpoint = (current.bestBid + current.bestAsk) / 2;
  const microPriceDiscount = midpoint - getMicroPrice(current);
  const currentBidDepth = current.bidDepth5 ?? current.bidSize;
  const recent = previousQuotes.at(-1);
  const beforeRecent = previousQuotes.at(-2);
  const baselineDepth = Math.max(
    currentBidDepth,
    ...previousQuotes.map((quote) => Number(quote.bidDepth5 ?? 0))
  );

  if (imbalance <= -0.1) {
    reasons.push("ASK_DEPTH_DOMINANCE");
  }
  if (microPriceDiscount >= 0.003) {
    reasons.push("MICROPRICE_BELOW_MIDPOINT");
  }
  if (
    recent &&
    beforeRecent &&
    Number(beforeRecent.bestBid) > Number(recent.bestBid) &&
    Number(recent.bestBid) > current.bestBid
  ) {
    reasons.push("TWO_STEP_BID_DECLINE");
  }
  if (baselineDepth > 0 && currentBidDepth <= baselineDepth * 0.65) {
    reasons.push("BID_DEPTH_COLLAPSE");
  }
  if (current.spread >= Math.max(0.04, entry.entrySpread * 1.75)) {
    reasons.push("SPREAD_EXPANSION");
  }
  if (current.bestBid <= entry.entryBid - 0.05) {
    reasons.push("EXECUTABLE_BID_BREAKDOWN");
  }

  const score = reasons.length;
  const previousRiskScore = recent?.orderFlowRiskScore ?? 0;
  const heldSeconds = Math.max(0, (now.getTime() - entry.openedAt.getTime()) / 1_000);
  const persistentDeterioration = score >= 3 && previousRiskScore >= 2;

  return {
    shouldExit:
      heldSeconds >= ORDER_FLOW_EXIT_MIN_HOLD_SECONDS &&
      persistentDeterioration,
    score,
    reasons
  };
}

function buildEntryQuoteData(
  marketId: string,
  assetSymbol: string,
  outcome: "UP" | "DOWN",
  quote: ExecutableBookQuote,
  liquidity: number,
  secondsToClose: number
) {
  const shares = sharesForCashBudget(STAKE_USD, quote.bestAsk);
  return {
    marketId,
    assetSymbol,
    outcome,
    bestBid: new Prisma.Decimal(quote.bestBid),
    bidSize: new Prisma.Decimal(quote.bidSize),
    bestAsk: new Prisma.Decimal(quote.bestAsk),
    askSize: new Prisma.Decimal(quote.askSize),
    bidDepth5: new Prisma.Decimal(quote.bidDepth5 ?? quote.bidSize),
    askDepth5: new Prisma.Decimal(quote.askDepth5 ?? quote.askSize),
    depthImbalance: new Prisma.Decimal(getDepthImbalance(quote)),
    microPrice: new Prisma.Decimal(getMicroPrice(quote)),
    spread: new Prisma.Decimal(quote.spread),
    liquidity: new Prisma.Decimal(liquidity),
    secondsToClose,
    executable: quote.askSize >= shares
  };
}

function toExecutableBookQuote(quote: {
  bestBid: Prisma.Decimal;
  bidSize: Prisma.Decimal;
  bestAsk: Prisma.Decimal;
  askSize: Prisma.Decimal;
  bidDepth5?: Prisma.Decimal | null;
  askDepth5?: Prisma.Decimal | null;
  depthImbalance?: Prisma.Decimal | null;
  microPrice?: Prisma.Decimal | null;
  spread: Prisma.Decimal;
  createdAt?: Date;
}): ExecutableBookQuote {
  const bestBid = Number(quote.bestBid);
  const bidSize = Number(quote.bidSize);
  const bestAsk = Number(quote.bestAsk);
  const askSize = Number(quote.askSize);
  const topSize = bidSize + askSize;
  return {
    bestBid,
    bidSize,
    bestAsk,
    askSize,
    bidDepth5: Number(quote.bidDepth5 ?? quote.bidSize),
    askDepth5: Number(quote.askDepth5 ?? quote.askSize),
    depthImbalance: quote.depthImbalance === null ||
      quote.depthImbalance === undefined
      ? (topSize <= 0 ? 0 : (bidSize - askSize) / topSize)
      : Number(quote.depthImbalance),
    microPrice: quote.microPrice === null || quote.microPrice === undefined
      ? (topSize <= 0
          ? (bestBid + bestAsk) / 2
          : (bestAsk * bidSize + bestBid * askSize) / topSize)
      : Number(quote.microPrice),
    spread: Number(quote.spread),
    observedAt: quote.createdAt
  };
}

function getDepthImbalance(quote: ExecutableBookQuote): number {
  if (quote.depthImbalance !== undefined) {
    return quote.depthImbalance;
  }

  const totalDepth = quote.bidSize + quote.askSize;
  return totalDepth <= 0 ? 0 : (quote.bidSize - quote.askSize) / totalDepth;
}

function getMicroPrice(quote: ExecutableBookQuote): number {
  if (quote.microPrice !== undefined) {
    return quote.microPrice;
  }

  const topSize = quote.bidSize + quote.askSize;
  return topSize <= 0
    ? (quote.bestBid + quote.bestAsk) / 2
    : (
        quote.bestAsk * quote.bidSize +
        quote.bestBid * quote.askSize
      ) / topSize;
}

function missingThresholdTimestamps(
  existing: {
    firstTakeProfit2At: Date | null;
    firstTakeProfit3At: Date | null;
    firstTakeProfit5At: Date | null;
    firstTakeProfit10At: Date | null;
    firstStopLoss3At: Date | null;
    firstStopLoss5At: Date | null;
    firstStopLoss10At: Date | null;
  },
  roi: number,
  at: Date
) {
  return {
    firstTakeProfit2At: existing.firstTakeProfit2At ?? (roi >= 0.02 ? at : undefined),
    firstTakeProfit3At: existing.firstTakeProfit3At ?? (roi >= 0.03 ? at : undefined),
    firstTakeProfit5At: existing.firstTakeProfit5At ?? (roi >= 0.05 ? at : undefined),
    firstTakeProfit10At: existing.firstTakeProfit10At ?? (roi >= 0.1 ? at : undefined),
    firstStopLoss3At: existing.firstStopLoss3At ?? (roi <= -0.03 ? at : undefined),
    firstStopLoss5At: existing.firstStopLoss5At ?? (roi <= -0.05 ? at : undefined),
    firstStopLoss10At: existing.firstStopLoss10At ?? (roi <= -0.1 ? at : undefined)
  };
}
