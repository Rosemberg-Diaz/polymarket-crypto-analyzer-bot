import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const observations = await prisma.shortTermExitObservation.findMany({
    include: {
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

  const closed = observations.filter((row) => row.status === "CLOSED");
  const byAsset = Object.fromEntries(
    Array.from(new Set(observations.map((row) => row.assetSymbol))).map((asset) => {
      const rows = observations.filter((row) => row.assetSymbol === asset);
      const resolved = rows.filter((row) => row.status === "CLOSED");
      return [
        asset,
        {
          observations: rows.length,
          open: rows.filter((row) => row.status === "OPEN").length,
          closed: resolved.length,
          noExit: rows.filter((row) => row.status === "NO_EXIT").length,
          wins: resolved.filter((row) => Number(row.profit ?? 0) > 0).length,
          losses: resolved.filter((row) => Number(row.profit ?? 0) <= 0).length,
          profit: round6(resolved.reduce((sum, row) => sum + Number(row.profit ?? 0), 0))
        }
      ];
    })
  );

  const result = {
    generatedAt: new Date().toISOString(),
    observations: observations.length,
    open: observations.filter((row) => row.status === "OPEN").length,
    closed: closed.length,
    noExit: observations.filter((row) => row.status === "NO_EXIT").length,
    quotes: observations.reduce((sum, row) => sum + row._count.quotes, 0),
    reachedTakeProfit2: observations.filter((row) => row.firstTakeProfit2At !== null).length,
    reachedTakeProfit5: observations.filter((row) => row.firstTakeProfit5At !== null).length,
    reachedTakeProfit10: observations.filter((row) => row.firstTakeProfit10At !== null).length,
    reachedStopLoss3: observations.filter((row) => row.firstStopLoss3At !== null).length,
    reachedStopLoss5: observations.filter((row) => row.firstStopLoss5At !== null).length,
    reachedStopLoss10: observations.filter((row) => row.firstStopLoss10At !== null).length,
    finalProfit: round6(closed.reduce((sum, row) => sum + Number(row.profit ?? 0), 0)),
    byAsset
  };

  console.log(JSON.stringify(result, null, 2));
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
