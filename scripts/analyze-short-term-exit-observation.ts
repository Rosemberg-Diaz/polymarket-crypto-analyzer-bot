import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ENTRY_MIN = 0.1;
const ENTRY_MAX = 0.7;
const MAX_SPREAD = 0.06;
const MIN_LIQUIDITY = 100;
const MIN_SECONDS_TO_CLOSE = 60;

function bogotaDay(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

interface OrderbookLevel {
  price?: string | number;
  size?: string | number;
}

interface OutcomeBook {
  bids?: OrderbookLevel[];
  asks?: OrderbookLevel[];
}

function parseOutcomeBook(
  value: string | null,
  outcome: "UP" | "DOWN"
): { bestBid: number; bidSize: number; bestAsk: number; askSize: number } | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as { up?: OutcomeBook; down?: OutcomeBook };
    const book = outcome === "UP" ? parsed.up : parsed.down;
    if (!book) {
      return null;
    }

    const bids = (book.bids ?? [])
      .map((level) => ({ price: numberOrNull(level.price), size: numberOrNull(level.size) }))
      .filter((level): level is { price: number; size: number } => level.price !== null && level.size !== null);
    const asks = (book.asks ?? [])
      .map((level) => ({ price: numberOrNull(level.price), size: numberOrNull(level.size) }))
      .filter((level): level is { price: number; size: number } => level.price !== null && level.size !== null);

    if (bids.length === 0 || asks.length === 0) {
      return null;
    }

    const bestBid = bids.reduce((best, level) => (level.price > best.price ? level : best));
    const bestAsk = asks.reduce((best, level) => (level.price < best.price ? level : best));
    return {
      bestBid: bestBid.price,
      bidSize: bestBid.size,
      bestAsk: bestAsk.price,
      askSize: bestAsk.size
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const snapshots = await prisma.marketSnapshot.findMany({
    include: {
      market: {
        select: {
          id: true,
          assetSymbol: true,
          marketType: true,
          timeframe: true,
          question: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const today = bogotaDay(new Date());
  const candidates = snapshots.flatMap((snapshot) => {
    const spread = numberOrNull(snapshot.spread);
    const liquidity = numberOrNull(snapshot.liquidity);
    const secondsToClose = snapshot.secondsToClose;

    return [
      { outcome: "UP", price: numberOrNull(snapshot.upPrice) },
      { outcome: "DOWN", price: numberOrNull(snapshot.downPrice) }
    ]
      .filter((item): item is { outcome: string; price: number } => item.price !== null)
      .map((item) => ({
        snapshotId: snapshot.id,
        marketId: snapshot.marketId,
        createdAt: snapshot.createdAt,
        day: bogotaDay(snapshot.createdAt),
        asset: snapshot.market.assetSymbol,
        marketType: snapshot.market.marketType,
        timeframe: snapshot.market.timeframe,
        question: snapshot.market.question,
        outcome: item.outcome,
        price: item.price,
        bid: numberOrNull(snapshot.bid),
        ask: numberOrNull(snapshot.ask),
        spread,
        liquidity,
        secondsToClose
      }));
  });

  const eligibleRows = candidates.filter(
    (row) =>
      row.marketType === "UP_DOWN_SHORT_TERM" &&
      row.timeframe === "5m" &&
      row.price >= ENTRY_MIN &&
      row.price <= ENTRY_MAX &&
      row.spread !== null &&
      row.spread <= MAX_SPREAD &&
      row.liquidity !== null &&
      row.liquidity >= MIN_LIQUIDITY &&
      row.secondsToClose !== null &&
      row.secondsToClose >= MIN_SECONDS_TO_CLOSE
  );

  const uniqueOpportunities = new Map<string, (typeof eligibleRows)[number]>();
  for (const row of eligibleRows) {
    const key = `${row.marketId}:${row.outcome}`;
    if (!uniqueOpportunities.has(key)) {
      uniqueOpportunities.set(key, row);
    }
  }

  const marketSeries = new Map<string, typeof candidates>();
  for (const row of candidates) {
    const key = `${row.marketId}:${row.outcome}`;
    const series = marketSeries.get(key) ?? [];
    series.push(row);
    marketSeries.set(key, series);
  }

  const evaluated = Array.from(uniqueOpportunities.entries()).map(([key, entry]) => {
    const later = (marketSeries.get(key) ?? []).filter(
      (row) => row.createdAt > entry.createdAt && row.secondsToClose !== null && row.secondsToClose >= 20
    );
    const maxLaterPrice = later.reduce((max, row) => Math.max(max, row.price), entry.price);
    const maxGrossReturn = maxLaterPrice / entry.price - 1;

    return {
      ...entry,
      laterSnapshots: later.length,
      maxLaterPrice,
      maxGrossReturn,
      reached2PercentGross: maxGrossReturn >= 0.02,
      reached5PercentGross: maxGrossReturn >= 0.05,
      reached10PercentGross: maxGrossReturn >= 0.1
    };
  });

  const executableRows = snapshots.flatMap((snapshot) =>
    (["UP", "DOWN"] as const).flatMap((outcome) => {
      const book = parseOutcomeBook(snapshot.rawOrderbook, outcome);
      if (!book) {
        return [];
      }

      return [{
        marketId: snapshot.marketId,
        createdAt: snapshot.createdAt,
        day: bogotaDay(snapshot.createdAt),
        asset: snapshot.market.assetSymbol,
        marketType: snapshot.market.marketType,
        timeframe: snapshot.market.timeframe,
        question: snapshot.market.question,
        outcome,
        secondsToClose: snapshot.secondsToClose,
        liquidity: numberOrNull(snapshot.liquidity),
        ...book,
        spread: book.bestAsk - book.bestBid
      }];
    })
  );
  const executableSeries = new Map<string, typeof executableRows>();
  for (const row of executableRows) {
    const key = `${row.marketId}:${row.outcome}`;
    const series = executableSeries.get(key) ?? [];
    series.push(row);
    executableSeries.set(key, series);
  }
  const executableEntries = new Map<string, (typeof executableRows)[number]>();
  for (const row of executableRows) {
    const sharesForOneDollar = 1 / row.bestAsk;
    const eligible =
      row.marketType === "UP_DOWN_SHORT_TERM" &&
      row.timeframe === "5m" &&
      row.bestAsk >= ENTRY_MIN &&
      row.bestAsk <= ENTRY_MAX &&
      row.spread <= MAX_SPREAD &&
      row.askSize >= sharesForOneDollar &&
      row.liquidity !== null &&
      row.liquidity >= MIN_LIQUIDITY &&
      row.secondsToClose !== null &&
      row.secondsToClose >= MIN_SECONDS_TO_CLOSE;
    const key = `${row.marketId}:${row.outcome}`;
    if (eligible && !executableEntries.has(key)) {
      executableEntries.set(key, row);
    }
  }
  const executableEvaluated = Array.from(executableEntries.entries()).map(([key, entry]) => {
    const shares = 1 / entry.bestAsk;
    const later = (executableSeries.get(key) ?? []).filter(
      (row) =>
        row.createdAt > entry.createdAt &&
        row.secondsToClose !== null &&
        row.secondsToClose >= 20 &&
        row.bidSize >= shares
    );
    const maxSellBid = later.reduce((max, row) => Math.max(max, row.bestBid), entry.bestBid);
    const maxGrossProfit = shares * maxSellBid - 1;
    return {
      ...entry,
      laterExecutableSnapshots: later.length,
      maxSellBid,
      maxGrossProfit,
      reached2PercentGross: maxGrossProfit >= 0.02,
      reached5PercentGross: maxGrossProfit >= 0.05,
      reached10PercentGross: maxGrossProfit >= 0.1
    };
  });

  const summarize = (
    rows: Array<{
      asset: string;
      outcome: string;
      reached2PercentGross: boolean;
      reached5PercentGross: boolean;
      reached10PercentGross: boolean;
      laterSnapshots?: number;
      laterExecutableSnapshots?: number;
    }>
  ) => ({
    opportunities: rows.length,
    assets: rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.asset] = (acc[row.asset] ?? 0) + 1;
      return acc;
    }, {}),
    outcomes: rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
      return acc;
    }, {}),
    withLaterSnapshots: rows.filter(
      (row) => (row.laterSnapshots ?? row.laterExecutableSnapshots ?? 0) > 0
    ).length,
    reached2PercentGross: rows.filter((row) => row.reached2PercentGross).length,
    reached5PercentGross: rows.filter((row) => row.reached5PercentGross).length,
    reached10PercentGross: rows.filter((row) => row.reached10PercentGross).length
  });

  const fieldCoverage = {
    totalSnapshots: snapshots.length,
    withUpPrice: snapshots.filter((row) => row.upPrice !== null).length,
    withDownPrice: snapshots.filter((row) => row.downPrice !== null).length,
    withBid: snapshots.filter((row) => row.bid !== null).length,
    withAsk: snapshots.filter((row) => row.ask !== null).length,
    withSpread: snapshots.filter((row) => row.spread !== null).length,
    withLiquidity: snapshots.filter((row) => row.liquidity !== null).length,
    withRawOrderbook: snapshots.filter((row) => row.rawOrderbook !== null).length
  };
  const executableBands = executableEvaluated.reduce<Record<string, number>>((acc, row) => {
    const priceBand =
      row.bestAsk < 0.3 ? "0.10-0.29" : row.bestAsk < 0.5 ? "0.30-0.49" : "0.50-0.70";
    const timeBand =
      (row.secondsToClose ?? 0) <= 120
        ? "60-120s"
        : (row.secondsToClose ?? 0) <= 210
          ? "121-210s"
          : "211-300s";
    const key = `${priceBand} | ${timeBand}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const rawOrderbookSamples = snapshots
    .filter((row) => row.rawOrderbook !== null)
    .slice(-3)
    .map((row) => ({
      snapshotId: row.id,
      rawOrderbook: row.rawOrderbook?.slice(0, 2_000)
    }));

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        todayBogota: today,
        filters: {
          entryPrice: [ENTRY_MIN, ENTRY_MAX],
          maxSpread: MAX_SPREAD,
          minLiquidity: MIN_LIQUIDITY,
          minSecondsToClose: MIN_SECONDS_TO_CLOSE,
          marketType: "UP_DOWN_SHORT_TERM",
          timeframe: "5m"
        },
        fieldCoverage,
        rawOrderbookSamples,
        eligibleSnapshotOutcomeRows: eligibleRows.length,
        fullHistory: summarize(evaluated),
        today: summarize(evaluated.filter((row) => row.day === today)),
        executableOrderbookAnalysis: {
          note: "Uses best ask for entry, later best bid for exit, and top-level size sufficient for a $1 observation. Fees are not deducted.",
          fullHistory: summarize(executableEvaluated),
          today: summarize(executableEvaluated.filter((row) => row.day === today)),
          entryBands: executableBands
        },
        sampleToday: evaluated.filter((row) => row.day === today).slice(0, 20)
      },
      null,
      2
    )
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
