import { prisma } from "../src/database/client";
import { HIGHER_TIMEFRAME_OUTCOME_STRATEGY } from "../src/modules/jobs/higher-timeframe-outcome-observation.job";

async function main(): Promise<void> {
  const predictions = await loadPredictions();

  const groups = new Map<string, typeof predictions>();
  for (const prediction of predictions) {
    const checkpoint = readCheckpoint(prediction.features);
    const key =
      `${prediction.market.timeframe ?? "unknown"}:` +
      `${prediction.assetSymbol}:${prediction.predictedOutcome}:` +
      `${checkpoint ?? "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), prediction]);
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    strategy: HIGHER_TIMEFRAME_OUTCOME_STRATEGY,
    totals: summarize(predictions),
    byRule: Object.fromEntries(
      [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, rows]) => [key, summarize(rows)])
    ),
    markets: [...new Set(predictions.map((row) => row.market.slug))]
  }, null, 2));
}

function loadPredictions() {
  return prisma.botPrediction.findMany({
    where: { strategyName: HIGHER_TIMEFRAME_OUTCOME_STRATEGY },
    include: {
      market: { select: { timeframe: true, slug: true } },
      observationEvaluation: true,
      mlOutcomeShadowExecution: true
    },
    orderBy: { createdAt: "asc" }
  });
}

function summarize(rows: Awaited<ReturnType<typeof loadPredictions>>) {
  const observations = rows
    .map((row) => row.observationEvaluation)
    .filter((row) => row?.status === "RESOLVED" && row.hypotheticalProfit !== null);
  const executable = rows
    .map((row) => row.mlOutcomeShadowExecution)
    .filter((row) => row?.status === "RESOLVED" && row.profit !== null);
  const acceptedShadow = rows.filter(
    (row) =>
      row.mlOutcomeShadowExecution?.status === "PENDING" ||
      row.mlOutcomeShadowExecution?.status === "RESOLVED"
  );

  return {
    predictions: rows.length,
    resolvedObservations: observations.length,
    observationWins: observations.filter((row) => row?.wouldWin === true).length,
    observationAccuracy:
      observations.length === 0
        ? 0
        : round(
            observations.filter((row) => row?.wouldWin === true).length /
              observations.length
          ),
    observationProfit: round(
      observations.reduce(
        (sum, row) => sum + Number(row?.hypotheticalProfit ?? 0),
        0
      )
    ),
    executableCandidates: acceptedShadow.length,
    resolvedExecutable: executable.length,
    executableWins: executable.filter((row) => row?.isWin === true).length,
    executableProfit: round(
      executable.reduce((sum, row) => sum + Number(row?.profit ?? 0), 0)
    ),
    pending: rows.length - observations.length
  };
}

function readCheckpoint(features: string | null): number | null {
  try {
    const parsed = JSON.parse(features ?? "{}") as Record<string, unknown>;
    return typeof parsed.checkpointSeconds === "number"
      ? parsed.checkpointSeconds
      : null;
  } catch {
    return null;
  }
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
