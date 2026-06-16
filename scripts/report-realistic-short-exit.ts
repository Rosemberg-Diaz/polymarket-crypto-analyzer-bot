import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const executions = await prisma.realisticShortExitExecution.findMany({
    include: {
      fills: true,
      observation: {
        select: {
          entryTrigger: true,
          strategyVersion: true,
          profit: true,
          status: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  const resolved = executions.filter((row) => row.status === "RESOLVED");
  const profit = resolved.reduce((sum, row) => sum + Number(row.profit ?? 0), 0);
  const comparison = resolved.reduce(
    (summary, row) => {
      if (row.observation.status === "CLOSED" && row.observation.profit !== null) {
        summary.comparable += 1;
        summary.originalProfit += Number(row.observation.profit);
        summary.realisticProfit += Number(row.profit ?? 0);
      }
      return summary;
    },
    { comparable: 0, originalProfit: 0, realisticProfit: 0 }
  );

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    executions: executions.length,
    statuses: countBy(executions.map((row) => row.status)),
    resolved: resolved.length,
    wins: resolved.filter((row) => Number(row.profit) > 0).length,
    losses: resolved.filter((row) => Number(row.profit) <= 0).length,
    profit: round6(profit),
    averageRoi: round6(
      resolved.length === 0
        ? 0
        : resolved.reduce((sum, row) => sum + Number(row.roi ?? 0), 0) / resolved.length
    ),
    buyFills: executions.reduce(
      (sum, row) => sum + row.fills.filter((fill) => fill.side === "BUY").length,
      0
    ),
    sellFills: executions.reduce(
      (sum, row) => sum + row.fills.filter((fill) => fill.side === "SELL").length,
      0
    ),
    dataGaps: executions.reduce((sum, row) => sum + row.dataGapCount, 0),
    comparison: {
      comparable: comparison.comparable,
      originalProfit: round6(comparison.originalProfit),
      realisticProfit: round6(comparison.realisticProfit),
      difference: round6(comparison.realisticProfit - comparison.originalProfit)
    },
    byEntryTrigger: groupPerformance(
      resolved,
      (row) => row.observation.entryTrigger ?? "UNKNOWN"
    ),
    byExitTrigger: groupPerformance(
      resolved,
      (row) => row.exitTrigger ?? "UNKNOWN"
    )
  }, null, 2));
}

function groupPerformance<T extends { profit: unknown; roi: unknown }>(
  rows: T[],
  key: (row: T) => string
) {
  return Object.values(rows.reduce<Record<string, {
    name: string;
    cases: number;
    wins: number;
    losses: number;
    profit: number;
    roi: number;
  }>>((groups, row) => {
    const name = key(row);
    const group = groups[name] ?? {
      name,
      cases: 0,
      wins: 0,
      losses: 0,
      profit: 0,
      roi: 0
    };
    const rowProfit = Number(row.profit ?? 0);
    group.cases += 1;
    group.profit += rowProfit;
    group.roi += Number(row.roi ?? 0);
    if (rowProfit > 0) {
      group.wins += 1;
    } else {
      group.losses += 1;
    }
    groups[name] = group;
    return groups;
  }, {})).map((group) => ({
    ...group,
    profit: round6(group.profit),
    averageRoi: round6(group.cases === 0 ? 0 : group.roi / group.cases),
    roi: undefined
  }));
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
