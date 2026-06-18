import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { OfficialMarketOutcomeService } from "../market-data/official-market-outcome.service";
import { OfficialTargetResolverService } from "../market-data/official-target-resolver.service";
import { normalizeOutcome } from "./resolve-simulated-trades.job";

const OFFICIAL_RESULT_DELAY_MS = 60_000;
const LIMIT = 100;

export class ResolveMlOutcomeShadowExecutionsJob {
  constructor(
    private readonly logger: LoggerService,
    private readonly outcomeService = new OfficialMarketOutcomeService(),
    private readonly targetResolver = new OfficialTargetResolverService()
  ) {}

  async runOnce(): Promise<void> {
    const now = new Date();
    const executions = await prisma.mlOutcomeShadowExecution.findMany({
      where: {
        status: "PENDING",
        market: {
          endDate: {
            lte: new Date(now.getTime() - OFFICIAL_RESULT_DELAY_MS)
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
      orderBy: { createdAt: "asc" },
      take: LIMIT
    });

    for (const execution of executions) {
      if (!execution.market.slug || execution.totalCost === null ||
          execution.shares === null) {
        continue;
      }

      try {
        const winner = await this.outcomeService.resolve(
          execution.marketId,
          execution.market.slug
        );
        if (!winner) {
          continue;
        }

        const settlement = calculateMlOutcomeSettlement({
          predictedOutcome: execution.predictedOutcome,
          officialWinner: winner.outcome,
          shares: Number(execution.shares),
          totalCost: Number(execution.totalCost)
        });

        await prisma.mlOutcomeShadowExecution.update({
          where: { id: execution.id },
          data: {
            status: "RESOLVED",
            officialWinner: winner.outcome,
            resolutionSource: winner.source,
            isWin: settlement.isWin,
            finalValue: decimal(settlement.finalValue),
            profit: decimal(settlement.profit),
            roi: decimal(settlement.roi),
            resolvedAt: now
          }
        });

        this.logPriceDiscrepancy(execution).catch(() => {});

        this.logger.info("ML outcome executable shadow entry resolved.", {
          executionId: execution.id,
          assetSymbol: execution.assetSymbol,
          timeframe: execution.timeframe,
          predictedOutcome: execution.predictedOutcome,
          officialWinner: winner.outcome,
          resolutionSource: winner.source,
          totalCost: Number(execution.totalCost),
          fee: Number(execution.fee ?? 0),
          profit: settlement.profit,
          roi: settlement.roi
        });
      } catch (error) {
        this.logger.error(
          "Failed to resolve ML outcome executable shadow entry.",
          error,
          {
            executionId: execution.id,
            marketId: execution.marketId
          }
        );
      }
    }
  }

  private async logPriceDiscrepancy(execution: { id: string; assetSymbol: string; timeframe: string; marketId: string; predictedOutcome: string; predictionId: string }): Promise<void> {
    try {
      const prediction = await prisma.botPrediction.findUnique({
        where: { id: execution.predictionId },
        select: { snapshotId: true }
      });
      if (!prediction) return;

      const snapshot = await prisma.marketSnapshot.findUnique({
        where: { id: prediction.snapshotId },
        select: { currentAssetPrice: true, targetPrice: true, createdAt: true }
      });
      if (!snapshot?.currentAssetPrice) return;

      const market = await prisma.market.findUnique({
        where: { id: execution.marketId },
        select: { endDate: true, slug: true }
      });
      if (!market?.endDate) return;

      const chainlinkClose = await this.targetResolver.resolveChainlinkPriceAt(
        execution.assetSymbol,
        market.endDate,
        15_000
      );

      if (chainlinkClose.price === null) {
        this.logger?.info("Price comparison: Chainlink close price unavailable.", {
          executionId: execution.id,
          assetSymbol: execution.assetSymbol
        });
        return;
      }

      const snapshotPrice = Number(snapshot.currentAssetPrice);
      const targetPrice = Number(snapshot.targetPrice);
      const chainlinkPrice = chainlinkClose.price;
      const discrepancy = snapshotPrice - chainlinkPrice;
      const discrepancyBps = targetPrice !== 0 ? (discrepancy / targetPrice) * 10000 : 0;

      this.logger.info("PRICE_COMPARISON_SNAPSHOT_VS_CHAINLINK", {
        executionId: execution.id,
        assetSymbol: execution.assetSymbol,
        timeframe: execution.timeframe,
        snapshotPrice: snapshotPrice.toFixed(6),
        chainlinkClosePrice: chainlinkPrice.toFixed(6),
        targetPrice: targetPrice.toFixed(6),
        discrepancyAbs: discrepancy.toFixed(6),
        discrepancyBps: discrepancyBps.toFixed(2),
        snapshotTime: snapshot.createdAt.toISOString(),
        marketEnd: market.endDate.toISOString(),
        predictedOutcome: execution.predictedOutcome
      });
    } catch (error) {
      this.logger?.debug("Price comparison logging failed.", { executionId: execution.id, error: String(error) });
    }
  }
}

export function calculateMlOutcomeSettlement(input: {
  predictedOutcome: string;
  officialWinner: string;
  shares: number;
  totalCost: number;
}) {
  const isWin =
    normalizeBinaryOutcome(input.predictedOutcome) ===
    normalizeBinaryOutcome(input.officialWinner);
  const finalValue = isWin ? input.shares : 0;
  const profit = finalValue - input.totalCost;
  return {
    isWin,
    finalValue,
    profit,
    roi: profit / input.totalCost
  };
}

function normalizeBinaryOutcome(value: string): "UP" | "DOWN" | "OTHER" {
  const normalized = normalizeOutcome(value);
  if (normalized === "UP" || normalized === "YES") return "UP";
  if (normalized === "DOWN" || normalized === "NO") return "DOWN";
  return "OTHER";
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
