import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { OfficialMarketOutcomeService } from "../market-data/official-market-outcome.service";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import { calculateCryptoTakerFee } from "../backtesting/short-term-exit-backtest.service";
import {
  executeBuyDepth,
  executeSellDepth
} from "./realistic-short-exit-execution.service";
import {
  ExecutableBookQuote,
  getExecutableBookQuote
} from "./short-term-exit-observation.service";

export const DAILY_EXIT_STRATEGY_VERSION = "DAILY_MULTI_CYCLE_NO_STOP_V1";
export const DAILY_FILTERED_STRATEGY_VERSION = "DAILY_TREND_FILTERED_V2";
export const DAILY_DOWN_ONLY_STRATEGY_VERSION = "DAILY_DOWN_ONLY_V3";
export const ACTIVE_DAILY_STRATEGY_VERSIONS = [
  DAILY_FILTERED_STRATEGY_VERSION,
  DAILY_DOWN_ONLY_STRATEGY_VERSION
] as const;
export const DAILY_EXIT_STAKE_USD = 3;
export const DAILY_EXIT_TAKE_PROFIT_ROI = 0.03;
export const DAILY_EXIT_ENTRY_PRICE_MIN = 0.15;
export const DAILY_EXIT_ENTRY_PRICE_MAX = 0.6;
export const DAILY_EXIT_MAX_SPREAD = 0.03;
export const DAILY_EXIT_NO_NEW_BUYS_SECONDS = 20 * 60;
const DAILY_EXIT_QUOTE_HEARTBEAT_MS = 30_000;
const DAILY_EXIT_REENTRY_COOLDOWN_MS = 60_000;
const MATERIAL_PRICE_CHANGE = 0.01;
const OFFICIAL_RESULT_DELAY_MS = 60_000;
const DAILY_FILTERED_ENTRY_PRICE_MIN = 0.3;
const DAILY_FILTERED_ENTRY_PRICE_MAX = 0.49;

interface DailyStrategyProfile {
  strategyVersion: string;
  filtered: boolean;
  allowedOutcomes: ReadonlySet<"UP" | "DOWN">;
}

const DAILY_STRATEGY_PROFILES: DailyStrategyProfile[] = [
  {
    strategyVersion: DAILY_FILTERED_STRATEGY_VERSION,
    filtered: true,
    allowedOutcomes: new Set(["UP", "DOWN"])
  },
  {
    strategyVersion: DAILY_DOWN_ONLY_STRATEGY_VERSION,
    filtered: true,
    allowedOutcomes: new Set(["DOWN"])
  }
];

export interface DailyExitMarketInput {
  marketId: string;
  assetSymbol: string;
  secondsToClose: number;
  upOrderBook: PolymarketOrderBook | null;
  downOrderBook: PolymarketOrderBook | null;
}

export interface DailyEntryCandidate {
  outcome: "UP" | "DOWN";
  tokenId: string;
  quote: ExecutableBookQuote;
}

export class DailyExitObservationService {
  constructor(
    private readonly logger: LoggerService,
    private readonly outcomeService = new OfficialMarketOutcomeService()
  ) {}

  async observeMarket(input: DailyExitMarketInput): Promise<void> {
    const books = {
      UP: input.upOrderBook,
      DOWN: input.downOrderBook
    };
    const quotes = {
      UP: getExecutableBookQuote(input.upOrderBook),
      DOWN: getExecutableBookQuote(input.downOrderBook)
    };
    const openCycles = await prisma.dailyExitCycle.findMany({
      where: {
        marketId: input.marketId,
        status: "OPEN"
      },
      orderBy: { openedAt: "desc" }
    });

    await Promise.all(
      (["UP", "DOWN"] as const).map((outcome) =>
        this.storeQuoteIfMaterial(
          input,
          outcome,
          quotes[outcome],
          openCycles[0]?.id ?? null
        )
      )
    );

    for (const legacyCycle of openCycles.filter(
      (cycle) => cycle.strategyVersion === DAILY_EXIT_STRATEGY_VERSION
    )) {
      await this.tryCloseCycle(
        legacyCycle,
        input.secondsToClose,
        books[legacyCycle.outcome as "UP" | "DOWN"]
      );
    }

    for (const profile of DAILY_STRATEGY_PROFILES) {
      await this.observeStrategy(input, books, quotes, profile);
    }
  }

  private async observeStrategy(
    input: DailyExitMarketInput,
    books: Record<"UP" | "DOWN", PolymarketOrderBook | null>,
    quotes: Record<"UP" | "DOWN", ExecutableBookQuote | null>,
    profile: DailyStrategyProfile
  ): Promise<void> {
    const openCycle = await prisma.dailyExitCycle.findFirst({
      where: {
        marketId: input.marketId,
        strategyVersion: profile.strategyVersion,
        status: "OPEN"
      },
      orderBy: { openedAt: "desc" }
    });
    if (openCycle) {
      await this.tryCloseCycle(
        openCycle,
        input.secondsToClose,
        books[openCycle.outcome as "UP" | "DOWN"]
      );
      return;
    }

    if (input.secondsToClose <= DAILY_EXIT_NO_NEW_BUYS_SECONDS) {
      return;
    }

    const lastClosed = await prisma.dailyExitCycle.findFirst({
      where: {
        marketId: input.marketId,
        strategyVersion: profile.strategyVersion,
        status: {
          in: ["CLOSED", "SETTLED"]
        }
      },
      orderBy: { closedAt: "desc" }
    });
    if (
      lastClosed?.closedAt &&
      Date.now() - lastClosed.closedAt.getTime() < DAILY_EXIT_REENTRY_COOLDOWN_MS
    ) {
      return;
    }

    const candidates = await Promise.all(
      (["UP", "DOWN"] as const).map(async (outcome) => {
        if (!profile.allowedOutcomes.has(outcome)) {
          return null;
        }

        const quote = quotes[outcome];
        const orderBook = books[outcome];
        if (!quote || !orderBook) {
          return null;
        }

        const recent = await prisma.dailyMarketQuote.findMany({
          where: {
            marketId: input.marketId,
            outcome
          },
          orderBy: { createdAt: "desc" },
          take: 3
        });

        const eligible = profile.filtered
          ? isDailyFilteredEntryEligible({
              quote,
              recentQuotes: recent.map((item) => ({
                bestBid: Number(item.bestBid),
                bestAsk: Number(item.bestAsk)
              })),
              orderBook
            })
          : isDailyEntryEligible({
              quote,
              recentQuotes: recent.map((item) => ({
                bestBid: Number(item.bestBid),
                bestAsk: Number(item.bestAsk)
              })),
              orderBook
            });

        return eligible
          ? {
              outcome,
              tokenId: orderBook.tokenId,
              quote
            }
          : null;
      })
    );
    const eligibleCandidates = candidates.filter(
      (candidate): candidate is DailyEntryCandidate => candidate !== null
    );
    const selected = profile.filtered
      ? selectDailyFilteredEntryCandidate(eligibleCandidates)
      : selectDailyEntryCandidate(eligibleCandidates);
    if (!selected) {
      return;
    }

    const orderBook = books[selected.outcome];
    if (!orderBook) {
      return;
    }

    const purchase = executeBuyDepth(orderBook.asks, DAILY_EXIT_STAKE_USD);
    if (!purchase.fullyFilled || purchase.shares <= 0) {
      return;
    }

    const latestCycle = await prisma.dailyExitCycle.findFirst({
      where: { marketId: input.marketId },
      orderBy: { cycleNumber: "desc" },
      select: { cycleNumber: true }
    });
    const cycle = await prisma.dailyExitCycle.create({
      data: {
        marketId: input.marketId,
        assetSymbol: input.assetSymbol,
        outcome: selected.outcome,
        tokenId: selected.tokenId,
        strategyVersion: profile.strategyVersion,
        cycleNumber: (latestCycle?.cycleNumber ?? 0) + 1,
        stake: decimal(DAILY_EXIT_STAKE_USD),
        entryPrice: decimal(purchase.averagePrice),
        entrySpread: decimal(selected.quote.spread),
        shares: decimal(purchase.shares),
        buyFee: decimal(purchase.fees),
        entryCost: decimal(purchase.netValue),
        entrySecondsToClose: input.secondsToClose
      }
    });

    this.logger.info("Daily multi-cycle observation bought.", {
      cycleId: cycle.id,
      marketId: input.marketId,
      strategyVersion: profile.strategyVersion,
      asset: input.assetSymbol,
      outcome: selected.outcome,
      cycleNumber: cycle.cycleNumber,
      entryPrice: purchase.averagePrice,
      entryCost: purchase.netValue,
      shares: purchase.shares,
      secondsToClose: input.secondsToClose
    });
  }

  async resolveExpiredCycles(): Promise<number> {
    const cycles = await prisma.dailyExitCycle.findMany({
      where: {
        status: "OPEN",
        market: {
          endDate: {
            lte: new Date(Date.now() - OFFICIAL_RESULT_DELAY_MS)
          }
        }
      },
      include: {
        market: {
          select: {
            slug: true
          }
        }
      },
      take: 50
    });
    let resolved = 0;

    for (const cycle of cycles) {
      if (!cycle.market.slug) {
        continue;
      }

      const winner = await this.outcomeService.resolve(
        cycle.marketId,
        cycle.market.slug
      );
      if (!winner) {
        continue;
      }

      const finalValue = cycle.outcome === winner.outcome ? Number(cycle.shares) : 0;
      const profit = finalValue - Number(cycle.entryCost);
      await prisma.dailyExitCycle.update({
        where: { id: cycle.id },
        data: {
          status: "SETTLED",
          finalValue: decimal(finalValue),
          profit: decimal(profit),
          roi: decimal(profit / Number(cycle.entryCost)),
          exitReason: "OFFICIAL_SETTLEMENT",
          officialWinner: winner.outcome,
          resolutionSource: winner.source,
          closedAt: new Date()
        }
      });
      resolved += 1;
    }

    return resolved;
  }

  private async tryCloseCycle(
    cycle: {
      id: string;
      entryCost: Prisma.Decimal;
      shares: Prisma.Decimal;
      outcome: string;
    },
    secondsToClose: number,
    orderBook: PolymarketOrderBook | null
  ): Promise<void> {
    if (!orderBook) {
      return;
    }

    const sale = executeSellDepth(orderBook.bids, Number(cycle.shares));
    if (!sale.fullyFilled || sale.shares <= 0) {
      return;
    }

    const profit = sale.netValue - Number(cycle.entryCost);
    const roi = profit / Number(cycle.entryCost);
    const inFinalWindow = secondsToClose <= DAILY_EXIT_NO_NEW_BUYS_SECONDS;
    if (!shouldExitDailyCycle(roi, secondsToClose)) {
      return;
    }

    const exitReason = inFinalWindow
      ? "FINAL_20_MINUTE_LIQUIDATION"
      : "TAKE_PROFIT_DEPTH";
    await prisma.dailyExitCycle.update({
      where: { id: cycle.id },
      data: {
        status: "CLOSED",
        exitPrice: decimal(sale.averagePrice),
        sellFee: decimal(sale.fees),
        finalValue: decimal(sale.netValue),
        profit: decimal(profit),
        roi: decimal(roi),
        exitReason,
        closedAt: new Date()
      }
    });

    this.logger.info("Daily multi-cycle observation sold.", {
      cycleId: cycle.id,
      outcome: cycle.outcome,
      exitPrice: sale.averagePrice,
      finalValue: sale.netValue,
      profit,
      roi,
      exitReason,
      secondsToClose
    });
  }

  private async storeQuoteIfMaterial(
    input: DailyExitMarketInput,
    outcome: "UP" | "DOWN",
    quote: ExecutableBookQuote | null,
    cycleId: string | null
  ): Promise<void> {
    if (!quote) {
      return;
    }

    const latest = await prisma.dailyMarketQuote.findFirst({
      where: {
        marketId: input.marketId,
        outcome
      },
      orderBy: { createdAt: "desc" }
    });
    const material =
      !latest ||
      Date.now() - latest.createdAt.getTime() >= DAILY_EXIT_QUOTE_HEARTBEAT_MS ||
      Math.abs(Number(latest.bestBid) - quote.bestBid) >= MATERIAL_PRICE_CHANGE ||
      Math.abs(Number(latest.bestAsk) - quote.bestAsk) >= MATERIAL_PRICE_CHANGE;
    if (!material) {
      return;
    }

    await prisma.dailyMarketQuote.create({
      data: {
        marketId: input.marketId,
        cycleId,
        assetSymbol: input.assetSymbol,
        outcome,
        bestBid: decimal(quote.bestBid),
        bidSize: decimal(quote.bidSize),
        bestAsk: decimal(quote.bestAsk),
        askSize: decimal(quote.askSize),
        spread: decimal(quote.spread),
        secondsToClose: input.secondsToClose,
        executable: quote.bidSize > 0 && quote.askSize > 0
      }
    });
  }
}

export function isDailyEntryEligible(input: {
  quote: ExecutableBookQuote;
  recentQuotes: Array<{ bestBid: number; bestAsk: number }>;
  orderBook: PolymarketOrderBook;
}): boolean {
  const { quote, recentQuotes, orderBook } = input;
  if (
    quote.bestAsk < DAILY_EXIT_ENTRY_PRICE_MIN ||
    quote.bestAsk > DAILY_EXIT_ENTRY_PRICE_MAX ||
    quote.spread < 0 ||
    quote.spread > DAILY_EXIT_MAX_SPREAD
  ) {
    return false;
  }

  const purchase = executeBuyDepth(orderBook.asks, DAILY_EXIT_STAKE_USD);
  if (!purchase.fullyFilled || purchase.shares <= 0 || recentQuotes.length < 2) {
    return false;
  }

  const prior = recentQuotes.slice(1);
  const priorMinAsk = Math.min(...prior.map((item) => item.bestAsk));
  const priorMaxBid = Math.max(...prior.map((item) => item.bestBid));
  const favorableDrop = quote.bestAsk <= priorMinAsk - MATERIAL_PRICE_CHANGE;
  const risingBid = quote.bestBid >= priorMaxBid + MATERIAL_PRICE_CHANGE;
  const stableLowEntry =
    quote.bestAsk <= 0.5 &&
    quote.bestAsk <= priorMinAsk &&
    quote.bestBid >= priorMaxBid;

  return favorableDrop || risingBid || stableLowEntry;
}

export function selectDailyEntryCandidate(
  candidates: DailyEntryCandidate[]
): DailyEntryCandidate | null {
  return [...candidates].sort((left, right) => {
    if (left.quote.bestAsk !== right.quote.bestAsk) {
      return left.quote.bestAsk - right.quote.bestAsk;
    }

    return left.quote.spread - right.quote.spread;
  })[0] ?? null;
}

export function isDailyFilteredEntryEligible(input: {
  quote: ExecutableBookQuote;
  recentQuotes: Array<{ bestBid: number; bestAsk: number }>;
  orderBook: PolymarketOrderBook;
}): boolean {
  const { quote, recentQuotes, orderBook } = input;
  if (
    quote.bestAsk < DAILY_FILTERED_ENTRY_PRICE_MIN ||
    quote.bestAsk > DAILY_FILTERED_ENTRY_PRICE_MAX ||
    quote.spread < 0 ||
    quote.spread > DAILY_EXIT_MAX_SPREAD ||
    recentQuotes.length < 3
  ) {
    return false;
  }

  const purchase = executeBuyDepth(orderBook.asks, DAILY_EXIT_STAKE_USD);
  if (!purchase.fullyFilled || purchase.shares <= 0) {
    return false;
  }

  const current = recentQuotes[0];
  const previous = recentQuotes[1];
  const oldest = recentQuotes[2];
  return (
    current.bestBid >= previous.bestBid + MATERIAL_PRICE_CHANGE &&
    previous.bestBid >= oldest.bestBid + MATERIAL_PRICE_CHANGE
  );
}

export function selectDailyFilteredEntryCandidate(
  candidates: DailyEntryCandidate[]
): DailyEntryCandidate | null {
  return [...candidates].sort((left, right) => {
    if (right.quote.bestBid !== left.quote.bestBid) {
      return right.quote.bestBid - left.quote.bestBid;
    }

    return left.quote.spread - right.quote.spread;
  })[0] ?? null;
}

export function calculateDailyExit(
  entryCost: number,
  shares: number,
  exitPrice: number
): { finalValue: number; profit: number; roi: number; sellFee: number } {
  const sellFee = calculateCryptoTakerFee(shares, exitPrice);
  const finalValue = shares * exitPrice - sellFee;
  const profit = finalValue - entryCost;

  return {
    finalValue,
    profit,
    roi: profit / entryCost,
    sellFee
  };
}

export function shouldExitDailyCycle(
  roi: number,
  secondsToClose: number
): boolean {
  return (
    roi >= DAILY_EXIT_TAKE_PROFIT_ROI ||
    secondsToClose <= DAILY_EXIT_NO_NEW_BUYS_SECONDS
  );
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
