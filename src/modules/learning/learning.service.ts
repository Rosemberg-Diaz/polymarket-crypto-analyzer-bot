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

const MIN_SIMILAR_CASES = 5;
const MAX_HISTORICAL_TRADES_TO_SCAN = 1_000;

interface HistoricalCase {
  isWin: boolean;
  profit: number;
  roi: number;
  entryPrice: number;
  prediction: {
    features: string | null;
    snapshot: {
      secondsToClose: number | null;
      distanceToTarget: Prisma.Decimal | null;
      spread: Prisma.Decimal | null;
      liquidity: Prisma.Decimal | null;
    };
    market: {
      timeframe: string | null;
    };
  };
}

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
    const [resolvedTrades, resolvedHistoricalGateObservations] = await Promise.all([
      prisma.simulatedTrade.findMany({
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
        take: MAX_HISTORICAL_TRADES_TO_SCAN
      }),
      prisma.observationEvaluation.findMany({
        where: {
          status: "RESOLVED",
          observationType: {
            startsWith: "OBSERVE_HISTORICAL_GATE_"
          },
          wouldWin: {
            not: null
          },
          hypotheticalProfit: {
            not: null
          },
          hypotheticalRoi: {
            not: null
          },
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
        take: MAX_HISTORICAL_TRADES_TO_SCAN
      })
    ]);

    const historicalCases: HistoricalCase[] = [
      ...resolvedTrades.flatMap((trade) =>
        trade.isWin === null || trade.profit === null || trade.roi === null
          ? []
          : [{
              isWin: trade.isWin,
              profit: Number(trade.profit),
              roi: Number(trade.roi),
              entryPrice: Number(trade.entryPrice),
              prediction: trade.prediction
            }]
      ),
      ...resolvedHistoricalGateObservations.flatMap((observation) =>
        observation.wouldWin === null ||
        observation.hypotheticalProfit === null ||
        observation.hypotheticalRoi === null
          ? []
          : [{
              isWin: observation.wouldWin,
              profit: Number(observation.hypotheticalProfit),
              roi: Number(observation.hypotheticalRoi),
              entryPrice: Number(observation.entryPrice),
              prediction: observation.prediction
            }]
      )
    ];

    const similarTrades = historicalCases.filter((trade) => {
      const parsedFeatures = parsePredictionFeatures(trade.prediction.features);

      return (
        parsedFeatures !== null &&
        isEligibleHistoricalTrade(parsedFeatures) &&
        isSimilarTrade(features, {
          entryPrice: trade.entryPrice,
          secondsToClose: trade.prediction.snapshot.secondsToClose,
          distanceToTarget:
            trade.prediction.snapshot.distanceToTarget === null
              ? null
              : Number(trade.prediction.snapshot.distanceToTarget),
          spread: trade.prediction.snapshot.spread === null ? null : Number(trade.prediction.snapshot.spread),
          liquidity:
            trade.prediction.snapshot.liquidity === null ? null : Number(trade.prediction.snapshot.liquidity),
          timeframe: trade.prediction.market.timeframe,
          features: parsedFeatures
        })
      );
    });

    const totalSimilarCases = similarTrades.length;
    const wins = similarTrades.filter((trade) => trade.isWin === true).length;
    const losses = similarTrades.filter((trade) => trade.isWin === false).length;

    const totalProfit = round6(
      similarTrades.reduce((sum, trade) => sum + trade.profit, 0)
    );

    const averageRoi =
      totalSimilarCases === 0
        ? 0
        : round6(
            similarTrades.reduce((sum, trade) => sum + trade.roi, 0) /
              totalSimilarCases
          );

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
      historicalSummary: buildHistoricalSummary(totalSimilarCases, wins, losses, winRate, totalProfit, averageRoi)
    };
  }
}

function parsePredictionFeatures(featuresJson: string | null): Record<string, unknown> | null {
  if (!featuresJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(featuresJson) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isEligibleHistoricalTrade(features: Record<string, unknown>): boolean {
  const source = features.targetPriceSource;
  const trusted = features.targetPriceTrustedForLearning;
  const distancePercent = readNumberFeature(features, "distancePercent", "distanceToTargetPercent");

  return (
    trusted === true &&
    ["POLYMARKET_CRYPTO_PRICE_API", "POLYMARKET_RTDS_CHAINLINK", "POLYMARKET_UMA_ANCILLARY"].includes(
      typeof source === "string" ? source : ""
    ) &&
    distancePercent !== null &&
    Math.abs(distancePercent) <= 0.1
  );
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
    features: Record<string, unknown>;
  }
): boolean {
  const candidateDistancePercent = readNumberFeature(
    candidate.features,
    "distancePercent",
    "distanceToTargetPercent"
  );

  const targetDistanceSign = getSign(target.distanceToTarget);
  const candidateDistanceSign = getSign(candidate.distanceToTarget);

  return (
    candidate.timeframe === target.timeframe &&
    hasSameEntryPriceRegime(target.entryPrice, candidate.entryPrice) &&
    hasSameTimeRegime(target.secondsToClose, candidate.secondsToClose) &&
    hasCompatibleDistanceSign(targetDistanceSign, candidateDistanceSign) &&
    isWithinRelativeRange(target.entryPrice, candidate.entryPrice, 0.12, 0.06, false) &&
    isWithinRelativeRange(target.secondsToClose, candidate.secondsToClose, 0.25, 30, false) &&
    isWithinRelativeRange(target.distanceToTarget, candidate.distanceToTarget, 0.45, 20, true) &&
    isWithinRelativeRange(target.spread, candidate.spread, 0.5, 0.02, true) &&
    isWithinRelativeRange(target.liquidity, candidate.liquidity, 0.5, 100, true) &&
    isValidCandidateDistancePercent(candidateDistancePercent)
  );
}

function hasSameEntryPriceRegime(target: number | null, candidate: number | null): boolean {
  if (target === null || candidate === null) {
    return false;
  }

  return getEntryPriceRegime(target) === getEntryPriceRegime(candidate);
}

function getEntryPriceRegime(entryPrice: number): "VERY_CHEAP" | "CHEAP" | "MID" | "HIGH" | "VERY_HIGH" {
  if (entryPrice < 0.35) {
    return "VERY_CHEAP";
  }

  if (entryPrice < 0.5) {
    return "CHEAP";
  }

  if (entryPrice < 0.7) {
    return "MID";
  }

  if (entryPrice <= 0.82) {
    return "HIGH";
  }

  return "VERY_HIGH";
}

function hasSameTimeRegime(target: number | null, candidate: number | null): boolean {
  if (target === null || candidate === null) {
    return false;
  }

  return getTimeRegime(target) === getTimeRegime(candidate);
}

function getTimeRegime(secondsToClose: number): "LAST_SECONDS" | "LATE" | "MID" | "EARLY" | "VERY_EARLY" {
  if (secondsToClose <= 30) {
    return "LAST_SECONDS";
  }

  if (secondsToClose <= 120) {
    return "LATE";
  }

  if (secondsToClose <= 180) {
    return "MID";
  }

  if (secondsToClose <= 240) {
    return "EARLY";
  }

  return "VERY_EARLY";
}

function hasCompatibleDistanceSign(
  targetSign: "POSITIVE" | "NEGATIVE" | "ZERO" | "UNKNOWN",
  candidateSign: "POSITIVE" | "NEGATIVE" | "ZERO" | "UNKNOWN"
): boolean {
  if (targetSign === "UNKNOWN" || candidateSign === "UNKNOWN") {
    return true;
  }

  if (targetSign === "ZERO" || candidateSign === "ZERO") {
    return true;
  }

  return targetSign === candidateSign;
}

function getSign(value: number | null): "POSITIVE" | "NEGATIVE" | "ZERO" | "UNKNOWN" {
  if (value === null || !Number.isFinite(value)) {
    return "UNKNOWN";
  }

  if (Math.abs(value) < 0.000001) {
    return "ZERO";
  }

  return value > 0 ? "POSITIVE" : "NEGATIVE";
}

function isValidCandidateDistancePercent(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && Math.abs(value) <= 0.1;
}

function isWithinRelativeRange(
  target: number | null,
  candidate: number | null,
  relativeTolerance: number,
  absoluteTolerance: number,
  allowMissing: boolean
): boolean {
  if (target === null || candidate === null) {
    return allowMissing;
  }

  const absoluteDiff = Math.abs(target - candidate);
  const relativeDiff = Math.abs(target) > 0 ? absoluteDiff / Math.abs(target) : absoluteDiff;
  const toleranceEpsilon = Number.EPSILON * Math.max(1, Math.abs(target), Math.abs(candidate));

  return (
    absoluteDiff <= absoluteTolerance + toleranceEpsilon ||
    relativeDiff <= relativeTolerance + toleranceEpsilon
  );
}

function readNumberFeature(features: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = features[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
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

function buildHistoricalSummary(
  totalSimilarCases: number,
  wins: number,
  losses: number,
  winRate: number,
  totalProfit: number,
  averageRoi: number
): string {
  if (totalSimilarCases < MIN_SIMILAR_CASES) {
    return [
      `Esta senal se parece a ${totalSimilarCases} casos anteriores.`,
      `Aun no hay suficientes casos similares para ajustar confianza.`,
      `Minimo requerido: ${MIN_SIMILAR_CASES}.`
    ].join(" ");
  }

  return [
    `Esta senal se parece a ${totalSimilarCases} casos anteriores.`,
    `Historicamente gano ${round6(winRate * 100)}%.`,
    `Wins: ${wins}.`,
    `Losses: ${losses}.`,
    `Profit simulado: ${round6(totalProfit)}.`,
    `ROI promedio: ${round6(averageRoi)}.`
  ].join(" ");
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
