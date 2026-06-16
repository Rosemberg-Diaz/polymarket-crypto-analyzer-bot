import { connectDatabase, disconnectDatabase, prisma } from "../src/database/client";

async function main(): Promise<void> {
  await connectDatabase();
  const rows = await prisma.observationEvaluation.findMany({
    where: {
      status: "RESOLVED",
      prediction: {
        mlOutcomePrediction: { not: null }
      }
    },
    include: {
      prediction: true,
      market: {
        select: {
          timeframe: true
        }
      }
    }
  });

  const groups = new Map<string, {
    rows: number;
    correct: number;
    upPredictions: number;
    correctUp: number;
    downPredictions: number;
    correctDown: number;
    hypotheticalProfit: number;
  }>();
  for (const row of rows) {
    const key = row.market.timeframe ?? "unknown";
    const group = groups.get(key) ?? {
      rows: 0,
      correct: 0,
      upPredictions: 0,
      correctUp: 0,
      downPredictions: 0,
      correctDown: 0,
      hypotheticalProfit: 0
    };
    const winner = row.result?.split(":")[0]?.toUpperCase();
    const prediction = row.prediction.mlOutcomePrediction;
    const correct = prediction === winner ||
      (prediction === "UP" && winner === "YES") ||
      (prediction === "DOWN" && winner === "NO");
    const entryPrice = Number(row.prediction.mlOutcomeEntryPrice ?? 0);
    const stake = Number(row.hypotheticalStake);
    group.rows += 1;
    group.correct += correct ? 1 : 0;
    if (prediction === "UP") {
      group.upPredictions += 1;
      group.correctUp += correct ? 1 : 0;
    } else {
      group.downPredictions += 1;
      group.correctDown += correct ? 1 : 0;
    }
    if (entryPrice > 0 && entryPrice < 1) {
      group.hypotheticalProfit += correct
        ? stake / entryPrice - stake
        : -stake;
    }
    groups.set(key, group);
  }

  console.table([...groups.entries()].map(([timeframe, group]) => ({
    timeframe,
    samples: group.rows,
    accuracy: group.rows === 0 ? 0 : group.correct / group.rows,
    precisionUp:
      group.upPredictions === 0 ? 0 : group.correctUp / group.upPredictions,
    precisionDown:
      group.downPredictions === 0 ? 0 : group.correctDown / group.downPredictions,
    hypotheticalProfit: group.hypotheticalProfit
  })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
