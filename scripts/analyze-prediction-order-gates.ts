import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const from = new Date(process.argv[2] ?? "2026-06-14T05:00:00.000Z");
  const predictions = await prisma.botPrediction.findMany({
    where: { createdAt: { gte: from } },
    select: {
      recommendation: true,
      assetSymbol: true,
      strategyName: true,
      reason: true,
      historicalSummary: true,
      features: true
    }
  });
  const realOrders = await prisma.realOrder.findMany({
    where: { createdAt: { gte: from } },
    select: { status: true, errorMessage: true }
  });

  const parsed = predictions.map((prediction) => ({
    ...prediction,
    feature: parseJson(prediction.features)
  }));
  const baseEntries = parsed.filter((row) =>
    ["ENTER_SMALL", "ENTER_MODERATE"].includes(String(row.feature.baseRecommendation))
  );

  console.log(JSON.stringify({
    from: from.toISOString(),
    predictions: predictions.length,
    recommendations: countBy(parsed, (row) => row.recommendation),
    strategies: countBy(parsed, (row) => row.strategyName),
    baseEntries: baseEntries.length,
    baseEntryRules: countBy(baseEntries, (row) => String(row.feature.baseEntryRule ?? "UNKNOWN")),
    finalEntryRules: countBy(baseEntries, (row) => String(row.feature.finalEntryRule ?? "UNKNOWN")),
    blockedReasons: countBy(
      baseEntries.filter((row) => row.feature.blockedByHistoricalGate === true),
      (row) => String(row.feature.blockedReason ?? "UNKNOWN")
    ),
    baseEntriesByAsset: countBy(baseEntries, (row) => row.assetSymbol),
    actionableFinalSignals: parsed.filter((row) =>
      ["ENTER_SMALL", "ENTER_MODERATE"].includes(row.recommendation)
    ).length,
    operationalPredictions: parsed
      .filter((row) => row.strategyName !== "OUTCOME_CHECKPOINT_V1")
      .map((row) => ({
        assetSymbol: row.assetSymbol,
        recommendation: row.recommendation,
        baseRecommendation: row.feature.baseRecommendation ?? null,
        baseEntryRule: row.feature.baseEntryRule ?? null,
        finalEntryRule: row.feature.finalEntryRule ?? null,
        blockedByHistoricalGate: row.feature.blockedByHistoricalGate ?? null,
        blockedReason: row.feature.blockedReason ?? null,
        similarCases: row.feature.similarCases ?? null,
        historicalWinRate: row.feature.historicalWinRate ?? null,
        historicalProfit: row.feature.historicalProfit ?? null,
        secondsToClose: row.feature.secondsToClose ?? null,
        edge: row.feature.edge ?? null
        ,
        reason: row.reason,
        historicalSummary: row.historicalSummary
      })),
    realOrders: {
      total: realOrders.length,
      statuses: countBy(realOrders, (row) => row.status),
      failures: countBy(
        realOrders.filter((row) => row.status === "FAILED"),
        (row) => row.errorMessage ?? "UNKNOWN"
      )
    }
  }, null, 2));
}

function parseJson(value: string | null): Record<string, unknown> {
  try {
    return value ? JSON.parse(value) as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function countBy<T>(rows: T[], keyOf: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    const key = keyOf(row);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
