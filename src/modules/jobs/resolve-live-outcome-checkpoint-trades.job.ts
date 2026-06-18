import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { OfficialMarketOutcomeService } from "../market-data/official-market-outcome.service";
import { OfficialTargetResolverService } from "../market-data/official-target-resolver.service";
import { calculateMlOutcomeSettlement } from "./resolve-ml-outcome-shadow-executions.job";

const OFFICIAL_RESULT_DELAY_MS = 60_000;
const LIMIT = 50;

export class ResolveLiveOutcomeCheckpointTradesJob {
  constructor(
    private readonly logger: LoggerService,
    private readonly outcomeService = new OfficialMarketOutcomeService(),
    private readonly targetResolver = new OfficialTargetResolverService()
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

        this.logPriceDiscrepancy(trade).catch(() => {});

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

  private async logPriceDiscrepancy(trade: { id: string; assetSymbol: string; timeframe: string; marketId: string; predictedOutcome: string }): Promise<void> {
    try {
      const prediction = await prisma.botPrediction.findUnique({
        where: { id: trade.id },
        select: { snapshotId: true }
      });
      if (!prediction) return;

      const snapshot = await prisma.marketSnapshot.findUnique({
        where: { id: prediction.snapshotId },
        select: { currentAssetPrice: true, targetPrice: true, createdAt: true }
      });
      if (!snapshot?.currentAssetPrice) return;

      const market = await prisma.market.findUnique({
        where: { id: trade.marketId },
        select: { endDate: true, slug: true }
      });
      if (!market?.endDate) return;

      const chainlinkClose = await this.targetResolver.resolveChainlinkPriceAt(
        trade.assetSymbol,
        market.endDate,
        15_000
      );

      if (chainlinkClose.price === null) {
        this.logger?.info("Price comparison: Chainlink close price unavailable.", {
          tradeId: trade.id,
          assetSymbol: trade.assetSymbol
        });
        return;
      }

      const snapshotPrice = Number(snapshot.currentAssetPrice);
      const targetPrice = Number(snapshot.targetPrice);
      const chainlinkPrice = chainlinkClose.price;
      const discrepancy = snapshotPrice - chainlinkPrice;
      const discrepancyBps = targetPrice !== 0 ? (discrepancy / targetPrice) * 10000 : 0;

      this.logger.info("PRICE_COMPARISON_SNAPSHOT_VS_CHAINLINK", {
        tradeId: trade.id,
        assetSymbol: trade.assetSymbol,
        timeframe: trade.timeframe,
        snapshotPrice: snapshotPrice.toFixed(6),
        chainlinkClosePrice: chainlinkPrice.toFixed(6),
        targetPrice: targetPrice.toFixed(6),
        discrepancyAbs: discrepancy.toFixed(6),
        discrepancyBps: discrepancyBps.toFixed(2),
        snapshotTime: snapshot.createdAt.toISOString(),
        marketEnd: market.endDate.toISOString(),
        predictedOutcome: trade.predictedOutcome
      });
    } catch (error) {
      this.logger?.debug("Price comparison logging failed.", { tradeId: trade.id, error: String(error) });
    }
  }
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
