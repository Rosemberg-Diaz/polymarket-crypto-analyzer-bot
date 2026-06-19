import { describe, expect, it } from "vitest";
import {
  CryptoSpotPrice,
  isFreshPolymarketChainlinkPrice
} from "./crypto-price.service";

function price(overrides: Partial<CryptoSpotPrice> = {}): CryptoSpotPrice {
  return {
    assetSymbol: "BTC",
    priceUsd: 65_000,
    source: "POLYMARKET_CHAINLINK",
    fetchedAt: new Date("2026-06-18T23:00:00.000Z"),
    receivedAt: new Date("2026-06-18T23:00:00.100Z"),
    ...overrides
  };
}

describe("isFreshPolymarketChainlinkPrice", () => {
  it("accepts a valid Chainlink tick inside the maximum age", () => {
    expect(
      isFreshPolymarketChainlinkPrice(
        price(),
        new Date("2026-06-18T23:00:02.500Z").getTime(),
        3_000
      )
    ).toBe(true);
  });

  it("rejects stale ticks and non-Chainlink fallbacks", () => {
    const now = new Date("2026-06-18T23:00:04.000Z").getTime();
    expect(isFreshPolymarketChainlinkPrice(price(), now, 3_000)).toBe(false);
    expect(
      isFreshPolymarketChainlinkPrice(
        price({ source: "COINBASE", fetchedAt: new Date(now) }),
        now,
        3_000
      )
    ).toBe(false);
  });

  it("rejects future, missing, and invalid prices", () => {
    const now = new Date("2026-06-18T23:00:00.000Z").getTime();
    expect(
      isFreshPolymarketChainlinkPrice(
        price({ fetchedAt: new Date(now + 1_000) }),
        now,
        3_000
      )
    ).toBe(false);
    expect(isFreshPolymarketChainlinkPrice(null, now, 3_000)).toBe(false);
    expect(
      isFreshPolymarketChainlinkPrice(price({ priceUsd: 0 }), now, 3_000)
    ).toBe(false);
  });
});
