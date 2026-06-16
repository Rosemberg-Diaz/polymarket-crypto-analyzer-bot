import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const STRATEGY_VERSION = "EARLY_WINDOW_TP2_V2";
const MIN_CASES_PER_TRIGGER = 30;

interface PerformanceRow {
  stake: number;
  profit: number;
  roi: number;
  isWin: boolean;
}

async function main(): Promise<void> {
  const observations = await prisma.shortTermExitObservation.findMany({
    where: { strategyVersion: STRATEGY_VERSION },
    include: {
      exitScenarios: true,
      _count: {
        select: {
          quotes: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const settled = observations.filter((row) => row.status !== "OPEN");
  const actualPerformance = settled.map(toConservativePerformance);
  const triggers = Array.from(
    new Set(observations.map((row) => row.entryTrigger ?? "UNKNOWN"))
  );
  const byTrigger = Object.fromEntries(
    triggers.map((trigger) => {
      const rows = observations.filter(
        (row) => (row.entryTrigger ?? "UNKNOWN") === trigger
      );
      const settledRows = rows.filter((row) => row.status !== "OPEN");
      return [
        trigger,
        {
          observations: rows.length,
          open: rows.length - settledRows.length,
          ...summarize(settledRows.map(toConservativePerformance)),
          sampleStatus: settledRows.length >= MIN_CASES_PER_TRIGGER
            ? "ENOUGH_FOR_REVIEW"
            : `COLLECTING_DATA_${settledRows.length}_OF_${MIN_CASES_PER_TRIGGER}`
        }
      ];
    })
  );

  const scenarioRows = observations.flatMap((row) =>
    row.exitScenarios.map((scenario) => ({
      ...scenario,
      observationStake: Number(row.stake)
    }))
  );
  const scenarioThresholds = Array.from(
    new Set(scenarioRows.map((row) => row.thresholdSeconds))
  ).sort((left, right) => right - left);
  const hypotheticalExits = Object.fromEntries(
    scenarioThresholds.map((threshold) => {
      const rows = scenarioRows.filter(
        (row) => row.thresholdSeconds === threshold && row.status === "RESOLVED"
      );
      return [
        `${threshold}s`,
        {
          ...summarize(
            rows.map((row) => ({
              stake: row.observationStake,
              profit: Number(row.profit ?? -row.observationStake),
              roi: Number(row.roi ?? -1),
              isWin: Number(row.profit ?? -row.observationStake) > 0
            }))
          ),
          exitReasons: countBy(rows.map((row) => row.exitReason ?? "UNKNOWN"))
        }
      ];
    })
  );

  const result = {
    generatedAt: new Date().toISOString(),
    strategyVersion: STRATEGY_VERSION,
    minimumCasesPerTrigger: MIN_CASES_PER_TRIGGER,
    observations: observations.length,
    open: observations.filter((row) => row.status === "OPEN").length,
    closed: observations.filter((row) => row.status === "CLOSED").length,
    noExit: observations.filter((row) => row.status === "NO_EXIT").length,
    quotes: observations.reduce((sum, row) => sum + row._count.quotes, 0),
    conservativeActualPerformance: {
      ...summarize(actualPerformance),
      note: "NO_EXIT counts as full stake loss; OPEN observations are excluded."
    },
    byTrigger,
    hypotheticalExits
  };

  console.log(JSON.stringify(result, null, 2));
}

function toConservativePerformance(
  row: {
    status: string;
    stake: unknown;
    profit: unknown;
    roi: unknown;
  }
): PerformanceRow {
  const stake = Number(row.stake);
  const profit = row.status === "NO_EXIT" ? -stake : Number(row.profit ?? -stake);
  const roi = row.status === "NO_EXIT" ? -1 : Number(row.roi ?? -1);
  return {
    stake,
    profit,
    roi,
    isWin: profit > 0
  };
}

function summarize(rows: PerformanceRow[]) {
  const wins = rows.filter((row) => row.isWin).length;
  const losses = rows.length - wins;
  return {
    settled: rows.length,
    wins,
    losses,
    winRate: round6(rows.length === 0 ? 0 : wins / rows.length),
    profit: round6(rows.reduce((sum, row) => sum + row.profit, 0)),
    averageRoi: round6(
      rows.length === 0
        ? 0
        : rows.reduce((sum, row) => sum + row.roi, 0) / rows.length
    ),
    totalStake: round6(rows.reduce((sum, row) => sum + row.stake, 0))
  };
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
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
