export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface ShortTermExitQuote {
  marketId: string;
  assetSymbol: string;
  outcome: "UP" | "DOWN";
  createdAt: Date;
  secondsToClose: number;
  liquidity: number;
  bestBid: OrderbookLevel;
  bestAsk: OrderbookLevel;
}

export interface ShortTermExitBacktestConfig {
  entryPriceMin: number;
  entryPriceMax: number;
  entrySecondsMin: number;
  entrySecondsMax: number;
  maxSpread: number;
  minLiquidity: number;
  takeProfit: number;
  stopLoss: number;
  maxHoldSeconds: number;
  forceExitSecondsToClose: number;
  stakeUsd: number;
  takerFeeRate: number;
}

export type ShortTermExitReason = "TAKE_PROFIT" | "STOP_LOSS" | "TIMEOUT" | "MARKET_CLOSE" | "NO_EXIT";

export interface ShortTermExitBacktestTrade {
  marketId: string;
  assetSymbol: string;
  outcome: "UP" | "DOWN";
  enteredAt: Date;
  exitedAt: Date | null;
  entryAsk: number;
  exitBid: number | null;
  shares: number;
  buyFee: number;
  sellFee: number;
  profit: number;
  roi: number;
  exitReason: ShortTermExitReason;
}

export interface ShortTermExitPerformance {
  trades: number;
  wins: number;
  losses: number;
  noExit: number;
  winRate: number;
  totalProfit: number;
  averageRoi: number;
  maxDrawdown: number;
}

export class ShortTermExitBacktestService {
  run(
    quotes: ShortTermExitQuote[],
    config: ShortTermExitBacktestConfig
  ): ShortTermExitBacktestTrade[] {
    const seriesByOutcome = groupQuotes(quotes);

    return Array.from(seriesByOutcome.values()).flatMap((series) => {
      const entryIndex = series.findIndex((quote) => isEligibleEntry(quote, config));
      if (entryIndex < 0) {
        return [];
      }

      return [simulateTrade(series, entryIndex, config)];
    });
  }

  summarize(trades: ShortTermExitBacktestTrade[]): ShortTermExitPerformance {
    const resolved = trades.filter((trade) => trade.exitReason !== "NO_EXIT");
    const wins = resolved.filter((trade) => trade.profit > 0).length;
    const losses = resolved.filter((trade) => trade.profit <= 0).length;
    const totalProfit = resolved.reduce((sum, trade) => sum + trade.profit, 0);
    const averageRoi =
      resolved.length === 0
        ? 0
        : resolved.reduce((sum, trade) => sum + trade.roi, 0) / resolved.length;

    return {
      trades: trades.length,
      wins,
      losses,
      noExit: trades.length - resolved.length,
      winRate: resolved.length === 0 ? 0 : wins / resolved.length,
      totalProfit: round6(totalProfit),
      averageRoi: round6(averageRoi),
      maxDrawdown: round6(calculateMaxDrawdown(resolved))
    };
  }
}

export function calculateCryptoTakerFee(shares: number, price: number, feeRate = 0.07): number {
  const rawFee = shares * feeRate * price * (1 - price);
  if (rawFee < 0.000005) {
    return 0;
  }

  return Math.round(rawFee * 100_000) / 100_000;
}

function groupQuotes(quotes: ShortTermExitQuote[]): Map<string, ShortTermExitQuote[]> {
  const grouped = new Map<string, ShortTermExitQuote[]>();

  for (const quote of quotes) {
    const key = `${quote.marketId}:${quote.outcome}`;
    const series = grouped.get(key) ?? [];
    series.push(quote);
    grouped.set(key, series);
  }

  for (const series of grouped.values()) {
    series.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  return grouped;
}

function isEligibleEntry(
  quote: ShortTermExitQuote,
  config: ShortTermExitBacktestConfig
): boolean {
  const spread = quote.bestAsk.price - quote.bestBid.price;
  const shares = sharesForCashBudget(config.stakeUsd, quote.bestAsk.price, config.takerFeeRate);

  return (
    quote.bestAsk.price >= config.entryPriceMin &&
    quote.bestAsk.price <= config.entryPriceMax &&
    quote.secondsToClose >= config.entrySecondsMin &&
    quote.secondsToClose <= config.entrySecondsMax &&
    spread >= 0 &&
    spread <= config.maxSpread &&
    quote.liquidity >= config.minLiquidity &&
    quote.bestAsk.size >= shares
  );
}

function simulateTrade(
  series: ShortTermExitQuote[],
  entryIndex: number,
  config: ShortTermExitBacktestConfig
): ShortTermExitBacktestTrade {
  const entry = series[entryIndex];
  const shares = sharesForCashBudget(config.stakeUsd, entry.bestAsk.price, config.takerFeeRate);
  const buyFee = calculateCryptoTakerFee(shares, entry.bestAsk.price, config.takerFeeRate);
  const entryCost = shares * entry.bestAsk.price + buyFee;

  for (let index = entryIndex + 1; index < series.length; index++) {
    const quote = series[index];
    if (quote.bestBid.size < shares) {
      continue;
    }

    const elapsedSeconds = (quote.createdAt.getTime() - entry.createdAt.getTime()) / 1_000;
    const result = calculateExit(entryCost, shares, quote.bestBid.price, config);
    const timedOut = elapsedSeconds >= config.maxHoldSeconds;
    const closing = quote.secondsToClose <= config.forceExitSecondsToClose;

    if (result.roi >= config.takeProfit) {
      return buildTrade(entry, quote, shares, buyFee, result, "TAKE_PROFIT");
    }

    if (result.roi <= -config.stopLoss) {
      return buildTrade(entry, quote, shares, buyFee, result, "STOP_LOSS");
    }

    if (timedOut) {
      return buildTrade(entry, quote, shares, buyFee, result, "TIMEOUT");
    }

    if (closing) {
      return buildTrade(entry, quote, shares, buyFee, result, "MARKET_CLOSE");
    }
  }

  return {
    marketId: entry.marketId,
    assetSymbol: entry.assetSymbol,
    outcome: entry.outcome,
    enteredAt: entry.createdAt,
    exitedAt: null,
    entryAsk: entry.bestAsk.price,
    exitBid: null,
    shares: round6(shares),
    buyFee,
    sellFee: 0,
    profit: 0,
    roi: 0,
    exitReason: "NO_EXIT"
  };
}

function calculateExit(
  entryCost: number,
  shares: number,
  exitBid: number,
  config: ShortTermExitBacktestConfig
): { sellFee: number; profit: number; roi: number } {
  const sellFee = calculateCryptoTakerFee(shares, exitBid, config.takerFeeRate);
  const proceeds = shares * exitBid - sellFee;
  const profit = proceeds - entryCost;

  return {
    sellFee,
    profit,
    roi: profit / entryCost
  };
}

function buildTrade(
  entry: ShortTermExitQuote,
  exit: ShortTermExitQuote,
  shares: number,
  buyFee: number,
  result: { sellFee: number; profit: number; roi: number },
  exitReason: ShortTermExitReason
): ShortTermExitBacktestTrade {
  return {
    marketId: entry.marketId,
    assetSymbol: entry.assetSymbol,
    outcome: entry.outcome,
    enteredAt: entry.createdAt,
    exitedAt: exit.createdAt,
    entryAsk: entry.bestAsk.price,
    exitBid: exit.bestBid.price,
    shares: round6(shares),
    buyFee,
    sellFee: result.sellFee,
    profit: round6(result.profit),
    roi: round6(result.roi),
    exitReason
  };
}

function sharesForCashBudget(stakeUsd: number, price: number, feeRate: number): number {
  const feePerShare = feeRate * price * (1 - price);
  return stakeUsd / (price + feePerShare);
}

function calculateMaxDrawdown(trades: ShortTermExitBacktestTrade[]): number {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades.sort((left, right) => left.enteredAt.getTime() - right.enteredAt.getTime())) {
    equity += trade.profit;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return maxDrawdown;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
