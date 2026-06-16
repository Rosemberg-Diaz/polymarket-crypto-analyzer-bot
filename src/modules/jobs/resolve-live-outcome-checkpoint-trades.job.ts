import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { OfficialMarketOutcomeService } from "../market-data/official-market-outcome.service";
import { calculateMlOutcomeSettlement } from "./resolve-ml-outcome-shadow-executions.job";

const OFFICIAL_RESULT_DELAY_MS = 60_000;
const LIMIT = 50;

export class ResolveLiveOutcomeCheckpointTradesJob {
  constructor(
    private readonly logger: LoggerService,
    private readonly outcomeService = new OfficialMarketOutcomeService()
  ) {}

  async runOnce(): Promise<void> {
    const now = new Date();
    const trades = await prisma.liveOutcomeCheckpointTrade.findMany({
      where: {
        status: "OPEN",
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
      orderBy: { openedAt: "asc" },
      take: LIMIT
    });

    for (const trade of trades) {
      if (!trade.market.slug || Number(trade.cashAmount) <= 0 ||
          Number(trade.filledShares) <= 0) {
        continue;
      }

      try {
        const winner = await this.outcomeService.resolve(
          trade.marketId,
          trade.market.slug
        );
        if (!winner) {
          continue;
        }

        const settlement = calculateMlOutcomeSettlement({
          predictedOutcome: trade.predictedOutcome,
          officialWinner: winner.outcome,
          shares: Number(trade.filledShares),
          totalCost: Number(trade.cashAmount)
        });

        await prisma.liveOutcomeCheckpointTrade.update({
          where: { id: trade.id },
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

        this.logger.info("Live outcome checkpoint trade resolved.", {
          tradeId: trade.id,
          assetSymbol: trade.assetSymbol,
          timeframe: trade.timeframe,
          predictedOutcome: trade.predictedOutcome,
          officialWinner: winner.outcome,
          resolutionSource: winner.source,
          cashAmount: Number(trade.cashAmount),
          profit: settlement.profit,
          roi: settlement.roi
        });
      } catch (error) {
        this.logger.error("Failed to resolve live outcome checkpoint trade.", error, {
          tradeId: trade.id,
          marketId: trade.marketId
        });
      }
    }
  }
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
