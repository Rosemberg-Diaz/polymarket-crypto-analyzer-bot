import { describe, expect, it, vi } from "vitest";
import { NormalizedCryptoMarket } from "../crypto/crypto-market.types";
import {
  OfficialTargetResolverService,
  findClosestPricePoint,
  parseRtdsChainlinkPoints
} from "./official-target-resolver.service";

describe("OfficialTargetResolverService", () => {
  it("extracts a trusted target from explicit Polymarket raw data", async () => {
    const service = new OfficialTargetResolverService(undefined, {
      fetchFn: vi.fn() as unknown as typeof fetch
    });

    const result = await service.resolveOfficialTarget(makeMarket({
      rawData: JSON.stringify({
        priceToBeat: "67388.11"
      })
    }));

    expect(result.targetPrice).toBe(67388.11);
    expect(result.source).toBe("POLYMARKET_GAMMA");
    expect(result.trustedForLearning).toBe(true);
  });

  it("extracts a trusted target from Polymarket public UI payload text", async () => {
    const fetchFn = vi.fn(async () => new Response(
      "<html><body><span>Precio a superar</span><strong>$67,388.11</strong></body></html>",
      { status: 200 }
    )) as unknown as typeof fetch;
    const service = new OfficialTargetResolverService(undefined, { fetchFn });

    const result = await service.resolveOfficialTarget(makeMarket());

    expect(result.targetPrice).toBe(67388.11);
    expect(result.source).toBe("POLYMARKET_UI_PAYLOAD");
    expect(result.trustedForLearning).toBe(true);
  });

  it("extracts a trusted Chainlink opening price from Polymarket crypto-price API", async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ openPrice: 67551.51, closePrice: null, completed: false }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as unknown as typeof fetch;
    const service = new OfficialTargetResolverService(undefined, { fetchFn });

    const result = await service.resolveOfficialTarget(makeMarket({
      endDate: new Date("2026-06-02T17:45:00Z")
    }));

    expect(result.targetPrice).toBe(67551.51);
    expect(result.source).toBe("POLYMARKET_CRYPTO_PRICE_API");
    expect(result.trustedForLearning).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("eventStartTime=2026-06-02T17%3A40%3A00Z"),
      expect.any(Object)
    );
  });

  it("does not mark missing target as trusted", async () => {
    const fetchFn = vi.fn(async () => new Response("<html><body>No target here</body></html>", { status: 200 })) as unknown as typeof fetch;
    const service = new OfficialTargetResolverService(undefined, { fetchFn });

    const result = await service.resolveOfficialTarget(makeMarket());

    expect(result.targetPrice).toBeNull();
    expect(result.source).toBe("UNKNOWN");
    expect(result.trustedForLearning).toBe(false);
  });

  it("parses RTDS Chainlink points and finds the exact close timestamp", () => {
    const points = parseRtdsChainlinkPoints(JSON.stringify({
      payload: {
        symbol: "btc/usd",
        data: [
          { timestamp: 1780593299000, value: 63510.1 },
          { timestamp: 1780593300000, value: 63515.350385 },
          { timestamp: 1780593301000, value: 63516.2 }
        ]
      }
    }), "btc/usd");

    const closest = findClosestPricePoint(points, 1780593300000);

    expect(points).toHaveLength(3);
    expect(closest).toEqual({ timestamp: 1780593300000, value: 63515.350385 });
  });
});

function makeMarket(overrides: Partial<NormalizedCryptoMarket> = {}): NormalizedCryptoMarket {
  return {
    externalMarketId: "condition-1",
    slug: "btc-updown-5m-1780422000",
    question: "Bitcoin Up or Down - June 2, 1:40PM-1:45PM ET",
    category: "CRYPTO",
    assetSymbol: "BTC",
    baseAsset: "BTC",
    quoteAsset: "USD",
    marketType: "UP_DOWN_SHORT_TERM",
    timeframe: "5m",
    active: true,
    closed: false,
    endDate: new Date("2026-06-02T17:45:00Z"),
    resolutionSource: "https://data.chain.link/streams/btc-usd",
    targetPrice: null,
    targetPriceSource: "UNKNOWN",
    targetPriceTrustedForLearning: false,
    outcomes: [],
    tokenIds: [],
    isOperable: false,
    nonOperableReason: "Missing targetPrice for Up/Down strategy.",
    priorityScore: 0,
    rawData: "{}",
    ...overrides
  };
}
