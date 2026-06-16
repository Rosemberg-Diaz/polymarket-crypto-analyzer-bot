import { prisma } from "../src/database/client";

async function main(): Promise<void> {
  const cycles = await prisma.dailyExitCycle.findMany({
    include: {
      market: {
        select: {
          slug: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  const resolved = cycles.filter(
    (cycle) =>
      (cycle.status === "CLOSED" || cycle.status === "SETTLED") &&
      cycle.profit !== null
  );
  const profit = resolved.reduce(
    (sum, cycle) => sum + Number(cycle.profit),
    0
  );

  console.log("Daily multi-cycle observation report");
  console.log(`Cycles: ${cycles.length}`);
  console.log(`Open: ${cycles.filter((cycle) => cycle.status === "OPEN").length}`);
  console.log(`Resolved: ${resolved.length}`);
  console.log(`Wins: ${resolved.filter((cycle) => Number(cycle.profit) > 0).length}`);
  console.log(`Losses: ${resolved.filter((cycle) => Number(cycle.profit) < 0).length}`);
  console.log(`Profit: $${profit.toFixed(6)}`);

  for (const [asset, rows] of groupBy(resolved, (cycle) => cycle.assetSymbol)) {
    const assetProfit = rows.reduce(
      (sum, cycle) => sum + Number(cycle.profit),
      0
    );
    console.log(
      `${asset}: ${rows.length} resolved, ` +
      `${rows.filter((cycle) => Number(cycle.profit) > 0).length} wins, ` +
      `$${assetProfit.toFixed(6)}`
    );
  }

  console.log("\nBy market:");
  for (const [slug, marketCycles] of groupBy(cycles, (cycle) => cycle.market.slug)) {
    const marketResolved = marketCycles.filter(
      (cycle) =>
        (cycle.status === "CLOSED" || cycle.status === "SETTLED") &&
        cycle.profit !== null
    );
    const marketProfit = marketResolved.reduce(
      (sum, cycle) => sum + Number(cycle.profit),
      0
    );
    console.log(
      `${slug}: ${marketCycles.length} cycles, ` +
      `${marketCycles.filter((cycle) => cycle.status === "OPEN").length} open, ` +
      `${marketResolved.length} resolved, ` +
      `${marketResolved.filter((cycle) => Number(cycle.profit) > 0).length} wins, ` +
      `${marketResolved.filter((cycle) => Number(cycle.profit) < 0).length} losses, ` +
      `$${marketProfit.toFixed(6)}`
    );
  }
}

function groupBy<T>(
  rows: T[],
  keyOf: (row: T) => string
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    grouped.set(keyOf(row), [...(grouped.get(keyOf(row)) ?? []), row]);
  }
  return grouped;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
