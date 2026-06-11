import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Features {
  baseRecommendation?: string;
  baseEntryRule?: string;
  finalRecommendation?: string;
  finalEntryRule?: string;
  entryRule?: string;
  similarCases?: number;
  historicalWinRate?: number;
  historicalProfit?: number;
  blockedReason?: string;
  blockedByHistoricalGate?: boolean;
  secondsToClose?: number;
  spread?: number;
  liquidity?: number;
}

function parseFeatures(value: string | null): Features {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Features;
  } catch {
    return {};
  }
}

function gateFailures(
  recommendation: string,
  predictedOutcome: string,
  entryPrice: number,
  features: Features
): string[] {
  const failures: string[] = [];
  const entryRule = features.finalEntryRule ?? features.entryRule ?? "NONE";

  if (!["ENTER_SMALL", "ENTER_MODERATE"].includes(recommendation)) failures.push("recommendation");
  if (!entryRule.startsWith("ENTER_")) failures.push("entryRule");
  if (features.blockedByHistoricalGate === true) failures.push(features.blockedReason ?? "historicalGate");
  if ((features.similarCases ?? -1) < 5) failures.push(`similarCases:${features.similarCases ?? "null"}/5`);
  if ((features.historicalWinRate ?? -1) < 0.6) {
    failures.push(`winRate:${features.historicalWinRate ?? "null"}/0.60`);
  }
  if ((features.historicalProfit ?? 0) <= 0) {
    failures.push(`historicalProfit:${features.historicalProfit ?? "null"}`);
  }
  if ((features.secondsToClose ?? -1) < 20 || (features.secondsToClose ?? 999) > 210) {
    failures.push(`secondsToClose:${features.secondsToClose ?? "null"}`);
  }
  if ((features.spread ?? 999) > 0.05) failures.push(`spread:${features.spread ?? "null"}/0.05`);
  if ((features.liquidity ?? -1) < 100) failures.push(`liquidity:${features.liquidity ?? "null"}/100`);
  if (entryPrice <= 0.05 || entryPrice >= 0.95) failures.push(`entryPrice:${entryPrice}`);
  if (
    predictedOutcome === "DOWN" &&
    entryPrice < 0.6 &&
    (features.secondsToClose ?? 0) > 180
  ) {
    failures.push("cheapDownEarly");
  }

  return failures;
}

function closenessScore(failures: string[]): number {
  return failures.reduce((score, failure) => {
    if (failure === "recommendation" || failure === "entryRule") return score + 2;
    if (failure.includes("INSUFFICIENT_SIMILAR_CASES")) return score + 1;
    return score + 1;
  }, 0);
}

async function main(): Promise<void> {
  const fromArg = process.argv.find((value) => value.startsWith("--from="));
  const from = fromArg ? new Date(fromArg.slice("--from=".length)) : null;
  const predictions = await prisma.botPrediction.findMany({
    where: from
      ? {
          createdAt: {
            gte: from
          }
        }
      : undefined,
    include: {
      market: { select: { question: true, slug: true } },
      simulatedTrades: { orderBy: { createdAt: "desc" }, take: 1 },
      realOrders: { orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: { createdAt: "desc" },
    take: from ? undefined : 100
  });

  const candidates = predictions.map((prediction) => {
    const features = parseFeatures(prediction.features);
    const failures = gateFailures(
      prediction.recommendation,
      prediction.predictedOutcome,
      Number(prediction.entryPrice),
      features
    );

    return {
      predictionId: prediction.id,
      createdAt: prediction.createdAt.toISOString(),
      market: prediction.market.question,
      asset: prediction.assetSymbol,
      outcome: prediction.predictedOutcome,
      recommendation: prediction.recommendation,
      baseRecommendation: features.baseRecommendation ?? null,
      baseEntryRule: features.baseEntryRule ?? null,
      finalEntryRule: features.finalEntryRule ?? features.entryRule ?? null,
      entryPrice: Number(prediction.entryPrice),
      edge: Number(prediction.edge ?? 0),
      similarCases: features.similarCases ?? null,
      historicalWinRate: features.historicalWinRate ?? null,
      historicalProfit: features.historicalProfit ?? null,
      secondsToClose: features.secondsToClose ?? null,
      failures,
      wouldPassFinalGate: failures.length === 0,
      closenessScore: closenessScore(failures),
      simulatedTrade: prediction.simulatedTrades[0]
        ? {
            id: prediction.simulatedTrades[0].id,
            status: prediction.simulatedTrades[0].status,
            profit: prediction.simulatedTrades[0].profit?.toString() ?? null
          }
        : null,
      realOrder: prediction.realOrders[0]
        ? {
            id: prediction.realOrders[0].id,
            status: prediction.realOrders[0].status,
            externalOrderId: prediction.realOrders[0].externalOrderId
          }
        : null
    };
  });

  const baseEntryCandidates = candidates.filter(
    (row) => row.baseEntryRule?.startsWith("ENTER_") || row.finalEntryRule?.startsWith("ENTER_")
  );
  const latestTrades = candidates.filter((row) => row.simulatedTrade !== null).slice(0, 15);
  const closestBlocked = baseEntryCandidates
    .filter((row) => !row.wouldPassFinalGate)
    .sort(
      (left, right) =>
        left.closenessScore - right.closenessScore ||
        right.createdAt.localeCompare(left.createdAt)
    )
    .slice(0, 15);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        from: from?.toISOString() ?? null,
        predictionsAnalyzed: predictions.length,
        latestTrades,
        passingCandidates: baseEntryCandidates.filter((row) => row.wouldPassFinalGate).slice(0, 15),
        closestBlocked
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
