import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";

export interface SimilarHistoricalPerformanceFeatures {
  strategyName: string;
  marketType: string;
  assetSymbol: string;
  predictedOutcome: string;
  entryPrice: number | null;
  secondsToClose: number | null;
  distanceToTarget: number | null;
  spread: number | null;
  liquidity: number | null;
  timeframe: string | null;
}

export interface SimilarHistoricalPerformance {
  totalSimilarCases: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  averageRoi: number;
  confidenceAdjustment: number;
  historicalSummary: string;
}

const MIN_SIMILAR_CASES = 20;

export class LearningService {
  isEnabled(): boolean {
    return true;
  }

  getMinimumResolvedTrades(): number {
    return MIN_SIMILAR_CASES;
  }

  async findSimilarHistoricalPerformance(
    features: SimilarHistoricalPerformanceFeatures
  ): Promise<SimilarHistoricalPerformance> {
    const resolvedTrades = await prisma.simulatedTrade.findMany({
      where: {
        status: "RESOLVED",
        prediction: {
          strategyName: features.strategyName,
          marketType: features.marketType,
          assetSymbol: features.assetSymbol,
          predictedOutcome: features.predictedOutcome
        }
      },
      include: {
        prediction: {
          include: {
            snapshot: true,
            market: true
          }
        }
      },
      orderBy: {
        resolvedAt: "desc"
      },
      take: 500
    });

    const similarTrades = resolvedTrades.filter((trade) =>
      isSimilarTrade(features, {
        entryPrice: Number(trade.entryPrice),
        secondsToClose: trade.prediction.snapshot.secondsToClose,
        distanceToTarget:
          trade.prediction.snapshot.distanceToTarget === null
            ? null
            : Number(trade.prediction.snapshot.distanceToTarget),
        spread: trade.prediction.snapshot.spread === null ? null : Number(trade.prediction.snapshot.spread),
        liquidity:
          trade.prediction.snapshot.liquidity === null ? null : Number(trade.prediction.snapshot.liquidity),
        timeframe: trade.prediction.market.timeframe
      })
    );

    const totalSimilarCases = similarTrades.length;
    const wins = similarTrades.filter((trade) => trade.isWin === true).length;
    const losses = similarTrades.filter((trade) => trade.isWin === false).length;
    const totalProfit = round6(
      similarTrades.reduce((sum, trade) => sum + Number(trade.profit ?? new Prisma.Decimal(0)), 0)
    );
    const averageRoi =
      totalSimilarCases === 0
        ? 0
        : round6(similarTrades.reduce((sum, trade) => sum + Number(trade.roi ?? new Prisma.Decimal(0)), 0) / totalSimilarCases);
    const winRate = totalSimilarCases === 0 ? 0 : round6(wins / totalSimilarCases);
    const confidenceAdjustment = getConfidenceAdjustment(totalSimilarCases, winRate, totalProfit);

    return {
      totalSimilarCases,
      wins,
      losses,
      winRate,
      totalProfit,
      averageRoi,
      confidenceAdjustment,
      historicalSummary: buildHistoricalSummary(totalSimilarCases, winRate, totalProfit)
    };
  }
}

function isSimilarTrade(
  target: SimilarHistoricalPerformanceFeatures,
  candidate: {
    entryPrice: number | null;
    secondsToClose: number | null;
    distanceToTarget: number | null;
    spread: number | null;
    liquidity: number | null;
    timeframe: string | null;
  }
): boolean {
  return (
    candidate.timeframe === target.timeframe &&
    isWithinRelativeRange(target.entryPrice, candidate.entryPrice, 0.15, 0.08) &&
    isWithinRelativeRange(target.secondsToClose, candidate.secondsToClose, 0.35, 45) &&
    isWithinRelativeRange(target.distanceToTarget, candidate.distanceToTarget, 0.5, 25) &&
    isWithinRelativeRange(target.spread, candidate.spread, 0.5, 0.02) &&
    isWithinRelativeRange(target.liquidity, candidate.liquidity, 0.5, 100)
  );
}

function isWithinRelativeRange(
  target: number | null,
  candidate: number | null,
  relativeTolerance: number,
  absoluteTolerance: number
): boolean {
  if (target === null || candidate === null) {
    return true;
  }

  const absoluteDiff = Math.abs(target - candidate);
  const relativeDiff = Math.abs(target) > 0 ? absoluteDiff / Math.abs(target) : absoluteDiff;

  return absoluteDiff <= absoluteTolerance || relativeDiff <= relativeTolerance;
}

function getConfidenceAdjustment(totalSimilarCases: number, winRate: number, totalProfit: number): number {
  if (totalSimilarCases < MIN_SIMILAR_CASES) {
    return 0;
  }

  if (winRate > 0.6 && totalProfit > 0) {
    return 0.04;
  }

  if (winRate < 0.48 || totalProfit < 0) {
    return -0.05;
  }

  if (winRate >= 0.54 && totalProfit >= 0) {
    return 0.01;
  }

  return 0;
}

function buildHistoricalSummary(totalSimilarCases: number, winRate: number, totalProfit: number): string {
  if (totalSimilarCases < MIN_SIMILAR_CASES) {
    return `Esta senal se parece a ${totalSimilarCases} casos anteriores. Aun no hay suficientes casos similares para ajustar confianza.`;
  }

  return `Esta senal se parece a ${totalSimilarCases} casos anteriores. Historicamente gano ${round6(
    winRate * 100
  )}% y produjo ${round6(totalProfit)} de profit simulado.`;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
