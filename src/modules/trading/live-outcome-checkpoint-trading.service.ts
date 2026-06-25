import { MlOutcomeShadowExecution, Prisma } from "@prisma/client";
import { CryptoAsset } from "../../config/assets";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import {
  MarketOrderExecutionResult,
  PolymarketTradingService
} from "./polymarket-trading.service";

const CHECKPOINTS_BY_TIMEFRAME = {
  "5m": [30],
  "15m": [180, 120, 60]
} as const;
const OPEN_STATUSES = ["ENTRY_ATTEMPTING", "OPEN"];
const PRICE_EPSILON = 0.000001;
const TAKER_FEE_RATE = 0.07;
const MIN_FOK_BUDGET_USD = 1.5;
const FULL_FOK_BUDGET_USD = 3;
const FIVE_MINUTE_MAX_REAL_ENTRY_PRICE = 0.80;

function getStakeForTimeframe(timeframe: string): number {
  if (timeframe === "15m") return config.mlOutcomeRealStakeUsd15m;
  if (timeframe === "1h" || timeframe === "4h") return config.htfRealStakeUsd;
  return config.mlOutcomeRealStakeUsd;
}

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
      (config.enableMlOutcomeRealTrading || config.enableHtfRealTrading) &&
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

    // Check if HTF trading is enabled for HTF executions
    const isHtf = execution.timeframe === "1h" || execution.timeframe === "4h";
    if (isHtf && !config.enableHtfRealTrading) {
      this.logger.info("HTF real trading disabled, skipping.", {
        executionId: execution.id,
        assetSymbol: execution.assetSymbol,
        timeframe: execution.timeframe
      });
      return;
    }

    // Check if 15m trading is enabled for 15m executions
    if (!isHtf && !config.enableMlOutcomeRealTrading) {
      this.logger.info("15m real trading disabled, skipping.", {
        executionId: execution.id,
        assetSymbol: execution.assetSymbol,
        timeframe: execution.timeframe
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
    const stakeForTimeframe = getStakeForTimeframe(execution.timeframe);
    const dynamicBudget = await this.computeDynamicBudget(execution.tokenId, maxPrice, stakeForTimeframe);
    if (dynamicBudget === null) {
      this.logger.info("Live outcome checkpoint skipped — orderbook unavailable for dynamic budget.", {
        executionId: execution.id,
        assetSymbol: execution.assetSymbol,
        tokenId: execution.tokenId
      });
      return;
    }
    if (dynamicBudget < MIN_FOK_BUDGET_USD) {
      this.logger.info("Live outcome checkpoint skipped — insufficient depth for minimum FOK.", {
        executionId: execution.id,
        assetSymbol: execution.assetSymbol,
        dynamicBudget
      });
      return;
    }

    const budgetAdjusted = dynamicBudget < stakeForTimeframe;
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
        originalBudget: stakeForTimeframe,
        adjustedBudget: dynamicBudget,
        maxPrice
      });
    }

    try {
      const initialResult = await this.tradingService!.placeFokMarketBuy(
        execution.tokenId,
        dynamicBudget,
        maxPrice
      );
      let result = initialResult;
      let executedBudget = dynamicBudget;

      if (
        execution.timeframe === "5m" &&
        shouldRetryFokAtMinimum(dynamicBudget, initialResult)
      ) {
        this.logger.info("Retrying failed 5m FOK buy immediately at minimum budget.", {
          tradeId: trade.id,
          executionId: execution.id,
          assetSymbol: execution.assetSymbol,
          initialBudget: dynamicBudget,
          retryBudget: MIN_FOK_BUDGET_USD,
          maxPrice
        });
        result = await this.tradingService!.placeFokMarketBuy(
          execution.tokenId,
          MIN_FOK_BUDGET_USD,
          maxPrice
        );
        executedBudget = MIN_FOK_BUDGET_USD;
      }

      if (!result.success || !result.filledShares || !result.cashAmount) {
        const error = result.error ?? "FOK buy did not produce a confirmed fill.";
        await prisma.liveOutcomeCheckpointTrade.update({
          where: { id: trade.id },
          data: {
            status: "FAILED",
            reconciliationStatus: "NOT_APPLICABLE",
            errorMessage: error,
            responseData: stringifyResult({
              initial: initialResult,
              retry: result === initialResult ? null : result
            })
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
          budget: decimal(executedBudget),
          externalOrderId: result.orderId,
          filledShares: decimal(result.filledShares),
          cashAmount: decimal(result.cashAmount),
          averagePrice: decimal(
            result.averagePrice ?? result.cashAmount / result.filledShares
          ),
          responseData: stringifyResult({
            initial: initialResult,
            retry: result === initialResult ? null : result
          }),
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
        budgetUsd: executedBudget,
        retriedAtMinimumBudget: executedBudget !== dynamicBudget,
        filledShares: result.filledShares,
        cashAmount: result.cashAmount,
        averagePrice: result.averagePrice
      });
    } catch (error) {
      await prisma.liveOutcomeCheckpointTrade.update({
        where: { id: trade.id },
        data: {
          status: "FAILED",
          reconciliationStatus: "NOT_APPLICABLE",
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
      this.logger.error("Live outcome checkpoint pilot failed.", error, {
        tradeId: trade.id,
        executionId: execution.id
      });
    }
  }

  private async computeDynamicBudget(tokenId: string, maxPrice: number, stakeUsd: number): Promise<number | null> {
    const book = await this.tradingService?.getOrderbook(tokenId);
    if (!book?.asks?.length) return null;
    return calculateDynamicFokBudget(book.asks, maxPrice, stakeUsd);
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

    // Use HTF-specific settings for 1h/4h
    const isHtf = execution.timeframe === "1h" || execution.timeframe === "4h";
    const maxOpenTrades = isHtf ? config.htfRealMaxOpenTrades : config.mlOutcomeRealMaxOpenTrades;
    const dailyStopLoss = isHtf ? config.htfRealDailyStopLossUsd : config.mlOutcomeRealDailyStopLossUsd;
    const absoluteDailyStopLoss = isHtf ? config.htfRealAbsoluteDailyStopLossUsd : config.mlOutcomeRealAbsoluteDailyStopLossUsd;

    const openTrades = await prisma.liveOutcomeCheckpointTrade.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: { budget: true, timeframe: true }
    });

    // Filter open trades by type (HTF vs 15m) for separate limits
    const htfOpenTrades = openTrades.filter(t => t.timeframe === "1h" || t.timeframe === "4h");
    const regularOpenTrades = openTrades.filter(t => t.timeframe !== "1h" && t.timeframe !== "4h");

    const relevantOpenTrades = isHtf ? htfOpenTrades : regularOpenTrades;
    if (relevantOpenTrades.length >= maxOpenTrades) {
      return {
        allowed: false,
        reason: `MAX_OPEN_TRADES_REACHED:${relevantOpenTrades.length}`
      };
    }

    const [dailyProfit, operationalProfit] = await Promise.all([
      getPilotProfitSince(getBogotaDayStartUtc(), isHtf),
      getPilotProfitSince(
        config.mlOutcomeRealStopLossBaselineAt ?? getBogotaDayStartUtc(), isHtf
      )
    ]);
    const stakeForTimeframe = getStakeForTimeframe(execution.timeframe);
    const openRisk = relevantOpenTrades.reduce(
      (sum, trade) => sum + Number(trade.budget),
      0
    );
    if (wouldExceedDailyStopLoss(
      operationalProfit,
      openRisk,
      stakeForTimeframe,
      dailyStopLoss
    )) {
      return {
        allowed: false,
        reason:
          `OPERATIONAL_STOP_LOSS_WOULD_BE_EXCEEDED:` +
          `${operationalProfit.toFixed(4)}-${openRisk.toFixed(2)}-` +
          `${stakeForTimeframe.toFixed(2)}`
      };
    }
    if (wouldExceedDailyStopLoss(
      dailyProfit,
      openRisk,
      stakeForTimeframe,
      absoluteDailyStopLoss
    )) {
      return {
        allowed: false,
        reason:
          `ABSOLUTE_DAILY_STOP_LOSS_WOULD_BE_EXCEEDED:` +
          `${dailyProfit.toFixed(4)}-${openRisk.toFixed(2)}-` +
          `${stakeForTimeframe.toFixed(2)}`
      };
    }

    const confidenceThreshold = getMlOutcomeRealMinConfidence(execution);
    if (Number(execution.modelProbability) < confidenceThreshold) {
      return {
        allowed: false,
        reason:
          `${execution.predictedOutcome}_CONFIDENCE_TOO_LOW:` +
          `${execution.assetSymbol}:${execution.timeframe}:` +
          `${execution.checkpointSeconds}:` +
          `${(Number(execution.modelProbability) * 100).toFixed(1)}% < ` +
          `${(confidenceThreshold * 100).toFixed(0)}%`
      };
    }

    return { allowed: true };
  }
}

export function calculateDynamicFokBudget(
  asks: Array<{ price: string; size: string }>,
  maxPrice: number,
  stakeUsd: number
): number {
  const sorted = asks
    .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    .filter(
      (level) =>
        Number.isFinite(level.price) &&
        level.price > 0 &&
        level.price <= maxPrice + PRICE_EPSILON &&
        Number.isFinite(level.size) &&
        level.size > 0
    )
    .sort((a, b) => a.price - b.price);

  let totalCost = 0;
  for (const { price, size } of sorted) {
    const feePerShare = TAKER_FEE_RATE * price * (1 - price);
    const levelCost = size * (price + feePerShare);
    const remaining = stakeUsd - totalCost;
    if (levelCost >= remaining) {
      totalCost = stakeUsd;
      break;
    }
    totalCost += levelCost;
  }

  const boundedCost = Math.min(stakeUsd, totalCost);
  return Math.floor((boundedCost + Number.EPSILON) * 100) / 100;
}

export function shouldRetryFokAtMinimum(
  initialBudget: number,
  result: MarketOrderExecutionResult
): boolean {
  return (
    initialBudget >= FULL_FOK_BUDGET_USD - PRICE_EPSILON &&
    result.success !== true &&
    result.error?.toLowerCase().includes("fully filled") === true
  );
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

  // Skip EV check for HTF (1h/4h) - observation data already proved profitability
  const isHtfForEv = execution.timeframe === "1h" || execution.timeframe === "4h";
  if (
    !isHtfForEv &&
    (execution.expectedProfit === null ||
    Number(execution.expectedProfit) <= 0)
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

  // 5m entry price check (not for HTF)
  if (
    execution.timeframe === "5m" &&
    !isUnfilteredEthFiveMinuteUp(execution) &&
    Number(execution.worstFillPrice) >= FIVE_MINUTE_MAX_REAL_ENTRY_PRICE
  ) {
    return {
      allowed: false,
      reason:
        `5M_ENTRY_PRICE_TOO_HIGH:` +
        `${Number(execution.worstFillPrice).toFixed(4)} >= ` +
        `${FIVE_MINUTE_MAX_REAL_ENTRY_PRICE.toFixed(2)}`
    };
  }

  // Slippage check - use HTF-specific limit for 1h/4h
  const isHtf = execution.timeframe === "1h" || execution.timeframe === "4h";
  const maxSlippage = isHtf ? config.htfRealMaxSlippage : config.mlOutcomeExecutionMaxSlippage;

  if (
    execution.slippage === null ||
    Number(execution.slippage) > maxSlippage + PRICE_EPSILON
  ) {
    return { allowed: false, reason: "SLIPPAGE_ABOVE_LIMIT" };
  }

  return { allowed: true };
}

function isUnfilteredEthFiveMinuteUp(
  execution: Pick<
    MlOutcomeShadowExecution,
    "assetSymbol" | "timeframe" | "predictedOutcome"
  >
): boolean {
  return (
    execution.assetSymbol === "ETH" &&
    execution.timeframe === "5m" &&
    execution.predictedOutcome === "UP"
  );
}

export function wouldExceedDailyStopLoss(
  realizedProfit: number,
  openRisk: number,
  proposedStake: number,
  stopLossUsd: number
): boolean {
  return realizedProfit - openRisk - proposedStake < -stopLossUsd;
}

export function getMlOutcomeRealMinConfidence(
  execution: Pick<
    MlOutcomeShadowExecution,
    "assetSymbol" | "timeframe" | "predictedOutcome" |
    "checkpointSeconds"
  >
): number {
  // Check for specific rule override (15m)
  const rule =
    `${execution.assetSymbol}:${execution.timeframe}:` +
    `${execution.predictedOutcome}:${execution.checkpointSeconds}`;
  const override = config.mlOutcomeRealMinConfidenceByRule[rule];
  if (override !== undefined) {
    return override;
  }

  // Use HTF confidence for 1h/4h
  if (execution.timeframe === "1h" || execution.timeframe === "4h") {
    return config.htfRealMinConfidence;
  }

  // Default for 5m/15m
  if (execution.predictedOutcome === "DOWN") {
    return execution.timeframe === "15m" ? 0.80 : 0.70;
  }

  return execution.timeframe === "15m" ? 0.80 : 0.70;
}

function isAllowedRealSegment(execution: MlOutcomeShadowExecution): boolean {
  const asset = execution.assetSymbol as CryptoAsset;
  const outcome = execution.predictedOutcome === "UP" ? "UP" :
    execution.predictedOutcome === "DOWN" ? "DOWN" : null;

  if (!outcome) {
    return false;
  }

  // Check 5m/15m segments
  const timeframe = execution.timeframe === "15m" ? "15m" :
    execution.timeframe === "5m" ? "5m" : null;

  if (timeframe) {
    return config.mlOutcomeRealSegments.includes(`${asset}:${timeframe}:${outcome}`);
  }

  // Check HTF segments (1h/4h)
  const htfTimeframe = execution.timeframe === "1h" ? "1h" :
    execution.timeframe === "4h" ? "4h" : null;

  if (htfTimeframe) {
    return config.enableHtfRealTrading &&
      config.htfRealSegments.includes(`${asset}:${htfTimeframe}`);
  }

  return false;
}

function isAllowedCheckpointForTimeframe(
  execution: MlOutcomeShadowExecution
): boolean {
  const segment = `${execution.assetSymbol}:${execution.timeframe}:${execution.predictedOutcome}`;
  const allowedCheckpoints = config.mlOutcomeRealSegmentCheckpoints[segment];
  
  if (allowedCheckpoints) {
    return allowedCheckpoints.includes(execution.checkpointSeconds);
  }
  
  // Check HTF checkpoints
  const htfSegment = `${execution.assetSymbol}:${execution.timeframe}`;
  const htfAllowedCheckpoints = config.htfRealCheckpoints[htfSegment];
  
  if (htfAllowedCheckpoints) {
    return htfAllowedCheckpoints.includes(execution.checkpointSeconds);
  }
  
  // Fallback to timeframe-based checkpoints
  const timeframe = execution.timeframe === "15m" ? "15m" :
    execution.timeframe === "5m" ? "5m" : null;

  if (!timeframe) {
    return false;
  }

  return (CHECKPOINTS_BY_TIMEFRAME[timeframe] as readonly number[])
    .includes(execution.checkpointSeconds);
}

async function getPilotProfitSince(start: Date, isHtf: boolean = false): Promise<number> {
  const where: any = {
    createdAt: { gte: start },
    status: "RESOLVED",
    profit: { not: null }
  };

  // Filter by timeframe type (HTF vs regular)
  if (isHtf) {
    where.timeframe = { in: ["1h", "4h"] };
  } else {
    where.timeframe = { notIn: ["1h", "4h"] };
  }

  const rows = await prisma.liveOutcomeCheckpointTrade.findMany({
    where,
    select: { actualProfit: true, profit: true }
  });

  return rows.reduce(
    (sum, row) => sum + Number(row.actualProfit ?? row.profit ?? 0),
    0
  );
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
