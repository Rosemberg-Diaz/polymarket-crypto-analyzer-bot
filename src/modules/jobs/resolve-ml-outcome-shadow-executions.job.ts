import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { OfficialMarketOutcomeService } from "../market-data/official-market-outcome.service";
import { normalizeOutcome } from "./resolve-simulated-trades.job";

const OFFICIAL_RESULT_DELAY_MS = 60_000;
const LIMIT = 100;

export class ResolveMlOutcomeShadowExecutionsJob {
  constructor(
    private readonly logger: LoggerService,
    private readonly outcomeService = new OfficialMarketOutcomeService()
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
