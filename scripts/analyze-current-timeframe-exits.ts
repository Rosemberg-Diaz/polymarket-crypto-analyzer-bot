import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RUN_START = new Date(process.argv[2] ?? "2026-06-13T23:37:53.410Z");

type Observation = Awaited<ReturnType<typeof loadObservations>>[number];

async function loadObservations() {
  return prisma.shortTermExitObservation.findMany({
    where: {
      createdAt: {
        gte: RUN_START
      }
    },
    include: {
      market: {
        select: {
          timeframe: true
        }
      },
      quotes: {
        where: {
          executable: true
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      realisticExecution: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

async function main(): Promise<void> {
  const observations = await loadObservations();
  const commonFifteenMinuteFilter = observations.filter((row) =>
    row.market.timeframe === "15m" &&
    Number(row.entryAsk) >= 0.5 &&
    Number(row.entryAsk) <= 0.7 &&
    Number(row.entrySpread) <= 0.02 &&
    row.entrySecondsToClose >= 840 &&
    row.entrySecondsToClose <= 900 &&
    row.entryTrigger === "RISING_BID_TIGHT_SPREAD"
  );

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    runStart: RUN_START.toISOString(),
    commonFifteenMinuteFilter: {
      overall: summarizeFirstTakeProfit(commonFifteenMinuteFilter, 0.02),
      byAsset: Object.fromEntries(
        [...new Set(commonFifteenMinuteFilter.map((row) => row.assetSymbol))]
          .sort()
          .map((asset) => [
            asset,
            summarizeFirstTakeProfit(
              commonFifteenMinuteFilter.filter((row) => row.assetSymbol === asset),
              0.02
            )
          ])
      )
    },
    byTimeframe: Object.fromEntries(
      ["5m", "15m"].map((timeframe) => {
        const rows = observations.filter(
          (row) => row.market.timeframe === timeframe
        );
        return [
          timeframe,
          {
            actualConservative: summarizeActual(rows),
            realisticExecution: summarizeRealistic(rows),
            firstTakeProfit2: summarizeFirstTakeProfit(rows, 0.02),
            forcedExitScenarios: Object.fromEntries(
              (timeframe === "5m"
                ? [180, 120, 90, 60]
                : [600, 480, 360, 240, 180]
              ).map((threshold) => [
                `${threshold}s`,
                summarizeForcedExit(rows, threshold)
              ])
            ),
            byAsset: grouped(rows, (row) => row.assetSymbol),
            byTrigger: grouped(rows, (row) => row.entryTrigger ?? "UNKNOWN"),
            byEntryPrice: grouped(rows, (row) => priceBand(Number(row.entryAsk))),
            byEntryTime: grouped(rows, (row) =>
              timeBand(Number(row.entrySecondsToClose), timeframe)
            ),
            bySpread: grouped(rows, (row) => spreadBand(Number(row.entrySpread))),
            byEntryBidCoverage: grouped(rows, (row) => {
              const firstQuote = row.quotes[0];
              const coverage = firstQuote
                ? Number(firstQuote.bidSize) / Number(row.shares)
                : 0;
              return depthBand(coverage);
            })
          }
        ];
      })
    )
  }, null, 2));
}

function summarizeActual(rows: Observation[]) {
  const settled = rows.filter((row) => row.status !== "OPEN");
  const performance = settled.map((row) => {
    const profit = row.status === "NO_EXIT"
      ? -Number(row.stake)
      : Number(row.profit ?? -Number(row.stake));
    return { profit, roi: profit / Number(row.stake) };
  });

  return summarize(performance, rows.length - settled.length);
}

function summarizeRealistic(rows: Observation[]) {
  const resolved = rows.flatMap((row) => {
    const execution = row.realisticExecution;
    if (execution?.status !== "RESOLVED" || execution.profit === null) {
      return [];
    }
    return [{
      profit: Number(execution.profit),
      roi: Number(execution.roi ?? 0)
    }];
  });

  return summarize(
    resolved,
    rows.length - resolved.length
  );
}

function summarizeFirstTakeProfit(rows: Observation[], threshold: number) {
  const settled = rows.filter((row) => row.status !== "OPEN");
  const performance = settled.map((row) => {
    const takeProfit = row.quotes.find(
      (quote) => Number(quote.netRoi) >= threshold
    );
    if (takeProfit) {
      return {
        profit: Number(takeProfit.netProfit),
        roi: Number(takeProfit.netRoi)
      };
    }

    const last = row.quotes.at(-1);
    if (last) {
      return {
        profit: Number(last.netProfit),
        roi: Number(last.netRoi)
      };
    }

    return {
      profit: -Number(row.stake),
      roi: -1
    };
  });

  return summarize(performance, rows.length - settled.length);
}

function summarizeForcedExit(rows: Observation[], thresholdSeconds: number) {
  const settled = rows.filter((row) => row.status !== "OPEN");
  const performance = settled.map((row) => {
    const takeProfit = row.quotes.find(
      (quote) =>
        quote.secondsToClose > thresholdSeconds &&
        Number(quote.netRoi) >= 0.02
    );
    const forcedExit = row.quotes.find(
      (quote) => quote.secondsToClose <= thresholdSeconds
    );
    const selected = takeProfit ?? forcedExit;

    if (selected) {
      return {
        profit: Number(selected.netProfit),
        roi: Number(selected.netRoi)
      };
    }

    return {
      profit: -Number(row.stake),
      roi: -1
    };
  });

  return summarize(performance, rows.length - settled.length);
}

function grouped(
  rows: Observation[],
  keyOf: (row: Observation) => string
): Record<string, ReturnType<typeof summarizeActual>> {
  const groups = new Map<string, Observation[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, summarizeActual(values)])
  );
}

function summarize(
  performance: Array<{ profit: number; roi: number }>,
  open: number
) {
  const wins = performance.filter((row) => row.profit > 0).length;
  const losses = performance.length - wins;
  return {
    observations: performance.length + open,
    settled: performance.length,
    open,
    wins,
    losses,
    winRate: round(performance.length === 0 ? 0 : wins / performance.length),
    profit: round(performance.reduce((sum, row) => sum + row.profit, 0)),
    averageRoi: round(
      performance.length === 0
        ? 0
        : performance.reduce((sum, row) => sum + row.roi, 0) / performance.length
    )
  };
}

function priceBand(price: number): string {
  if (price < 0.35) return "0.15-0.34";
  if (price < 0.55) return "0.35-0.54";
  return "0.55-0.75";
}

function timeBand(seconds: number, timeframe: string): string {
  if (timeframe === "15m") {
    if (seconds >= 840) return "840-900";
    if (seconds >= 780) return "780-839";
    return "720-779";
  }
  if (seconds >= 280) return "280-300";
  if (seconds >= 260) return "260-279";
  return "240-259";
}

function spreadBand(spread: number): string {
  if (spread <= 0.02) return "<=0.02";
  if (spread <= 0.04) return "0.021-0.04";
  return "0.041-0.06";
}

function depthBand(coverage: number): string {
  if (coverage < 2) return "1x-1.99x";
  if (coverage < 5) return "2x-4.99x";
  if (coverage < 10) return "5x-9.99x";
  return ">=10x";
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
