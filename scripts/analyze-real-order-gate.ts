import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRUSTED_TARGET_SOURCES = new Set([
  "POLYMARKET_CRYPTO_PRICE_API",
  "POLYMARKET_RTDS_CHAINLINK",
  "POLYMARKET_UMA_ANCILLARY"
]);
const TRUSTED_OUTCOME_SOURCES = [
  "POLYMARKET_EXPLICIT",
  "GAMMA_OUTCOME_PRICES",
  "CLOB_FINAL_PRICE",
  "POLYMARKET_RTDS_CHAINLINK_CLOSE"
];
const PRIORITY_ASSETS = new Set(["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]);

interface Features {
  entryRule?: string;
  finalEntryRule?: string;
  baseEntryRule?: string;
  similarCases?: number;
  historicalWinRate?: number;
  historicalProfit?: number;
  blockedByHistoricalGate?: boolean;
  targetPriceTrustedForLearning?: boolean;
  targetPriceSource?: string;
  distanceToTargetPercent?: number;
  secondsToClose?: number;
  spread?: number;
  liquidity?: number;
  distanceToTarget?: number;
}

function parseFeatures(value: string | null): Features {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Features;
  } catch {
    return {};
  }
}

function isTrusted(features: Features, result: string | null, resolutionSource: string | null): boolean {
  return (
    features.targetPriceTrustedForLearning === true &&
    TRUSTED_TARGET_SOURCES.has(features.targetPriceSource ?? "") &&
    typeof features.distanceToTargetPercent === "number" &&
    Math.abs(features.distanceToTargetPercent) <= 0.1 &&
    TRUSTED_OUTCOME_SOURCES.some((source) => result?.includes(`:${source}`)) &&
    resolutionSource !== "MOCK_LOCAL_SCANNER"
  );
}

function evaluateGate(params: {
  recommendation: string;
  predictedOutcome: string;
  entryPrice: number;
  assetSymbol: string;
  marketType: string;
  features: Features;
}): { allowed: boolean; reason: string } {
  const { recommendation, predictedOutcome, entryPrice, assetSymbol, marketType, features } = params;
  const entryRule = features.finalEntryRule ?? features.entryRule ?? features.baseEntryRule ?? "NONE";

  if (!["ENTER_SMALL", "ENTER_MODERATE"].includes(recommendation)) {
    return { allowed: false, reason: "SIGNAL_NOT_ENTRY" };
  }
  if (!entryRule.startsWith("ENTER_")) {
    return { allowed: false, reason: "ENTRY_RULE_NOT_OPERATIONAL" };
  }
  if (features.blockedByHistoricalGate === true) {
    return { allowed: false, reason: "BLOCKED_BY_HISTORICAL_GATE" };
  }
  if (!PRIORITY_ASSETS.has(assetSymbol)) {
    return { allowed: false, reason: "ASSET_NOT_PRIORITY" };
  }
  if (marketType === "CRYPTO_OTHER") {
    return { allowed: false, reason: "MARKET_TYPE_NOT_SUPPORTED" };
  }
  if (entryPrice <= 0.05 || entryPrice >= 0.95) {
    return { allowed: false, reason: "ENTRY_PRICE_OUT_OF_RANGE" };
  }
  if ((features.similarCases ?? -1) < 5) {
    return { allowed: false, reason: "INSUFFICIENT_SIMILAR_CASES" };
  }
  if ((features.historicalWinRate ?? -1) < 0.6) {
    return { allowed: false, reason: "LOW_HISTORICAL_WIN_RATE" };
  }
  if ((features.historicalProfit ?? 0) <= 0) {
    return { allowed: false, reason: "NON_POSITIVE_HISTORICAL_PROFIT" };
  }
  if (features.secondsToClose === undefined || features.secondsToClose < 20) {
    return { allowed: false, reason: "INVALID_SECONDS_TO_CLOSE" };
  }
  if (features.secondsToClose > 210) {
    return { allowed: false, reason: "TOO_EARLY_FOR_REAL_ORDER" };
  }
  if (features.spread === undefined || features.liquidity === undefined) {
    return { allowed: false, reason: "MISSING_RISK_DATA" };
  }
  if (features.spread > 0.05) {
    return { allowed: false, reason: "SPREAD_TOO_HIGH" };
  }
  if (features.liquidity < 100) {
    return { allowed: false, reason: "LIQUIDITY_TOO_LOW" };
  }
  if (predictedOutcome === "DOWN" && entryPrice < 0.6 && features.secondsToClose > 180) {
    return { allowed: false, reason: "CHEAP_DOWN_EARLY_RISK" };
  }

  return { allowed: true, reason: "ALLOWED" };
}

function evaluateCurrentStrategy(params: {
  predictedOutcome: string;
  entryPrice: number;
  edge: number;
  assetSymbol: string;
  features: Features;
}): { allowed: boolean; reason: string } {
  const { predictedOutcome, entryPrice, edge, assetSymbol, features } = params;
  const baseEntryRule = features.baseEntryRule ?? features.entryRule ?? "NONE";
  const secondsToClose = features.secondsToClose;
  const distancePercent = features.distanceToTargetPercent;

  if (features.targetPriceTrustedForLearning !== true) {
    return { allowed: false, reason: "UNTRUSTED_TARGET" };
  }
  if (secondsToClose === undefined || secondsToClose > 210 || secondsToClose < 20) {
    return { allowed: false, reason: "TIME_WINDOW_NOT_OPERATIONAL" };
  }
  if (distancePercent === undefined) {
    return { allowed: false, reason: "MISSING_DISTANCE" };
  }
  if (Math.abs(distancePercent) < 0.001 && secondsToClose > 120) {
    return { allowed: false, reason: "TOO_CLOSE_TO_TARGET_EARLY" };
  }
  if (entryPrice > 0.82 && !(secondsToClose < 45 && Math.abs(distancePercent) >= 0.004)) {
    return { allowed: false, reason: "HIGH_ENTRY_PRICE" };
  }
  if (predictedOutcome === "DOWN" && entryPrice < 0.6 && secondsToClose > 180) {
    return { allowed: false, reason: "CHEAP_DOWN_EARLY_RISK" };
  }
  if (
    predictedOutcome === "DOWN" &&
    secondsToClose >= 60 &&
    secondsToClose <= 119 &&
    entryPrice >= 0.75
  ) {
    return { allowed: false, reason: "STANDARD_DOWN_REVERSAL_RISK" };
  }

  if (baseEntryRule === "ENTER_MODERATE_STANDARD") {
    if (edge < 0.08) {
      return { allowed: false, reason: "MODERATE_EDGE_TOO_LOW" };
    }
    if (secondsToClose > 180 && entryPrice < 0.65) {
      return { allowed: false, reason: "MODERATE_EARLY_CHEAP_RISK" };
    }
    if (assetSymbol === "ETH" && entryPrice < 0.7) {
      return { allowed: false, reason: "MODERATE_ETH_PRICE_RISK" };
    }
    return { allowed: true, reason: "CURRENT_MODERATE_STANDARD" };
  }

  if (baseEntryRule === "ENTER_SMALL_STANDARD") {
    return edge >= 0.03
      ? { allowed: true, reason: "CURRENT_SMALL_STANDARD" }
      : { allowed: false, reason: "STANDARD_EDGE_TOO_LOW" };
  }

  if (baseEntryRule === "ENTER_SMALL_LIGHT") {
    const isCurrentOperationalLight =
      assetSymbol === "SOL" &&
      predictedOutcome === "UP" &&
      entryPrice >= 0.5 &&
      entryPrice <= 0.69 &&
      secondsToClose >= 60 &&
      secondsToClose <= 120 &&
      edge >= 0.015 &&
      features.spread !== undefined &&
      features.spread <= 0.04 &&
      Math.abs(distancePercent) >= 0.0005;

    return isCurrentOperationalLight
      ? { allowed: true, reason: "CURRENT_SMALL_LIGHT" }
      : { allowed: false, reason: "LIGHT_NOT_OPERATIONAL_UNDER_CURRENT_RULES" };
  }

  if (baseEntryRule === "ENTER_SMALL_LEARNING_DEFENSIVE") {
    return { allowed: true, reason: "CURRENT_LEARNING_DEFENSIVE" };
  }

  return { allowed: false, reason: "BASE_RULE_NOT_CURRENTLY_OPERATIONAL" };
}

function bogotaDay(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

async function main(): Promise<void> {
  const trades = await prisma.simulatedTrade.findMany({
    where: {
      status: "RESOLVED",
      isWin: { not: null },
      profit: { not: null },
      roi: { not: null },
      resolvedAt: { not: null }
    },
    include: {
      prediction: true,
      market: true
    },
    orderBy: { createdAt: "asc" }
  });

  const rows = trades.map((trade) => {
    const features = parseFeatures(trade.prediction.features);
    const strategy = evaluateCurrentStrategy({
      predictedOutcome: trade.prediction.predictedOutcome,
      entryPrice: Number(trade.entryPrice),
      edge: Number(trade.prediction.edge ?? 0),
      assetSymbol: trade.prediction.assetSymbol,
      features
    });
    const gate = evaluateGate({
      recommendation: trade.prediction.recommendation,
      predictedOutcome: trade.prediction.predictedOutcome,
      entryPrice: Number(trade.entryPrice),
      assetSymbol: trade.prediction.assetSymbol,
      marketType: trade.prediction.marketType,
      features
    });

    return {
      id: trade.id,
      createdAt: trade.createdAt.toISOString(),
      bogotaDay: bogotaDay(trade.createdAt),
      market: trade.market.question,
      asset: trade.prediction.assetSymbol,
      outcome: trade.prediction.predictedOutcome,
      recommendation: trade.prediction.recommendation,
      entryRule: features.finalEntryRule ?? features.entryRule ?? features.baseEntryRule ?? "NONE",
      entryPrice: Number(trade.entryPrice),
      secondsToClose: features.secondsToClose ?? null,
      similarCases: features.similarCases ?? null,
      historicalWinRate: features.historicalWinRate ?? null,
      historicalProfit: features.historicalProfit ?? null,
      isWin: trade.isWin,
      stake: Number(trade.stake),
      recordedProfit: Number(trade.profit),
      profitAtOneDollar: Number(trade.roi),
      trusted: isTrusted(features, trade.result, trade.market.resolutionSource),
      currentStrategyAllowed: strategy.allowed,
      strategyReason: strategy.reason,
      gateAllowed: strategy.allowed && gate.allowed,
      gateReason: !strategy.allowed ? strategy.reason : gate.reason,
      result: trade.result
    };
  });

  const today = bogotaDay(new Date());
  const allowed = rows.filter((row) => row.gateAllowed);
  const trustedAllowed = allowed.filter((row) => row.trusted);
  const todayAllowed = trustedAllowed.filter((row) => row.bogotaDay === today);

  const summarize = (items: typeof rows) => ({
    trades: items.length,
    wins: items.filter((row) => row.isWin).length,
    losses: items.filter((row) => !row.isWin).length,
    winRate: items.length ? items.filter((row) => row.isWin).length / items.length : 0,
    recordedStake: items.reduce((sum, row) => sum + row.stake, 0),
    recordedProfit: items.reduce((sum, row) => sum + row.recordedProfit, 0),
    profitAtOneDollarEach: items.reduce((sum, row) => sum + row.profitAtOneDollar, 0)
  });

  const blockedReasons = rows.reduce<Record<string, number>>((acc, row) => {
    if (!row.gateAllowed) {
      acc[row.gateReason] = (acc[row.gateReason] ?? 0) + 1;
    }
    return acc;
  }, {});
  const byRule = rows.reduce<Record<string, {
    total: number;
    trusted: number;
    allowed: number;
    wins: number;
    losses: number;
    profit: number;
    blockedReasons: Record<string, number>;
  }>>((acc, row) => {
    const key = row.entryRule;
    const current = acc[key] ?? {
      total: 0,
      trusted: 0,
      allowed: 0,
      wins: 0,
      losses: 0,
      profit: 0,
      blockedReasons: {}
    };
    current.total++;
    if (row.trusted) {
      current.trusted++;
    }
    if (row.gateAllowed && row.trusted) {
      current.allowed++;
      current.profit += row.recordedProfit;
      if (row.isWin) {
        current.wins++;
      } else {
        current.losses++;
      }
    } else {
      current.blockedReasons[row.gateReason] = (current.blockedReasons[row.gateReason] ?? 0) + 1;
    }
    acc[key] = current;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        todayBogota: today,
        totalResolvedRows: rows.length,
        strictTrustedResolvedRows: rows.filter((row) => row.trusted).length,
        gateAllowedAllData: summarize(allowed),
        gateAllowedTrustedHistory: summarize(trustedAllowed),
        gateAllowedTrustedToday: summarize(todayAllowed),
        todayTrades: todayAllowed,
        historicalTrades: trustedAllowed,
        blockedReasons,
        byRule
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
