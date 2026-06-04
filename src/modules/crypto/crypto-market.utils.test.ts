import { describe, expect, it } from "vitest";
import {
  inferAssetSymbol,
  inferCryptoMarketType,
  inferTimeframe
} from "./crypto-market.utils";

describe("CryptoMarketUtils", () => {
  it("detects BTC", () => {
    expect(inferAssetSymbol("Bitcoin up or down?", "btc-up-down", null)).toBe("BTC");
  });

  it("detects ETH", () => {
    expect(inferAssetSymbol("Ethereum above target?", "eth-above", null)).toBe("ETH");
  });

  it("detects SOL", () => {
    expect(inferAssetSymbol("SOL up or down?", "sol-up-down", null)).toBe("SOL");
  });

  it("detects UP_DOWN_SHORT_TERM", () => {
    expect(inferCryptoMarketType("BTC Up or Down in 5 minutes?", "btc-up-down-5m", null)).toBe(
      "UP_DOWN_SHORT_TERM"
    );
  });

  it("detects timeframe 5m", () => {
    expect(inferTimeframe("BTC Up or Down in 5 minutes?", "btc-5m", null)).toBe("5m");
  });

  it("detects timeframe 15m", () => {
    expect(inferTimeframe("SOL Up or Down in 15 minutes?", "sol-15m", null)).toBe("15m");
  });
});
