import { MlOutcomeShadowExecution, Prisma } from "@prisma/client";
import { CryptoAsset } from "../../config/assets";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketTradingService } from "./polymarket-trading.service";

const PILOT_CHECKPOINT_SECONDS = 30;
const PILOT_TIMEFRAME = "5m";
const OPEN_STATUSES = ["ENTRY_ATTEMPTING", "OPEN"];
const PRICE_EPSILON = 0.000001;

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
        budget: decimal(config.mlOutcomeRealStakeUsd),
        requestedMaxPrice: decimal(maxPrice)
      }
    });

    try {
      const result = await this.tradingService!.placeFokMarketBuy(
        execution.tokenId,
        config.mlOutcomeRealStakeUsd,
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
        budgetUsd: config.mlOutcomeRealStakeUsd,
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

  if (execution.checkpointSeconds !== PILOT_CHECKPOINT_SECONDS) {
    return { allowed: false, reason: "NOT_30S_CHECKPOINT" };
  }

  if (execution.timeframe !== PILOT_TIMEFRAME) {
    return { allowed: false, reason: "NOT_5M_TIMEFRAME" };
  }

  if (!config.mlOutcomeRealAssets.includes(execution.assetSymbol as CryptoAsset)) {
    return { allowed: false, reason: `ASSET_NOT_IN_PILOT:${execution.assetSymbol}` };
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
