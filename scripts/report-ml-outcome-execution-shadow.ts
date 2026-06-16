import { prisma } from "../src/database/client";

async function main(): Promise<void> {
  const executions = await prisma.mlOutcomeShadowExecution.findMany({
    orderBy: [
      { timeframe: "asc" },
      { assetSymbol: "asc" }
    ]
  });
  const groups = new Map<string, typeof executions>();
  for (const execution of executions) {
    const key =
      `${execution.checkpointSeconds}:` +
      `${execution.timeframe}:${execution.assetSymbol}`;
    const rows = groups.get(key) ?? [];
    rows.push(execution);
    groups.set(key, rows);
  }
  const skips = await prisma.mlOutcomeShadowExecution.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: {
      status: {
        startsWith: "SKIPPED_"
      }
    },
    orderBy: {
      status: "asc"
    }
  });

  console.log("\nML UP/DOWN executable shadow report");
  console.log("One execution opportunity per market; FOK depth, fees and latency included.\n");
  console.table([...groups.values()].map((rows) => {
    const opportunities = rows.length;
    const executable = rows.filter((row) =>
      row.fullyFilled && ["PENDING", "RESOLVED"].includes(row.status)
    ).length;
    const resolvedRows = rows.filter((row) => row.status === "RESOLVED");
    const resolved = resolvedRows.length;
    const wins = resolvedRows.filter((row) => row.isWin === true).length;
    const totalFees = rows
      .filter((row) => ["PENDING", "RESOLVED"].includes(row.status))
      .reduce(
      (sum, row) => sum + Number(row.fee ?? 0),
      0
    );
    const totalProfit = resolvedRows.reduce(
      (sum, row) => sum + Number(row.profit ?? 0),
      0
    );
    const averageRoi = resolved > 0
      ? resolvedRows.reduce((sum, row) => sum + Number(row.roi ?? 0), 0) /
        resolved
      : 0;
    return {
      timeframe: rows[0].timeframe,
      asset: rows[0].assetSymbol,
      checkpoint: `${rows[0].checkpointSeconds}s`,
      opportunities,
      executable,
      fillRate: opportunities > 0
        ? `${((executable / opportunities) * 100).toFixed(1)}%`
        : "0.0%",
      resolved,
      winRate: resolved > 0
        ? `${((wins / resolved) * 100).toFixed(1)}%`
        : "n/a",
      fees: totalFees.toFixed(4),
      profit: totalProfit.toFixed(4),
      averageRoi: resolved > 0
        ? `${(averageRoi * 100).toFixed(2)}%`
        : "n/a"
    };
  }));

  console.log("\nSkipped opportunities");
  console.table(skips.map((row) => ({
    status: row.status,
    count: row._count._all
  })));

  const checkpointGroups = new Map<number, typeof executions>();
  for (const execution of executions) {
    const rows = checkpointGroups.get(execution.checkpointSeconds) ?? [];
    rows.push(execution);
    checkpointGroups.set(execution.checkpointSeconds, rows);
  }
  console.log("\nCheckpoint comparison");
  console.table(
    [...checkpointGroups.entries()]
      .sort(([left], [right]) => right - left)
      .map(([checkpoint, rows]) => {
        const executable = rows.filter((row) =>
          ["PENDING", "RESOLVED"].includes(row.status)
        );
        const resolved = rows.filter((row) => row.status === "RESOLVED");
        const wins = resolved.filter((row) => row.isWin === true).length;
        const profit = resolved.reduce(
          (sum, row) => sum + Number(row.profit ?? 0),
          0
        );
        const expectedProfit = executable.reduce(
          (sum, row) => sum + Number(row.expectedProfit ?? 0),
          0
        );
        return {
          checkpoint: `${checkpoint}s`,
          opportunities: rows.length,
          executable: executable.length,
          fillRate:
            `${((executable.length / Math.max(1, rows.length)) * 100).toFixed(1)}%`,
          resolved: resolved.length,
          winRate: resolved.length > 0
            ? `${((wins / resolved.length) * 100).toFixed(1)}%`
            : "n/a",
          expectedProfit: expectedProfit.toFixed(4),
          realizedProfit: profit.toFixed(4)
        };
      })
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
