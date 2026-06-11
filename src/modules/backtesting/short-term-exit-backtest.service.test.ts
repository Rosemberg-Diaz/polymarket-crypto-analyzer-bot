import { describe, expect, it } from "vitest";
import {
  calculateCryptoTakerFee,
  ShortTermExitBacktestConfig,
  ShortTermExitBacktestService,
  ShortTermExitQuote
} from "./short-term-exit-backtest.service";

const config: ShortTermExitBacktestConfig = {
  entryPriceMin: 0.1,
  entryPriceMax: 0.7,
  entrySecondsMin: 60,
  entrySecondsMax: 300,
  maxSpread: 0.06,
  minLiquidity: 100,
  takeProfit: 0.05,
  stopLoss: 0.05,
  maxHoldSeconds: 60,
  forceExitSecondsToClose: 20,
  stakeUsd: 1,
  takerFeeRate: 0.07
};

describe("ShortTermExitBacktestService", () => {
  const service = new ShortTermExitBacktestService();

  it("calculates the official crypto taker fee formula", () => {
    expect(calculateCryptoTakerFee(100, 0.5)).toBe(1.75);
  });

  it("exits at the first executable take-profit quote", () => {
    const trades = service.run([
      quote("2026-06-10T12:00:00Z", 180, 0.48, 0.5),
      quote("2026-06-10T12:00:10Z", 170, 0.58, 0.59),
      quote("2026-06-10T12:00:20Z", 160, 0.7, 0.71)
    ], config);

    expect(trades).toHaveLength(1);
    expect(trades[0].exitReason).toBe("TAKE_PROFIT");
    expect(trades[0].exitBid).toBe(0.58);
    expect(trades[0].profit).toBeGreaterThan(0);
  });

  it("applies stop-loss before a later recovery", () => {
    const trades = service.run([
      quote("2026-06-10T12:00:00Z", 180, 0.48, 0.5),
      quote("2026-06-10T12:00:10Z", 170, 0.42, 0.44),
      quote("2026-06-10T12:00:20Z", 160, 0.6, 0.61)
    ], config);

    expect(trades[0].exitReason).toBe("STOP_LOSS");
    expect(trades[0].exitBid).toBe(0.42);
    expect(trades[0].profit).toBeLessThan(0);
  });

  it("does not enter when top ask depth cannot fill the one-dollar observation", () => {
    const shallow = quote("2026-06-10T12:00:00Z", 180, 0.48, 0.5);
    shallow.bestAsk.size = 0.5;

    expect(service.run([shallow], config)).toHaveLength(0);
  });
});

function quote(
  timestamp: string,
  secondsToClose: number,
  bid: number,
  ask: number
): ShortTermExitQuote {
  return {
    marketId: "market-1",
    assetSymbol: "BTC",
    outcome: "UP",
    createdAt: new Date(timestamp),
    secondsToClose,
    liquidity: 1_000,
    bestBid: { price: bid, size: 100 },
    bestAsk: { price: ask, size: 100 }
  };
}
