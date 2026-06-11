import { prisma } from "../src/database/client";
import { ResolveObservationEvaluationsJob } from "../src/modules/jobs/resolve-observation-evaluations.job";
import { LoggerService } from "../src/modules/logger/logger.service";

async function main(): Promise<void> {
  const logger = new LoggerService("info");
  const before = await getHistoricalGateSummary();

  await new ResolveObservationEvaluationsJob(logger).runOnce();

  const after = await getHistoricalGateSummary();
  console.log(JSON.stringify({ before, after }, null, 2));
}

async function getHistoricalGateSummary() {
  const rows = await prisma.observationEvaluation.findMany({
    where: {
      observationType: {
        startsWith: "OBSERVE_HISTORICAL_GATE_"
      }
    },
    select: {
      status: true,
      wouldWin: true,
      hypotheticalProfit: true,
      observationType: true,
      prediction: {
        select: {
          assetSymbol: true
        }
      }
    }
  });

  const resolved = rows.filter(
    (row) =>
      row.status === "RESOLVED" &&
      row.wouldWin !== null &&
      row.hypotheticalProfit !== null
  );
  const wins = resolved.filter((row) => row.wouldWin === true).length;
  const totalProfit = resolved.reduce(
    (sum, row) => sum + Number(row.hypotheticalProfit ?? 0),
    0
  );

  return {
    statuses: countBy(rows, (row) => row.status),
    resolved: resolved.length,
    wins,
    losses: resolved.length - wins,
    winRate: resolved.length === 0 ? 0 : round6(wins / resolved.length),
    totalProfit: round6(totalProfit),
    byAsset: countBy(resolved, (row) => row.prediction.assetSymbol),
    byObservationType: countBy(resolved, (row) => row.observationType)
  };
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    const value = key(row);
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function round6(value: number): number {
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
