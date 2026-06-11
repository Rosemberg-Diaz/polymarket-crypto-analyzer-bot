import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main(): Promise<void> {
  const fromValue = readArg("from");
  const toValue = readArg("to");

  if (!fromValue) {
    throw new Error("Missing required --from=<ISO date> argument.");
  }

  const from = new Date(fromValue);
  const to = toValue ? new Date(toValue) : new Date();
  const createdAt = { gte: from, lte: to };

  const [
    snapshots,
    predictions,
    trades,
    realOrders,
    observations,
    exitObservations,
    exitQuotes,
    errors,
    storageIntegrity
  ] = await Promise.all([
    prisma.marketSnapshot.findMany({
      where: { createdAt },
      select: {
        rawData: true,
        rawOrderbook: true
      }
    }),
    prisma.botPrediction.findMany({
      where: { createdAt },
      select: {
        recommendation: true,
        features: true
      }
    }),
    prisma.simulatedTrade.findMany({
      where: { createdAt },
      select: {
        status: true,
        isWin: true,
        profit: true
      }
    }),
    prisma.realOrder.findMany({
      where: { createdAt },
      select: {
        status: true
      }
    }),
    prisma.observationEvaluation.findMany({
      where: { createdAt },
      select: {
        observationType: true,
        status: true,
        wouldWin: true,
        hypotheticalProfit: true
      }
    }),
    prisma.shortTermExitObservation.findMany({
      where: { createdAt },
      select: {
        assetSymbol: true,
        outcome: true,
        status: true,
        profit: true,
        marketId: true
      }
    }),
    prisma.shortTermExitQuote.count({
      where: { createdAt }
    }),
    prisma.botRunLog.findMany({
      where: {
        createdAt,
        level: "error"
      },
      select: {
        message: true
      }
    }),
    prisma.$queryRaw<Array<{ name: string; count: bigint }>>`
      SELECT 'orphan_exit_quotes' AS name, COUNT(*) AS count
      FROM ShortTermExitQuote q
      LEFT JOIN ShortTermExitObservation o ON o.id = q.observationId
      WHERE o.id IS NULL
      UNION ALL
      SELECT 'duplicate_exit_market_outcome' AS name, COUNT(*) AS count
      FROM (
        SELECT marketId, outcome
        FROM ShortTermExitObservation
        GROUP BY marketId, outcome
        HAVING COUNT(*) > 1
      )
      UNION ALL
      SELECT 'orphan_observation_predictions' AS name, COUNT(*) AS count
      FROM ObservationEvaluation o
      LEFT JOIN BotPrediction p ON p.id = o.predictionId
      WHERE p.id IS NULL
    `
  ]);

  const historicalGatePredictions = predictions.filter((prediction) => {
    const features = parseFeatures(prediction.features);
    return (
      features.blockedByHistoricalGate === true &&
      features.blockedReason === "INSUFFICIENT_SIMILAR_CASES"
    );
  });

  const resolvedExitObservations = exitObservations.filter((row) => row.status === "CLOSED");
  const result = {
    window: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    counts: {
      snapshots: snapshots.length,
      predictions: predictions.length,
      historicalGatePredictions: historicalGatePredictions.length,
      simulatedTrades: trades.length,
      realOrders: realOrders.length,
      observationEvaluations: observations.length,
      shortTermExitObservations: exitObservations.length,
      shortTermExitQuotes: exitQuotes,
      errors: errors.length
    },
    simulatedTrades: summarizeStatuses(trades),
    realOrders: summarizeStatuses(realOrders),
    historicalGateObservations: summarizeStatuses(
      observations.filter((row) => row.observationType.startsWith("OBSERVE_HISTORICAL_GATE_"))
    ),
    shortTermExit: {
      statuses: summarizeStatuses(exitObservations),
      assets: countBy(exitObservations, (row) => row.assetSymbol),
      outcomes: countBy(exitObservations, (row) => row.outcome),
      resolvedProfit: round6(
        resolvedExitObservations.reduce((sum, row) => sum + Number(row.profit ?? 0), 0)
      ),
      resolvedWins: resolvedExitObservations.filter((row) => Number(row.profit ?? 0) > 0).length,
      resolvedLosses: resolvedExitObservations.filter((row) => Number(row.profit ?? 0) <= 0).length
    },
    storage: {
      snapshotRawDataBytes: sumTextBytes(snapshots.map((row) => row.rawData)),
      snapshotRawOrderbookBytes: sumTextBytes(snapshots.map((row) => row.rawOrderbook)),
      snapshotsWithRawOrderbook: snapshots.filter((row) => row.rawOrderbook !== null).length
    },
    integrity: Object.fromEntries(
      storageIntegrity.map((row) => [row.name, Number(row.count)])
    ),
    errorMessages: countBy(errors, (row) => row.message)
  };

  console.log(JSON.stringify(result, null, 2));
}

function parseFeatures(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarizeStatuses<T extends { status: string }>(rows: T[]): Record<string, number> {
  return countBy(rows, (row) => row.status);
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    const value = key(row);
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function sumTextBytes(values: Array<string | null>): number {
  return values.reduce((sum, value) => sum + (value ? Buffer.byteLength(value, "utf8") : 0), 0);
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
