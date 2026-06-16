import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import {
  PolymarketOrderBook,
  PolymarketOrderBookLevel
} from "../polymarket/polymarket.types";
import { calculateCryptoTakerFee } from "../backtesting/short-term-exit-backtest.service";

const TAKER_FEE_RATE = 0.07;
const TAKE_PROFIT_ROI = 0.02;
const START_LIQUIDATION_SECONDS = 60;
const STOP_LIQUIDATION_SECONDS = 20;
const EPSILON = 0.000001;

export interface ExecutionFill {
  price: number;
  shares: number;
  grossValue: number;
  fee: number;
  netValue: number;
}

export interface DepthExecution {
  fills: ExecutionFill[];
  shares: number;
  grossValue: number;
  fees: number;
  netValue: number;
  averagePrice: number;
  fullyFilled: boolean;
}

export class RealisticShortExitExecutionService {
  constructor(private readonly logger: LoggerService) {}

  async createForObservation(input: {
    observationId: string;
    marketId: string;
    assetSymbol: string;
    outcome: string;
    budget: number;
    secondsToClose: number;
    orderBook: PolymarketOrderBook | null;
  }): Promise<void> {
    if (!input.orderBook) {
      this.logger.warn("Realistic execution entry skipped because orderbook is unavailable.", {
        observationId: input.observationId,
        marketId: input.marketId,
        outcome: input.outcome
      });
      return;
    }

    const purchase = executeBuyDepth(input.orderBook.asks, input.budget);
    if (purchase.shares <= EPSILON || purchase.netValue <= 0) {
      this.logger.warn("Realistic execution entry skipped because asks were not executable.", {
        observationId: input.observationId,
        marketId: input.marketId,
        outcome: input.outcome
      });
      return;
    }

    const fingerprint = fingerprintBook(input.orderBook, "BUY");
    await prisma.realisticShortExitExecution.create({
      data: {
        observationId: input.observationId,
        marketId: input.marketId,
        assetSymbol: input.assetSymbol,
        outcome: input.outcome,
        tokenId: input.orderBook.tokenId,
        budget: decimal(input.budget),
        entryCost: decimal(purchase.netValue),
        sharesBought: decimal(purchase.shares),
        averageEntryPrice: decimal(purchase.averagePrice),
        buyFees: decimal(purchase.fees),
        remainingShares: decimal(purchase.shares),
        lastObservedAt: new Date(),
        fills: {
          create: purchase.fills.map((fill) => fillData("BUY", fill, input.secondsToClose))
        },
        bookUses: {
          create: {
            side: "BUY",
            fingerprint,
            secondsToClose: input.secondsToClose
          }
        }
      }
    });
  }

  async observeExit(input: {
    observationId: string;
    secondsToClose: number;
    orderBook: PolymarketOrderBook | null;
    forceExitTrigger?: "ORDER_FLOW_RISK_EXIT";
  }): Promise<void> {
    const execution = await prisma.realisticShortExitExecution.findUnique({
      where: { observationId: input.observationId }
    });
    if (!execution || ["RESOLVED", "HOLD_TO_RESOLUTION"].includes(execution.status)) {
      return;
    }

    if (!input.orderBook) {
      await prisma.realisticShortExitExecution.update({
        where: { id: execution.id },
        data: {
          dataGapCount: { increment: 1 },
          lastObservedAt: new Date(),
          ...(input.secondsToClose <= STOP_LIQUIDATION_SECONDS
            ? {
                status: "HOLD_TO_RESOLUTION",
                exitTrigger: execution.exitTrigger ?? "API_DATA_GAP"
              }
            : {})
        }
      });
      return;
    }

    if (input.secondsToClose <= STOP_LIQUIDATION_SECONDS) {
      await prisma.realisticShortExitExecution.update({
        where: { id: execution.id },
        data: {
          status: "HOLD_TO_RESOLUTION",
          exitTrigger: execution.exitTrigger ?? "MARKET_CLOSE_REMAINDER",
          lastObservedAt: new Date()
        }
      });
      return;
    }

    const remainingShares = Number(execution.remainingShares);
    if (remainingShares <= EPSILON) {
      return;
    }

    const preview = executeSellDepth(input.orderBook.bids, remainingShares);
    const currentNetProceeds =
      Number(execution.sellGrossProceeds) - Number(execution.sellFees);
    const projectedProfit =
      currentNetProceeds + preview.netValue - Number(execution.entryCost);
    const projectedRoi = projectedProfit / Number(execution.entryCost);
    const takeProfitAvailable =
      preview.fullyFilled && projectedRoi >= TAKE_PROFIT_ROI;
    const shouldLiquidate =
      execution.status === "LIQUIDATING" ||
      input.forceExitTrigger !== undefined ||
      takeProfitAvailable ||
      input.secondsToClose <= START_LIQUIDATION_SECONDS;

    if (!shouldLiquidate || preview.shares <= EPSILON) {
      await prisma.realisticShortExitExecution.update({
        where: { id: execution.id },
        data: { lastObservedAt: new Date() }
      });
      return;
    }

    const fingerprint = fingerprintBook(input.orderBook, "SELL");
    const alreadyUsed = await prisma.realisticShortExitBookUse.findUnique({
      where: {
        executionId_side_fingerprint: {
          executionId: execution.id,
          side: "SELL",
          fingerprint
        }
      }
    });
    if (alreadyUsed) {
      return;
    }

    const newSharesSold = Number(execution.sharesSold) + preview.shares;
    const newGrossProceeds = Number(execution.sellGrossProceeds) + preview.grossValue;
    const newSellFees = Number(execution.sellFees) + preview.fees;
    const newRemainingShares = Math.max(0, Number(execution.sharesBought) - newSharesSold);
    const fullyLiquidated = newRemainingShares <= EPSILON;
    const finalValue = newGrossProceeds - newSellFees;
    const profit = finalValue - Number(execution.entryCost);
    const roi = profit / Number(execution.entryCost);
    const exitTrigger = execution.exitTrigger ??
      input.forceExitTrigger ??
      (takeProfitAvailable ? "TAKE_PROFIT_DEPTH" : "LAST_MINUTE_FAK");

    await prisma.$transaction([
      prisma.realisticShortExitBookUse.create({
        data: {
          executionId: execution.id,
          side: "SELL",
          fingerprint,
          secondsToClose: input.secondsToClose
        }
      }),
      prisma.realisticShortExitFill.createMany({
        data: preview.fills.map((fill) => ({
          executionId: execution.id,
          ...fillData("SELL", fill, input.secondsToClose)
        }))
      }),
      prisma.realisticShortExitExecution.update({
        where: { id: execution.id },
        data: {
          status: fullyLiquidated ? "RESOLVED" : "LIQUIDATING",
          sharesSold: decimal(newSharesSold),
          sellGrossProceeds: decimal(newGrossProceeds),
          sellFees: decimal(newSellFees),
          remainingShares: decimal(newRemainingShares),
          exitTrigger,
          lastObservedAt: new Date(),
          ...(fullyLiquidated
            ? {
                finalValue: decimal(finalValue),
                profit: decimal(profit),
                roi: decimal(roi),
                resolutionSource: "FULLY_SOLD_CLOB_DEPTH",
                resolvedAt: new Date()
              }
            : {})
        }
      })
    ]);
  }
}

export function executeBuyDepth(
  asks: PolymarketOrderBookLevel[],
  budget: number
): DepthExecution {
  let remainingBudget = budget;
  const fills: ExecutionFill[] = [];
  const levels = normalizeLevels(asks).sort((left, right) => left.price - right.price);

  for (const level of levels) {
    const unitFee = TAKER_FEE_RATE * level.price * (1 - level.price);
    const unitCost = level.price + unitFee;
    let shares = Math.min(level.size, remainingBudget / unitCost);
    if (shares <= EPSILON) {
      continue;
    }

    let grossValue = shares * level.price;
    let fee = calculateCryptoTakerFee(shares, level.price, TAKER_FEE_RATE);
    let netValue = grossValue + fee;
    if (netValue > remainingBudget) {
      shares = Math.max(0, shares - (netValue - remainingBudget) / unitCost - EPSILON);
      grossValue = shares * level.price;
      fee = calculateCryptoTakerFee(shares, level.price, TAKER_FEE_RATE);
      netValue = grossValue + fee;
    }
    fills.push({ price: level.price, shares, grossValue, fee, netValue });
    remainingBudget = Math.max(0, remainingBudget - netValue);
    if (remainingBudget <= EPSILON) {
      break;
    }
  }

  return summarizeDepth(fills, remainingBudget <= Math.max(EPSILON, budget * 0.00001));
}

export function executeSellDepth(
  bids: PolymarketOrderBookLevel[],
  sharesToSell: number
): DepthExecution {
  let remainingShares = sharesToSell;
  const fills: ExecutionFill[] = [];
  const levels = normalizeLevels(bids).sort((left, right) => right.price - left.price);

  for (const level of levels) {
    const shares = Math.min(level.size, remainingShares);
    if (shares <= EPSILON) {
      continue;
    }

    const grossValue = shares * level.price;
    const fee = calculateCryptoTakerFee(shares, level.price, TAKER_FEE_RATE);
    const netValue = grossValue - fee;
    fills.push({ price: level.price, shares, grossValue, fee, netValue });
    remainingShares = Math.max(0, remainingShares - shares);
    if (remainingShares <= EPSILON) {
      break;
    }
  }

  return summarizeDepth(fills, remainingShares <= EPSILON);
}

export function fingerprintBook(
  orderBook: PolymarketOrderBook,
  side: "BUY" | "SELL"
): string {
  const levels = side === "BUY" ? orderBook.asks : orderBook.bids;
  const normalized = normalizeLevels(levels)
    .sort((left, right) =>
      side === "BUY" ? left.price - right.price : right.price - left.price
    )
    .map((level) => [level.price, level.size]);

  return createHash("sha256")
    .update(JSON.stringify([orderBook.tokenId, side, normalized]))
    .digest("hex");
}

function normalizeLevels(levels: PolymarketOrderBookLevel[]) {
  return levels.flatMap((level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    return Number.isFinite(price) && price > 0 && price < 1 &&
      Number.isFinite(size) && size > 0
      ? [{ price, size }]
      : [];
  });
}

function summarizeDepth(
  fills: ExecutionFill[],
  fullyFilled: boolean
): DepthExecution {
  const shares = fills.reduce((sum, fill) => sum + fill.shares, 0);
  const grossValue = fills.reduce((sum, fill) => sum + fill.grossValue, 0);
  const fees = fills.reduce((sum, fill) => sum + fill.fee, 0);
  return {
    fills,
    shares,
    grossValue,
    fees,
    netValue: fills.reduce((sum, fill) => sum + fill.netValue, 0),
    averagePrice: shares > 0 ? grossValue / shares : 0,
    fullyFilled
  };
}

function fillData(side: "BUY" | "SELL", fill: ExecutionFill, secondsToClose: number) {
  return {
    side,
    price: decimal(fill.price),
    shares: decimal(fill.shares),
    grossValue: decimal(fill.grossValue),
    fee: decimal(fill.fee),
    netValue: decimal(fill.netValue),
    secondsToClose
  };
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
