import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CandidateConfig {
  assetGroup: string;
  entryPriceMin: number;
  entryPriceMax: number;
  entrySecondsMin: number;
  entrySecondsMax: number;
  takeProfit: number;
  stopLoss: number;
  maxHoldSeconds: number;
}

interface Performance {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profit: number;
  averageRoi: number;
  exitReasons: Record<string, number>;
}

async function main(): Promise<void> {
  const observations = await prisma.shortTermExitObservation.findMany({
    include: {
      quotes: {
        where: { executable: true },
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const cutoffIndex = Math.floor(observations.length * 0.7);
  const discovery = observations.slice(0, cutoffIndex);
  const validation = observations.slice(cutoffIndex);
  const results: Array<{
    config: CandidateConfig;
    discovery: Performance;
    validation: Performance;
  }> = [];

  for (const config of buildConfigs()) {
    const discoveryPerformance = evaluate(discovery, config);
    const validationPerformance = evaluate(validation, config);
    if (discoveryPerformance.trades < 20 || validationPerformance.trades < 10) {
      continue;
    }

    results.push({
      config,
      discovery: discoveryPerformance,
      validation: validationPerformance
    });
  }

  results.sort((left, right) => {
    if (right.validation.profit !== left.validation.profit) {
      return right.validation.profit - left.validation.profit;
    }
    return right.validation.trades - left.validation.trades;
  });

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        observations: observations.length,
        discoveryObservations: discovery.length,
        validationObservations: validation.length,
        cutoff: validation[0]?.createdAt ?? null,
        topValidatedConfigurations: results.slice(0, 25)
      },
      null,
      2
    )
  );
}

function buildConfigs(): CandidateConfig[] {
  const configs: CandidateConfig[] = [];
  const assetGroups = ["ALL", "CORE", "BTC", "ETH", "SOL", "XRP", "BNB", "DOGE"];
  const priceBands = [
    [0.1, 0.29],
    [0.3, 0.49],
    [0.5, 0.7],
    [0.1, 0.7]
  ];
  const timeBands = [
    [60, 120],
    [121, 210],
    [211, 300],
    [60, 300]
  ];

  for (const assetGroup of assetGroups) {
    for (const [entryPriceMin, entryPriceMax] of priceBands) {
      for (const [entrySecondsMin, entrySecondsMax] of timeBands) {
        for (const takeProfit of [0.02, 0.05, 0.1]) {
          for (const stopLoss of [0.05, 0.1, 0.2, 99]) {
            for (const maxHoldSeconds of [30, 60, 120, 999]) {
              configs.push({
                assetGroup,
                entryPriceMin,
                entryPriceMax,
                entrySecondsMin,
                entrySecondsMax,
                takeProfit,
                stopLoss,
                maxHoldSeconds
              });
            }
          }
        }
      }
    }
  }

  return configs;
}

function evaluate(
  observations: Awaited<
    ReturnType<typeof prisma.shortTermExitObservation.findMany<{
      include: { quotes: { where: { executable: true }; orderBy: { createdAt: "asc" } } };
      orderBy: { createdAt: "asc" };
    }>>
  >,
  config: CandidateConfig
): Performance {
  const trades = observations.flatMap((observation) => {
    const entryPrice = Number(observation.entryAsk);
    if (
      !matchesAsset(observation.assetSymbol, config.assetGroup) ||
      entryPrice < config.entryPriceMin ||
      entryPrice > config.entryPriceMax ||
      observation.entrySecondsToClose < config.entrySecondsMin ||
      observation.entrySecondsToClose > config.entrySecondsMax ||
      observation.quotes.length === 0
    ) {
      return [];
    }

    const openedAt = observation.createdAt.getTime();
    let exitQuote = observation.quotes.at(-1)!;
    let exitReason = "LAST_QUOTE";

    for (const quote of observation.quotes) {
      const roi = Number(quote.netRoi);
      const heldSeconds = (quote.createdAt.getTime() - openedAt) / 1_000;

      if (roi >= config.takeProfit) {
        exitQuote = quote;
        exitReason = "TAKE_PROFIT";
        break;
      }
      if (roi <= -config.stopLoss) {
        exitQuote = quote;
        exitReason = "STOP_LOSS";
        break;
      }
      if (heldSeconds >= config.maxHoldSeconds) {
        exitQuote = quote;
        exitReason = "TIMEOUT";
        break;
      }
      if (quote.secondsToClose <= 20) {
        exitQuote = quote;
        exitReason = "MARKET_CLOSE";
        break;
      }
    }

    return [
      {
        profit: Number(exitQuote.netProfit),
        roi: Number(exitQuote.netRoi),
        exitReason
      }
    ];
  });

  const wins = trades.filter((trade) => trade.profit > 0).length;
  const totalProfit = trades.reduce((sum, trade) => sum + trade.profit, 0);
  const totalRoi = trades.reduce((sum, trade) => sum + trade.roi, 0);

  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: round6(trades.length === 0 ? 0 : wins / trades.length),
    profit: round6(totalProfit),
    averageRoi: round6(trades.length === 0 ? 0 : totalRoi / trades.length),
    exitReasons: trades.reduce<Record<string, number>>((counts, trade) => {
      counts[trade.exitReason] = (counts[trade.exitReason] ?? 0) + 1;
      return counts;
    }, {})
  };
}

function matchesAsset(asset: string, group: string): boolean {
  if (group === "ALL") {
    return true;
  }
  if (group === "CORE") {
    return ["BTC", "ETH", "SOL"].includes(asset);
  }
  return asset === group;
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
