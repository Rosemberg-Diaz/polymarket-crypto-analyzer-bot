import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { OfficialMarketOutcomeService } from "../market-data/official-market-outcome.service";
import { normalizeOutcome } from "./resolve-simulated-trades.job";

const OFFICIAL_RESULT_DELAY_MS = 60_000;
const LIMIT = 50;

export class ResolveRealisticShortExitExecutionsJob {
  constructor(
    private readonly logger: LoggerService,
    private readonly outcomeService = new OfficialMarketOutcomeService()
  ) {}

  async runOnce(): Promise<void> {
    const now = new Date();
    const executions = await prisma.realisticShortExitExecution.findMany({
      where: {
        status: {
          in: ["ACTIVE", "LIQUIDATING", "HOLD_TO_RESOLUTION", "API_DATA_GAP"]
        },
        market: {
          endDate: {
            lte: new Date(now.getTime() - OFFICIAL_RESULT_DELAY_MS)
          }
        }
      },
      include: {
        market: {
          select: {
            slug: true,
            endDate: true
          }
        }
      },
      orderBy: { createdAt: "asc" },
      take: LIMIT
    });

    for (const execution of executions) {
      if (!execution.market.slug) {
        continue;
      }

      try {
        const winner = await this.outcomeService.resolve(
          execution.marketId,
          execution.market.slug
        );
        if (!winner) {
          await prisma.realisticShortExitExecution.update({
            where: { id: execution.id },
            data: {
              status: "API_DATA_GAP",
              dataGapCount: { increment: 1 },
              lastObservedAt: now
            }
          });
          continue;
        }

        const settlement = calculateOfficialSettlement({
          predictedOutcome: execution.outcome,
          officialWinner: winner.outcome,
          remainingShares: Number(execution.remainingShares),
          sellGrossProceeds: Number(execution.sellGrossProceeds),
          sellFees: Number(execution.sellFees),
          entryCost: Number(execution.entryCost)
        });

        await prisma.realisticShortExitExecution.update({
          where: { id: execution.id },
          data: {
            status: "RESOLVED",
            settlementValue: decimal(settlement.settlementValue),
            finalValue: decimal(settlement.finalValue),
            profit: decimal(settlement.profit),
            roi: decimal(settlement.roi),
            officialWinner: winner.outcome,
            resolutionSource: winner.source,
            exitTrigger: execution.exitTrigger ?? "HELD_TO_OFFICIAL_RESOLUTION",
            resolvedAt: now
          }
        });

        this.logger.info("Realistic short-exit execution resolved.", {
          executionId: execution.id,
          asset: execution.assetSymbol,
          outcome: execution.outcome,
          officialWinner: winner.outcome,
          resolutionSource: winner.source,
          sharesSold: Number(execution.sharesSold),
          remainingShares: Number(execution.remainingShares),
          settlementValue: settlement.settlementValue,
          finalValue: settlement.finalValue,
          profit: settlement.profit,
          roi: settlement.roi
        });
      } catch (error) {
        this.logger.error("Failed to resolve realistic short-exit execution.", error, {
          executionId: execution.id,
          marketId: execution.marketId
        });
      }
    }
  }
}

export function calculateOfficialSettlement(input: {
  predictedOutcome: string;
  officialWinner: string;
  remainingShares: number;
  sellGrossProceeds: number;
  sellFees: number;
  entryCost: number;
}) {
  const won = normalizeOutcome(input.predictedOutcome) ===
    normalizeOutcome(input.officialWinner);
  const settlementValue = won ? input.remainingShares : 0;
  const soldNet = input.sellGrossProceeds - input.sellFees;
  const finalValue = soldNet + settlementValue;
  const profit = finalValue - input.entryCost;
  return {
    won,
    settlementValue,
    finalValue,
    profit,
    roi: profit / input.entryCost
  };
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
