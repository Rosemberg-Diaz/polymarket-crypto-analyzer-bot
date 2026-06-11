import { prisma } from "../src/database/client";
import { LearningService } from "../src/modules/learning/learning.service";

const predictionId =
  process.argv.find((value) => value.startsWith("--prediction="))?.split("=")[1] ??
  "cmq8f7hy600rz5ugwl3fusw54";

async function main(): Promise<void> {
  const prediction = await prisma.botPrediction.findUnique({
    where: { id: predictionId },
    include: {
      snapshot: true,
      market: true
    }
  });

  if (!prediction) {
    throw new Error(`Prediction not found: ${predictionId}`);
  }

  const storedFeatures = parseFeatures(prediction.features);
  const observation = await prisma.observationEvaluation.findUnique({
    where: {
      predictionId
    },
    select: {
      status: true,
      observationType: true,
      wouldWin: true,
      hypotheticalProfit: true,
      hypotheticalRoi: true,
      resolutionSource: true
    }
  });
  const matchingResolvedObservations = await prisma.observationEvaluation.findMany({
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
        strategyName: prediction.strategyName,
        marketType: prediction.marketType,
        assetSymbol: prediction.assetSymbol,
        predictedOutcome: prediction.predictedOutcome
      }
    },
    select: {
      id: true,
      predictionId: true,
      entryPrice: true,
      prediction: {
        select: {
          features: true,
          snapshot: true,
          market: {
            select: {
              timeframe: true
            }
          }
        }
      }
    }
  });
  const matchingResolvedTrades = await prisma.simulatedTrade.findMany({
    where: {
      status: "RESOLVED",
      prediction: {
        strategyName: prediction.strategyName,
        marketType: prediction.marketType,
        assetSymbol: prediction.assetSymbol,
        predictedOutcome: prediction.predictedOutcome
      }
    },
    select: {
      id: true,
      predictionId: true,
      entryPrice: true,
      isWin: true,
      profit: true,
      prediction: {
        select: {
          features: true,
          snapshot: true,
          market: {
            select: {
              timeframe: true
            }
          }
        }
      }
    }
  });
  const performance = await new LearningService().findSimilarHistoricalPerformance({
    strategyName: prediction.strategyName,
    marketType: prediction.marketType,
    assetSymbol: prediction.assetSymbol,
    predictedOutcome: prediction.predictedOutcome,
    entryPrice: Number(prediction.entryPrice),
    secondsToClose: prediction.snapshot.secondsToClose,
    distanceToTarget:
      prediction.snapshot.distanceToTarget === null
        ? null
        : Number(prediction.snapshot.distanceToTarget),
    spread:
      prediction.snapshot.spread === null ? null : Number(prediction.snapshot.spread),
    liquidity:
      prediction.snapshot.liquidity === null
        ? null
        : Number(prediction.snapshot.liquidity),
    timeframe: prediction.market.timeframe
  });

  console.log(
    JSON.stringify(
      {
        predictionId,
        assetSymbol: prediction.assetSymbol,
        predictedOutcome: prediction.predictedOutcome,
        storedSimilarCases: storedFeatures.similarCases ?? null,
        storedEligibility: {
          targetPriceSource: storedFeatures.targetPriceSource ?? null,
          targetPriceTrustedForLearning:
            storedFeatures.targetPriceTrustedForLearning ?? null,
          distancePercent:
            storedFeatures.distancePercent ??
            storedFeatures.distanceToTargetPercent ??
            null,
          secondsToClose: prediction.snapshot.secondsToClose,
          distanceToTarget:
            prediction.snapshot.distanceToTarget === null
              ? null
              : Number(prediction.snapshot.distanceToTarget),
          spread:
            prediction.snapshot.spread === null
              ? null
              : Number(prediction.snapshot.spread),
          liquidity:
            prediction.snapshot.liquidity === null
              ? null
              : Number(prediction.snapshot.liquidity)
        },
        observation,
        matchingResolvedTradePool: matchingResolvedTrades.length,
        matchingResolvedObservationPool: matchingResolvedObservations.length,
        recomputedPerformance: performance
      },
      null,
      2
    )
  );
}

function parseFeatures(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
