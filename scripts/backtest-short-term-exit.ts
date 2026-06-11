import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  ShortTermExitBacktestConfig,
  ShortTermExitBacktestService,
  ShortTermExitPerformance,
  ShortTermExitQuote
} from "../src/modules/backtesting/short-term-exit-backtest.service";

const prisma = new PrismaClient();
const service = new ShortTermExitBacktestService();

const STAKE_USD = 1;
const TAKER_FEE_RATE = 0.07;
const DISCOVERY_RATIO = 0.7;
const MIN_DISCOVERY_TRADES = 30;
const MIN_VALIDATION_TRADES = 10;
const MIN_EXIT_COVERAGE = 0.5;

interface StoredOutcomeBook {
  bids?: Array<{ price?: string | number; size?: string | number }>;
  asks?: Array<{ price?: string | number; size?: string | number }>;
}

interface ConfigurationResult {
  id: string;
  config: ShortTermExitBacktestConfig;
  discovery: ShortTermExitPerformance;
  validation: ShortTermExitPerformance;
}

async function main(): Promise<void> {
  const snapshots = await prisma.marketSnapshot.findMany({
    where: {
      rawOrderbook: { not: null },
      secondsToClose: { not: null },
      liquidity: { not: null },
      market: {
        marketType: "UP_DOWN_SHORT_TERM",
        timeframe: "5m"
      }
    },
    include: {
      market: {
        select: {
          id: true,
          assetSymbol: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const quotes = snapshots.flatMap((snapshot) =>
    (["UP", "DOWN"] as const).flatMap((outcome) => {
      const book = parseOutcomeBook(snapshot.rawOrderbook, outcome);
      if (!book || snapshot.secondsToClose === null || snapshot.liquidity === null) {
        return [];
      }

      return [{
        marketId: snapshot.marketId,
        assetSymbol: snapshot.market.assetSymbol,
        outcome,
        createdAt: snapshot.createdAt,
        secondsToClose: snapshot.secondsToClose,
        liquidity: Number(snapshot.liquidity),
        bestBid: book.bestBid,
        bestAsk: book.bestAsk
      } satisfies ShortTermExitQuote];
    })
  );

  const split = splitQuotesChronologically(quotes, DISCOVERY_RATIO);
  const configurations = buildConfigurations();
  const results: ConfigurationResult[] = [];

  for (const [index, config] of configurations.entries()) {
    const discoveryTrades = service.run(split.discovery, config);
    const validationTrades = service.run(split.validation, config);
    results.push({
      id: configurationId(config),
      config,
      discovery: service.summarize(discoveryTrades),
      validation: service.summarize(validationTrades)
    });

    if ((index + 1) % 25 === 0 || index === configurations.length - 1) {
      console.log(`Backtest ${index + 1}/${configurations.length}`);
    }
  }

  const selectedByDiscovery = results
    .filter((result) => isDiscoveryCandidate(result.discovery))
    .sort(compareDiscovery)
    .slice(0, 20);
  const topDiscoveryOverall = [...results].sort(compareDiscovery).slice(0, 20);
  const validatedCandidates = selectedByDiscovery
    .filter((result) => isValidationPositive(result.validation))
    .sort(compareValidation);
  const bestValidated = validatedCandidates[0] ?? null;
  const breakdown = bestValidated
    ? buildBreakdown(split, bestValidated.config)
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      observationStakeUsd: STAKE_USD,
      execution: "First eligible best ask entry; first later executable best bid hitting TP, SL, timeout, or close.",
      cryptoTakerFeeRate: TAKER_FEE_RATE,
      feesApplied: "Both buy and sell, rounded to 5 decimals.",
      discoveryRatio: DISCOVERY_RATIO,
      selectionRule:
        `Rank only on discovery data. Require >=${MIN_DISCOVERY_TRADES} resolved discovery trades and ` +
        `${MIN_EXIT_COVERAGE * 100}% observable exit coverage; validation is reported afterward and ` +
        `requires >=${MIN_VALIDATION_TRADES} resolved trades.`,
      caveats: [
        "Uses discrete stored snapshots, not tick-by-tick fills.",
        "Uses top-of-book depth only and assumes immediate taker execution.",
        "No real orders are created."
      ]
    },
    data: {
      snapshotsRead: snapshots.length,
      executableQuotes: quotes.length,
      discoveryMarkets: uniqueMarketCount(split.discovery),
      validationMarkets: uniqueMarketCount(split.validation),
      discoveryCutoff: split.cutoff.toISOString(),
      configurationsTested: configurations.length
    },
    discoverySummary: {
      positiveConfigurations: results.filter((result) => result.discovery.totalProfit > 0).length,
      bestOverall: topDiscoveryOverall[0] ?? null,
      topOverall: topDiscoveryOverall
    },
    selectedByDiscovery,
    validatedCandidates,
    bestValidated,
    bestValidatedBreakdown: breakdown
  };

  const outputDir = path.resolve("logs", "reports");
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outputDir, `short-term-exit-backtest-${timestamp}.json`);
  const textPath = path.join(outputDir, `short-term-exit-backtest-${timestamp}.txt`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(textPath, buildTextReport(report), "utf8");

  console.log(buildTextReport(report));
  console.log(`JSON: ${jsonPath}`);
  console.log(`TXT: ${textPath}`);
}

function buildConfigurations(): ShortTermExitBacktestConfig[] {
  const priceBands = [
    [0.1, 0.29],
    [0.3, 0.49],
    [0.5, 0.7]
  ] as const;
  const timeBands = [
    [60, 120],
    [121, 210],
    [211, 300]
  ] as const;
  const takeProfits = [0.02, 0.05, 0.1];
  const stopLosses = [0.03, 0.05, 0.1];
  const holdSeconds = [30, 60, 120];

  return priceBands.flatMap(([entryPriceMin, entryPriceMax]) =>
    timeBands.flatMap(([entrySecondsMin, entrySecondsMax]) =>
      takeProfits.flatMap((takeProfit) =>
        stopLosses.flatMap((stopLoss) =>
          holdSeconds.map((maxHoldSeconds) => ({
            entryPriceMin,
            entryPriceMax,
            entrySecondsMin,
            entrySecondsMax,
            maxSpread: 0.06,
            minLiquidity: 100,
            takeProfit,
            stopLoss,
            maxHoldSeconds,
            forceExitSecondsToClose: 20,
            stakeUsd: STAKE_USD,
            takerFeeRate: TAKER_FEE_RATE
          }))
        )
      )
    )
  );
}

function splitQuotesChronologically(
  quotes: ShortTermExitQuote[],
  discoveryRatio: number
): { discovery: ShortTermExitQuote[]; validation: ShortTermExitQuote[]; cutoff: Date } {
  const firstQuoteByMarket = new Map<string, Date>();
  for (const quote of quotes) {
    const current = firstQuoteByMarket.get(quote.marketId);
    if (!current || quote.createdAt < current) {
      firstQuoteByMarket.set(quote.marketId, quote.createdAt);
    }
  }

  const orderedMarkets = Array.from(firstQuoteByMarket.entries()).sort(
    (left, right) => left[1].getTime() - right[1].getTime()
  );
  const cutoffIndex = Math.max(1, Math.floor(orderedMarkets.length * discoveryRatio));
  const discoveryIds = new Set(orderedMarkets.slice(0, cutoffIndex).map(([marketId]) => marketId));
  const cutoff = orderedMarkets[Math.min(cutoffIndex, orderedMarkets.length - 1)]?.[1] ?? new Date(0);

  return {
    discovery: quotes.filter((quote) => discoveryIds.has(quote.marketId)),
    validation: quotes.filter((quote) => !discoveryIds.has(quote.marketId)),
    cutoff
  };
}

function parseOutcomeBook(
  rawOrderbook: string | null,
  outcome: "UP" | "DOWN"
): { bestBid: { price: number; size: number }; bestAsk: { price: number; size: number } } | null {
  if (!rawOrderbook) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawOrderbook) as { up?: StoredOutcomeBook; down?: StoredOutcomeBook };
    const book = outcome === "UP" ? parsed.up : parsed.down;
    const bids = parseLevels(book?.bids);
    const asks = parseLevels(book?.asks);
    if (bids.length === 0 || asks.length === 0) {
      return null;
    }

    return {
      bestBid: bids.reduce((best, level) => (level.price > best.price ? level : best)),
      bestAsk: asks.reduce((best, level) => (level.price < best.price ? level : best))
    };
  } catch {
    return null;
  }
}

function parseLevels(
  levels: StoredOutcomeBook["bids"] | StoredOutcomeBook["asks"]
): Array<{ price: number; size: number }> {
  return (levels ?? []).flatMap((level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    return Number.isFinite(price) && Number.isFinite(size) && price > 0 && size > 0
      ? [{ price, size }]
      : [];
  });
}

function isDiscoveryCandidate(performance: ShortTermExitPerformance): boolean {
  const resolvedTrades = performance.trades - performance.noExit;
  return (
    resolvedTrades >= MIN_DISCOVERY_TRADES &&
    resolvedTrades / performance.trades >= MIN_EXIT_COVERAGE &&
    performance.totalProfit > 0
  );
}

function isValidationPositive(performance: ShortTermExitPerformance): boolean {
  const resolvedTrades = performance.trades - performance.noExit;
  return (
    resolvedTrades >= MIN_VALIDATION_TRADES &&
    resolvedTrades / performance.trades >= MIN_EXIT_COVERAGE &&
    performance.totalProfit > 0
  );
}

function compareDiscovery(left: ConfigurationResult, right: ConfigurationResult): number {
  return (
    right.discovery.totalProfit - left.discovery.totalProfit ||
    right.discovery.winRate - left.discovery.winRate ||
    left.discovery.maxDrawdown - right.discovery.maxDrawdown
  );
}

function compareValidation(left: ConfigurationResult, right: ConfigurationResult): number {
  return (
    right.validation.totalProfit - left.validation.totalProfit ||
    right.validation.winRate - left.validation.winRate ||
    left.validation.maxDrawdown - right.validation.maxDrawdown
  );
}

function buildBreakdown(
  split: { discovery: ShortTermExitQuote[]; validation: ShortTermExitQuote[] },
  config: ShortTermExitBacktestConfig
): Record<string, unknown> {
  const trades = service.run(split.validation, config);
  const byAsset = Object.fromEntries(
    Array.from(new Set(trades.map((trade) => trade.assetSymbol))).map((asset) => [
      asset,
      service.summarize(trades.filter((trade) => trade.assetSymbol === asset))
    ])
  );
  const byOutcome = Object.fromEntries(
    (["UP", "DOWN"] as const).map((outcome) => [
      outcome,
      service.summarize(trades.filter((trade) => trade.outcome === outcome))
    ])
  );
  const byExitReason = trades.reduce<Record<string, number>>((acc, trade) => {
    acc[trade.exitReason] = (acc[trade.exitReason] ?? 0) + 1;
    return acc;
  }, {});

  return { byAsset, byOutcome, byExitReason };
}

function buildTextReport(report: {
  generatedAt: string;
  data: {
    snapshotsRead: number;
    executableQuotes: number;
    discoveryMarkets: number;
    validationMarkets: number;
    discoveryCutoff: string;
    configurationsTested: number;
  };
  discoverySummary: {
    positiveConfigurations: number;
    bestOverall: ConfigurationResult | null;
    topOverall: ConfigurationResult[];
  };
  selectedByDiscovery: ConfigurationResult[];
  validatedCandidates: ConfigurationResult[];
  bestValidated: ConfigurationResult | null;
  bestValidatedBreakdown: Record<string, unknown> | null;
}): string {
  const lines = [
    "SHORT-TERM EXIT BACKTEST",
    `Generated: ${report.generatedAt}`,
    `Snapshots: ${report.data.snapshotsRead}`,
    `Executable quotes: ${report.data.executableQuotes}`,
    `Discovery markets: ${report.data.discoveryMarkets}`,
    `Validation markets: ${report.data.validationMarkets}`,
    `Chronological cutoff: ${report.data.discoveryCutoff}`,
    `Configurations tested: ${report.data.configurationsTested}`,
    `Positive discovery configurations: ${report.discoverySummary.positiveConfigurations}`,
    `Discovery-selected configurations: ${report.selectedByDiscovery.length}`,
    `Positive out-of-sample configurations: ${report.validatedCandidates.length}`,
    ""
  ];

  if (report.discoverySummary.bestOverall) {
    lines.push(
      `Best discovery configuration regardless of sign: ${report.discoverySummary.bestOverall.id}`,
      `Best discovery result: ${formatPerformance(report.discoverySummary.bestOverall.discovery)}`,
      `Its validation result: ${formatPerformance(report.discoverySummary.bestOverall.validation)}`,
      ""
    );
  }

  if (!report.bestValidated) {
    lines.push("No configuration selected on discovery remained positive in validation.");
    return lines.join("\n");
  }

  lines.push(
    `Best validated configuration: ${report.bestValidated.id}`,
    `Discovery: ${formatPerformance(report.bestValidated.discovery)}`,
    `Validation: ${formatPerformance(report.bestValidated.validation)}`,
    `Validation breakdown: ${JSON.stringify(report.bestValidatedBreakdown)}`,
    "",
    "This is historical observation research only. No real-trading rule was enabled."
  );
  return lines.join("\n");
}

function formatPerformance(performance: ShortTermExitPerformance): string {
  return [
    `trades=${performance.trades}`,
    `wins=${performance.wins}`,
    `losses=${performance.losses}`,
    `noExit=${performance.noExit}`,
    `winRate=${(performance.winRate * 100).toFixed(2)}%`,
    `profit=$${performance.totalProfit.toFixed(6)}`,
    `avgRoi=${(performance.averageRoi * 100).toFixed(2)}%`,
    `maxDrawdown=$${performance.maxDrawdown.toFixed(6)}`
  ].join(", ");
}

function configurationId(config: ShortTermExitBacktestConfig): string {
  return [
    `price-${config.entryPriceMin}-${config.entryPriceMax}`,
    `time-${config.entrySecondsMin}-${config.entrySecondsMax}`,
    `tp-${config.takeProfit}`,
    `sl-${config.stopLoss}`,
    `hold-${config.maxHoldSeconds}`
  ].join("__");
}

function uniqueMarketCount(quotes: ShortTermExitQuote[]): number {
  return new Set(quotes.map((quote) => quote.marketId)).size;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
