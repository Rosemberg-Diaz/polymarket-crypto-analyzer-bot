import { Prisma, PrismaClient } from "@prisma/client";
import { calculateCryptoTakerFee } from "../src/modules/backtesting/short-term-exit-backtest.service";
import {
  ExecutableBookQuote,
  selectOrderFlowEntry
} from "../src/modules/simulations/short-term-exit-observation.service";

const prisma = new PrismaClient();
const STAKE_USD = 1;
const TAKER_FEE_RATE = 0.07;
const TAKE_PROFIT_ROI = 0.02;

type EntryRow = Awaited<ReturnType<typeof loadEntryQuotes>>[number];
type ExitObservation = Awaited<ReturnType<typeof loadExitObservations>>[number];

interface CandidateEntry {
  marketId: string;
  assetSymbol: string;
  timeframe: "5m" | "15m";
  outcome: "UP" | "DOWN";
  at: Date;
  quote: ExecutableBookQuote;
}

interface BacktestResult extends CandidateEntry {
  exitAt: Date;
  exitBid: number;
  profit: number;
  roi: number;
  reason: "TAKE_PROFIT" | "LAST_RECORDED_EXECUTABLE_BID";
}

async function loadEntryQuotes() {
  return prisma.shortTermEntryQuote.findMany({
    where: {
      market: {
        timeframe: { in: ["5m", "15m"] }
      }
    },
    include: {
      market: {
        select: {
          timeframe: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });
}

async function loadExitObservations() {
  return prisma.shortTermExitObservation.findMany({
    include: {
      market: {
        select: { timeframe: true }
      },
      quotes: {
        where: { executable: true },
        orderBy: { createdAt: "asc" }
      }
    }
  });
}

async function main(): Promise<void> {
  const [entryRows, exitObservations] = await Promise.all([
    loadEntryQuotes(),
    loadExitObservations()
  ]);
  const entries = findEntries(entryRows);
  const exitsByMarketOutcome = buildExitQuoteMap(exitObservations);
  const results = entries.flatMap((entry) => {
    const key = `${entry.marketId}:${entry.outcome}`;
    const futureEntryQuotes = entryRows
      .filter(
        (row) =>
          row.marketId === entry.marketId &&
          row.outcome === entry.outcome &&
          row.createdAt > entry.at &&
          row.executable
      )
      .map((row) => ({
        at: row.createdAt,
        bestBid: Number(row.bestBid),
        bidSize: Number(row.bidSize)
      }));
    const futureExitQuotes = (exitsByMarketOutcome.get(key) ?? [])
      .filter((quote) => quote.at > entry.at);
    const path = [...futureEntryQuotes, ...futureExitQuotes]
      .sort((left, right) => left.at.getTime() - right.at.getTime())
      .filter(uniqueQuote);
    const result = simulateExit(entry, path);
    return result ? [result] : [];
  });

  const byTimeframe = groupResults(results, (row) => row.timeframe);
  const byAsset = groupResults(results, (row) => row.assetSymbol);
  const byTimeframeAsset = groupResults(
    results,
    (row) => `${row.timeframe}:${row.assetSymbol}`
  );

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    methodology: {
      name: "ORDER_FLOW_L1_APPROXIMATION",
      stakeUsd: STAKE_USD,
      takeProfitNetRoi: TAKE_PROFIT_ROI,
      entryData: "ShortTermEntryQuote; L1 size is used when historical L5 depth is absent.",
      exitData: "Later executable entry/exit quotes already captured by the bot.",
      limitations: [
        "Historical depth beyond level 1 was not stored.",
        "Historical cancellations and authoritative trade direction were not stored.",
        "Markets without a later executable quote are excluded from profit.",
        "This is a selected-coverage approximation, not a production PnL claim."
      ]
    },
    coverage: {
      entryQuotes: entryRows.length,
      marketsWithSignal: entries.length,
      signalsWithExitPath: results.length,
      signalsWithoutExitPath: entries.length - results.length,
      coverageRate: round(entries.length === 0 ? 0 : results.length / entries.length)
    },
    overall: summarize(results),
    byTimeframe,
    byAsset,
    byTimeframeAsset
  }, null, 2));
}

function findEntries(rows: EntryRow[]): CandidateEntry[] {
  const byMarketOutcome = new Map<string, EntryRow[]>();
  for (const row of rows) {
    if (row.outcome !== "UP" && row.outcome !== "DOWN") {
      continue;
    }
    const key = `${row.marketId}:${row.outcome}`;
    byMarketOutcome.set(key, [...(byMarketOutcome.get(key) ?? []), row]);
  }

  const candidates: CandidateEntry[] = [];
  for (const series of byMarketOutcome.values()) {
    for (let index = 0; index < series.length; index += 1) {
      const current = series[index];
      const timeframe = current.market.timeframe;
      if (timeframe !== "5m" && timeframe !== "15m") {
        continue;
      }
      const currentQuote = toQuote(current);
      const selection = selectOrderFlowEntry(
        [{
          outcome: current.outcome as "UP" | "DOWN",
          quote: currentQuote,
          previousQuotes: series
            .slice(Math.max(0, index - 6), index)
            .map(toQuote)
        }],
        Number(current.liquidity),
        current.secondsToClose,
        timeframe
      );
      if (!selection) {
        continue;
      }

      candidates.push({
        marketId: current.marketId,
        assetSymbol: current.assetSymbol,
        timeframe,
        outcome: selection.outcome,
        at: current.createdAt,
        quote: selection.quote
      });
      break;
    }
  }

  const firstByMarket = new Map<string, CandidateEntry>();
  for (const candidate of candidates.sort((left, right) => left.at.getTime() - right.at.getTime())) {
    if (!firstByMarket.has(candidate.marketId)) {
      firstByMarket.set(candidate.marketId, candidate);
    }
  }
  return [...firstByMarket.values()];
}

function buildExitQuoteMap(observations: ExitObservation[]) {
  const map = new Map<string, Array<{ at: Date; bestBid: number; bidSize: number }>>();
  for (const observation of observations) {
    const key = `${observation.marketId}:${observation.outcome}`;
    const existing = map.get(key) ?? [];
    for (const quote of observation.quotes) {
      existing.push({
        at: quote.createdAt,
        bestBid: Number(quote.bestBid),
        bidSize: Number(quote.bidSize)
      });
    }
    map.set(key, existing);
  }
  return map;
}

function simulateExit(
  entry: CandidateEntry,
  path: Array<{ at: Date; bestBid: number; bidSize: number }>
): BacktestResult | null {
  const feePerShare =
    TAKER_FEE_RATE * entry.quote.bestAsk * (1 - entry.quote.bestAsk);
  const shares = STAKE_USD / (entry.quote.bestAsk + feePerShare);
  const executable = path.filter((quote) => quote.bidSize >= shares);
  if (executable.length === 0) {
    return null;
  }

  const valued = executable.map((quote) => {
    const sellFee = calculateCryptoTakerFee(
      shares,
      quote.bestBid,
      TAKER_FEE_RATE
    );
    const finalValue = shares * quote.bestBid - sellFee;
    const profit = finalValue - STAKE_USD;
    return {
      ...quote,
      profit,
      roi: profit / STAKE_USD
    };
  });
  const takeProfit = valued.find((quote) => quote.roi >= TAKE_PROFIT_ROI);
  const selected = takeProfit ?? valued.at(-1)!;

  return {
    ...entry,
    exitAt: selected.at,
    exitBid: selected.bestBid,
    profit: selected.profit,
    roi: selected.roi,
    reason: takeProfit ? "TAKE_PROFIT" : "LAST_RECORDED_EXECUTABLE_BID"
  };
}

function toQuote(row: EntryRow): ExecutableBookQuote {
  const bestBid = Number(row.bestBid);
  const bidSize = Number(row.bidSize);
  const bestAsk = Number(row.bestAsk);
  const askSize = Number(row.askSize);
  const totalSize = bidSize + askSize;
  return {
    bestBid,
    bidSize,
    bestAsk,
    askSize,
    bidDepth5: Number(row.bidDepth5 ?? row.bidSize),
    askDepth5: Number(row.askDepth5 ?? row.askSize),
    depthImbalance: row.depthImbalance === null
      ? (totalSize <= 0 ? 0 : (bidSize - askSize) / totalSize)
      : Number(row.depthImbalance),
    microPrice: row.microPrice === null
      ? (totalSize <= 0
          ? (bestBid + bestAsk) / 2
          : (bestAsk * bidSize + bestBid * askSize) / totalSize)
      : Number(row.microPrice),
    spread: Number(row.spread),
    observedAt: row.createdAt
  };
}

function groupResults(
  rows: BacktestResult[],
  keyOf: (row: BacktestResult) => string
) {
  const groups = new Map<string, BacktestResult[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, summarize(values)])
  );
}

function summarize(rows: BacktestResult[]) {
  const wins = rows.filter((row) => row.profit > 0).length;
  const profit = rows.reduce((sum, row) => sum + row.profit, 0);
  return {
    resolved: rows.length,
    wins,
    losses: rows.length - wins,
    winRate: round(rows.length === 0 ? 0 : wins / rows.length),
    profit: round(profit),
    averageRoi: round(
      rows.length === 0
        ? 0
        : rows.reduce((sum, row) => sum + row.roi, 0) / rows.length
    )
  };
}

function uniqueQuote(
  value: { at: Date; bestBid: number; bidSize: number },
  index: number,
  rows: Array<{ at: Date; bestBid: number; bidSize: number }>
): boolean {
  return index === 0 ||
    value.at.getTime() !== rows[index - 1].at.getTime() ||
    value.bestBid !== rows[index - 1].bestBid ||
    value.bidSize !== rows[index - 1].bidSize;
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
