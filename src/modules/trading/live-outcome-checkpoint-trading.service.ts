import { MlOutcomeShadowExecution, Prisma } from "@prisma/client";
import { CryptoAsset } from "../../config/assets";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketTradingService } from "./polymarket-trading.service";

const CHECKPOINTS_BY_TIMEFRAME = {
  "5m": [30],
  "15m": [180, 120, 60]
} as const;
const OPEN_STATUSES = ["ENTRY_ATTEMPTING", "OPEN"];
const PRICE_EPSILON = 0.000001;
const TAKER_FEE_RATE = 0.07;

export type LiveOutcomeCheckpointGate =
  | { allowed: true }
  | { allowed: false; reason: string };

export class LiveOutcomeCheckpointTradingService {
  constructor(
    private readonly logger: LoggerService,
    private readonly tradingService: PolymarketTradingService | null
  ) {}

  isEnabled(): boolean {
    return Boolean(
      config.enableRealTrading &&
      config.enableMlOutcomeRealTrading &&
      config.appMode === "LIVE_TRADING" &&
      this.tradingService
    );
  }

  async tryOpen(execution: MlOutcomeShadowExecution): Promise<void> {
    const gate = await this.evaluateGate(execution);
    if (!gate.allowed) {
      this.logger.info("Live outcome checkpoint pilot skipped.", {
        executionId: execution.id,
        assetSymbol: execution.assetSymbol,
        timeframe: execution.timeframe,
        checkpointSeconds: execution.checkpointSeconds,
        reason: gate.reason
      });
      return;
    }

    const existing = await prisma.liveOutcomeCheckpointTrade.findUnique({
      where: { shadowExecutionId: execution.id },
      select: { id: true }
    });
    if (existing) {
      return;
    }

      const maxPrice = Number(execution.worstFillPrice);
    const dynamicBudget = await this.computeDynamicBudget(execution.tokenId, maxPrice);
    if (dynamicBudget === null) {
      this.logger.info("Live outcome checkpoint skipped — orderbook unavailable for dynamic budget.", {
        executionId: execution.id,
        assetSymbol: execution.assetSymbol,
        tokenId: execution.tokenId
      });
      return;
    }
    if (dynamicBudget < 1) {
      this.logger.info("Live outcome checkpoint skipped — insufficient depth for $1 FOK.", {
        executionId: execution.id,
        assetSymbol: execution.assetSymbol,
        dynamicBudget
      });
      return;
    }

    const budgetAdjusted = dynamicBudget < config.mlOutcomeRealStakeUsd;
    const trade = await prisma.liveOutcomeCheckpointTrade.create({
      data: {
        shadowExecutionId: execution.id,
        predictionId: execution.predictionId,
        marketId: execution.marketId,
        assetSymbol: execution.assetSymbol,
        timeframe: execution.timeframe,
        predictedOutcome: execution.predictedOutcome,
        tokenId: execution.tokenId,
        checkpointSeconds: execution.checkpointSeconds,
        status: "ENTRY_ATTEMPTING",
        budget: decimal(dynamicBudget),
        requestedMaxPrice: decimal(maxPrice)
      }
    });

    if (budgetAdjusted) {
      this.logger.info("Dynamic FOK budget adjusted for shallow orderbook.", {
        tradeId: trade.id,
        originalBudget: config.mlOutcomeRealStakeUsd,
        adjustedBudget: dynamicBudget,
        maxPrice
      });
    }

    try {
      const result = await this.tradingService!.placeFokMarketBuy(
        execution.tokenId,
        dynamicBudget,
        maxPrice
      );

      if (!result.success || !result.filledShares || !result.cashAmount) {
        const error = result.error ?? "FOK buy did not produce a confirmed fill.";
        await prisma.liveOutcomeCheckpointTrade.update({
          where: { id: trade.id },
          data: {
            status: "FAILED",
            errorMessage: error,
            responseData: stringifyResult(result)
          }
        });
        this.logger.warn("Live outcome checkpoint FOK buy failed.", {
          tradeId: trade.id,
          executionId: execution.id,
          assetSymbol: execution.assetSymbol,
          error
        });
        return;
      }

      await prisma.liveOutcomeCheckpointTrade.update({
        where: { id: trade.id },
        data: {
          status: "OPEN",
          externalOrderId: result.orderId,
          filledShares: decimal(result.filledShares),
          cashAmount: decimal(result.cashAmount),
          averagePrice: decimal(
            result.averagePrice ?? result.cashAmount / result.filledShares
          ),
          responseData: stringifyResult(result),
          openedAt: new Date()
        }
      });

      this.logger.info("Live outcome checkpoint FOK buy filled.", {
        tradeId: trade.id,
        executionId: execution.id,
        marketId: execution.marketId,
        assetSymbol: execution.assetSymbol,
        timeframe: execution.timeframe,
        predictedOutcome: execution.predictedOutcome,
        checkpointSeconds: execution.checkpointSeconds,
        budgetUsd: dynamicBudget,
        filledShares: result.filledShares,
        cashAmount: result.cashAmount,
        averagePrice: result.averagePrice
      });
    } catch (error) {
      await prisma.liveOutcomeCheckpointTrade.update({
        where: { id: trade.id },
        data: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
      this.logger.error("Live outcome checkpoint pilot failed.", error, {
        tradeId: trade.id,
        executionId: execution.id
      });
    }
  }

  private async computeDynamicBudget(tokenId: string, maxPrice: number): Promise<number | null> {
    const book = await this.tradingService?.getOrderbook(tokenId);
    if (!book?.asks?.length) return null;
    const sorted = book.asks
      .map((l) => ({ price: Number(l.price), size: Number(l.size) }))
      .filter((l) => Number.isFinite(l.price) && l.price > 0 && l.price <= maxPrice && Number.isFinite(l.size) && l.size > 0)
      .sort((a, b) => a.price - b.price);
    let totalCost = 0;
    const maxBudget = config.mlOutcomeRealStakeUsd;
    for (const { price, size } of sorted) {
      const feePerShare = TAKER_FEE_RATE * price * (1 - price);
      const costPerShare = price + feePerShare;
      const levelCost = size * costPerShare;
      const remaining = maxBudget - totalCost;
      if (levelCost >= remaining) {
        totalCost = maxBudget;
        break;
      }
      totalCost += levelCost;
    }
    return Math.min(maxBudget, Math.max(1, Math.floor(totalCost)));
  }

  async evaluateGate(
    execution: MlOutcomeShadowExecution
  ): Promise<LiveOutcomeCheckpointGate> {
    const staticGate = isLiveOutcomeCheckpointEligible(execution);
    if (!staticGate.allowed) {
      return staticGate;
    }

    if (!this.isEnabled()) {
      return { allowed: false, reason: "LIVE_OUTCOME_PILOT_DISABLED" };
    }

    const openTrades = await prisma.liveOutcomeCheckpointTrade.count({
      where: { status: { in: OPEN_STATUSES } }
    });
    if (openTrades >= config.mlOutcomeRealMaxOpenTrades) {
      return {
        allowed: false,
        reason: `MAX_OPEN_TRADES_REACHED:${openTrades}`
      };
    }

    const dailyProfit = await getTodayPilotProfit();
    if (dailyProfit <= -config.mlOutcomeRealDailyStopLossUsd) {
      return {
        allowed: false,
        reason: `DAILY_STOP_LOSS_REACHED:${dailyProfit.toFixed(4)}`
      };
    }

    return { allowed: true };
  }
}

export function isLiveOutcomeCheckpointEligible(
  execution: MlOutcomeShadowExecution
): LiveOutcomeCheckpointGate {
  if (execution.status !== "PENDING") {
    return { allowed: false, reason: `SHADOW_NOT_EXECUTABLE:${execution.status}` };
  }

  if (!isAllowedRealSegment(execution)) {
    return {
      allowed: false,
      reason:
        `SEGMENT_NOT_IN_REAL_PILOT:${execution.assetSymbol}:` +
        `${execution.timeframe}:${execution.predictedOutcome}`
    };
  }

  if (!isAllowedCheckpointForTimeframe(execution)) {
    return {
      allowed: false,
      reason:
        `CHECKPOINT_NOT_ALLOWED_FOR_TIMEFRAME:` +
        `${execution.timeframe}:${execution.checkpointSeconds}`
    };
  }

  if (execution.fullyFilled !== true) {
    return { allowed: false, reason: "SHADOW_NOT_FULLY_FILLED" };
  }

  if (
    execution.expectedProfit === null ||
    Number(execution.expectedProfit) <= 0
  ) {
    return { allowed: false, reason: "NON_POSITIVE_EXPECTED_PROFIT" };
  }

  if (
    execution.worstFillPrice === null ||
    Number(execution.worstFillPrice) <= 0 ||
    Number(execution.worstFillPrice) >= 1
  ) {
    return { allowed: false, reason: "INVALID_MAX_PRICE" };
  }

  if (
    execution.slippage === null ||
    Number(execution.slippage) >
      config.mlOutcomeExecutionMaxSlippage + PRICE_EPSILON
  ) {
    return { allowed: false, reason: "SLIPPAGE_ABOVE_LIMIT" };
  }

  return { allowed: true };
}

function isAllowedRealSegment(execution: MlOutcomeShadowExecution): boolean {
  const asset = execution.assetSymbol as CryptoAsset;
  const timeframe = execution.timeframe === "15m" ? "15m" :
    execution.timeframe === "5m" ? "5m" : null;
  const outcome = execution.predictedOutcome === "UP" ? "UP" :
    execution.predictedOutcome === "DOWN" ? "DOWN" : null;

  if (!timeframe || !outcome) {
    return false;
  }

  return config.mlOutcomeRealSegments.includes(`${asset}:${timeframe}:${outcome}`);
}

function isAllowedCheckpointForTimeframe(
  execution: MlOutcomeShadowExecution
): boolean {
  const timeframe = execution.timeframe === "15m" ? "15m" :
    execution.timeframe === "5m" ? "5m" : null;

  if (!timeframe) {
    return false;
  }

  return (CHECKPOINTS_BY_TIMEFRAME[timeframe] as readonly number[])
    .includes(execution.checkpointSeconds);
}

async function getTodayPilotProfit(): Promise<number> {
  const start = getBogotaDayStartUtc();
  const rows = await prisma.liveOutcomeCheckpointTrade.findMany({
    where: {
      createdAt: { gte: start },
      status: "RESOLVED",
      profit: { not: null }
    },
    select: { profit: true }
  });

  return rows.reduce((sum, row) => sum + Number(row.profit ?? 0), 0);
}

function getBogotaDayStartUtc(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value])
  );
  return new Date(`${parts.year}-${parts.month}-${parts.day}T05:00:00.000Z`);
}

function stringifyResult(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "Could not serialize trading response." });
  }
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
