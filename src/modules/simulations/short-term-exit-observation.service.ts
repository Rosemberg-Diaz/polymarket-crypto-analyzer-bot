import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import { calculateCryptoTakerFee } from "../backtesting/short-term-exit-backtest.service";

const STAKE_USD = 1;
const TAKER_FEE_RATE = 0.07;
const ENTRY_PRICE_MIN = 0.1;
const ENTRY_PRICE_MAX = 0.29;
const MAX_SPREAD = 0.06;
const MIN_LIQUIDITY = 100;
const MIN_SECONDS_TO_CLOSE = 60;
const MAX_SECONDS_TO_CLOSE = 120;
const TAKE_PROFIT_ROI = 0.02;
const STOP_LOSS_ROI = -0.1;
const MAX_HOLD_SECONDS = 60;
const FORCE_EXIT_SECONDS_TO_CLOSE = 20;

export interface LiveShortTermExitMarketInput {
  marketId: string;
  assetSymbol: string;
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
  spread: number;
}

export class ShortTermExitObservationService {
  constructor(private readonly logger: LoggerService) {}

  async observeMarket(input: LiveShortTermExitMarketInput): Promise<void> {
    if (
      input.liquidity === null ||
      input.secondsToClose === null ||
      input.secondsToClose < 0
    ) {
      return;
    }

    await this.observeOutcome(input, "UP", input.upOrderBook);
    await this.observeOutcome(input, "DOWN", input.downOrderBook);
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
          executable: true
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
    }

    return expired.length;
  }

  private async observeOutcome(
    input: LiveShortTermExitMarketInput,
    outcome: "UP" | "DOWN",
    orderBook: PolymarketOrderBook | null
  ): Promise<void> {
    const quote = getExecutableBookQuote(orderBook);
    if (!quote || input.liquidity === null || input.secondsToClose === null) {
      return;
    }

    const existing = await prisma.shortTermExitObservation.findUnique({
      where: {
        marketId_outcome: {
          marketId: input.marketId,
          outcome
        }
      }
    });

    if (!existing) {
      if (!isEligibleShortTermExitEntry(quote, input.liquidity, input.secondsToClose)) {
        return;
      }

      const shares = sharesForCashBudget(STAKE_USD, quote.bestAsk);
      const buyFee = calculateCryptoTakerFee(shares, quote.bestAsk, TAKER_FEE_RATE);
      const exit = calculateExit(STAKE_USD, shares, quote.bestBid);

      const observation = await prisma.shortTermExitObservation.create({
        data: {
          marketId: input.marketId,
          assetSymbol: input.assetSymbol,
          outcome,
          stake: new Prisma.Decimal(STAKE_USD),
          entryAsk: new Prisma.Decimal(quote.bestAsk),
          entryBid: new Prisma.Decimal(quote.bestBid),
          entrySpread: new Prisma.Decimal(quote.spread),
          shares: new Prisma.Decimal(shares),
          buyFee: new Prisma.Decimal(buyFee),
          entrySecondsToClose: input.secondsToClose,
          maxExecutableBid: new Prisma.Decimal(quote.bestBid),
          minExecutableBid: new Prisma.Decimal(quote.bestBid),
          maxNetRoi: new Prisma.Decimal(exit.roi),
          minNetRoi: new Prisma.Decimal(exit.roi),
          quotes: {
            create: buildQuoteData(quote, input.liquidity, input.secondsToClose, shares)
          }
        }
      });

      this.logger.info("Short-term exit live observation opened.", {
        observationId: observation.id,
        marketId: input.marketId,
        asset: input.assetSymbol,
        outcome,
        stakeUsd: STAKE_USD,
        entryAsk: quote.bestAsk,
        entryBid: quote.bestBid,
        spread: quote.spread,
        secondsToClose: input.secondsToClose
      });
      return;
    }

    if (existing.status !== "OPEN") {
      return;
    }

    const shares = Number(existing.shares);
    const exit = calculateExit(Number(existing.stake), shares, quote.bestBid);
    const executable = quote.bidSize >= shares;
    const now = new Date();
    const heldSeconds = Math.max(0, (now.getTime() - existing.createdAt.getTime()) / 1_000);
    const exitReason = executable
      ? determineExitReason(exit.roi, heldSeconds, input.secondsToClose)
      : null;
    const shouldClose = exitReason !== null;

    await prisma.$transaction([
      prisma.shortTermExitQuote.create({
        data: {
          observationId: existing.id,
          ...buildQuoteData(quote, input.liquidity, input.secondsToClose, shares)
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
      })
    ]);

    if (shouldClose) {
      this.logger.info("Short-term exit live observation closed.", {
        observationId: existing.id,
        marketId: input.marketId,
        asset: input.assetSymbol,
        outcome,
        exitBid: quote.bestBid,
        profit: exit.profit,
        roi: exit.roi,
        reason: exitReason
      });
    }
  }
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

  return {
    bestBid: bestBid.price,
    bidSize: bestBid.size,
    bestAsk: bestAsk.price,
    askSize: bestAsk.size,
    spread: bestAsk.price - bestBid.price
  };
}

export function isEligibleShortTermExitEntry(
  quote: ExecutableBookQuote,
  liquidity: number,
  secondsToClose: number
): boolean {
  const shares = sharesForCashBudget(STAKE_USD, quote.bestAsk);
  return (
    quote.bestAsk >= ENTRY_PRICE_MIN &&
    quote.bestAsk <= ENTRY_PRICE_MAX &&
    quote.spread >= 0 &&
    quote.spread <= MAX_SPREAD &&
    quote.askSize >= shares &&
    liquidity >= MIN_LIQUIDITY &&
    secondsToClose >= MIN_SECONDS_TO_CLOSE &&
    secondsToClose <= MAX_SECONDS_TO_CLOSE
  );
}

export function determineExitReason(
  roi: number,
  heldSeconds: number,
  secondsToClose: number
): "TAKE_PROFIT" | "STOP_LOSS" | "TIMEOUT" | "MARKET_CLOSE" | null {
  if (roi >= TAKE_PROFIT_ROI) {
    return "TAKE_PROFIT";
  }
  if (roi <= STOP_LOSS_ROI) {
    return "STOP_LOSS";
  }
  if (heldSeconds >= MAX_HOLD_SECONDS) {
    return "TIMEOUT";
  }
  if (secondsToClose <= FORCE_EXIT_SECONDS_TO_CLOSE) {
    return "MARKET_CLOSE";
  }
  return null;
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
  shares: number
) {
  const exit = calculateExit(STAKE_USD, shares, quote.bestBid);
  return {
    bestBid: new Prisma.Decimal(quote.bestBid),
    bidSize: new Prisma.Decimal(quote.bidSize),
    bestAsk: new Prisma.Decimal(quote.bestAsk),
    askSize: new Prisma.Decimal(quote.askSize),
    spread: new Prisma.Decimal(quote.spread),
    liquidity: new Prisma.Decimal(liquidity),
    secondsToClose,
    netExitValue: new Prisma.Decimal(exit.finalValue),
    netProfit: new Prisma.Decimal(exit.profit),
    netRoi: new Prisma.Decimal(exit.roi),
    executable: quote.bidSize >= shares
  };
}

function missingThresholdTimestamps(
  existing: {
    firstTakeProfit2At: Date | null;
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
    firstTakeProfit5At: existing.firstTakeProfit5At ?? (roi >= 0.05 ? at : undefined),
    firstTakeProfit10At: existing.firstTakeProfit10At ?? (roi >= 0.1 ? at : undefined),
    firstStopLoss3At: existing.firstStopLoss3At ?? (roi <= -0.03 ? at : undefined),
    firstStopLoss5At: existing.firstStopLoss5At ?? (roi <= -0.05 ? at : undefined),
    firstStopLoss10At: existing.firstStopLoss10At ?? (roi <= -0.1 ? at : undefined)
  };
}
