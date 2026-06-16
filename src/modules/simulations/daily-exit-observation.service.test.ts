import { describe, expect, it } from "vitest";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import {
  ACTIVE_DAILY_STRATEGY_VERSIONS,
  DAILY_EXIT_STAKE_USD,
  DAILY_DOWN_ONLY_STRATEGY_VERSION,
  DAILY_EXIT_STRATEGY_VERSION,
  DAILY_FILTERED_STRATEGY_VERSION,
  calculateDailyExit,
  isDailyFilteredEntryEligible,
  isDailyEntryEligible,
  selectDailyEntryCandidate,
  shouldExitDailyCycle
} from "./daily-exit-observation.service";

function book(
  tokenId: string,
  bid: number,
  ask: number,
  size = 100
): PolymarketOrderBook {
  return {
    tokenId,
    bids: [{ price: String(bid), size: String(size) }],
    asks: [{ price: String(ask), size: String(size) }]
  };
}

describe("DailyExitObservationService policy", () => {
  it("uses the executable three-dollar minimum for daily observations", () => {
    expect(DAILY_EXIT_STAKE_USD).toBe(3);
    expect(DAILY_EXIT_STRATEGY_VERSION).toBe("DAILY_MULTI_CYCLE_NO_STOP_V1");
    expect(DAILY_FILTERED_STRATEGY_VERSION).toBe("DAILY_TREND_FILTERED_V2");
    expect(DAILY_DOWN_ONLY_STRATEGY_VERSION).toBe("DAILY_DOWN_ONLY_V3");
    expect(ACTIVE_DAILY_STRATEGY_VERSIONS).toEqual([
      DAILY_FILTERED_STRATEGY_VERSION,
      DAILY_DOWN_ONLY_STRATEGY_VERSION
    ]);
    expect(ACTIVE_DAILY_STRATEGY_VERSIONS).not.toContain(DAILY_EXIT_STRATEGY_VERSION);
  });

  it("requires three rising bids and a 0.30-0.49 entry for the filtered variant", () => {
    expect(
      isDailyFilteredEntryEligible({
        quote: {
          bestBid: 0.46,
          bidSize: 100,
          bestAsk: 0.47,
          askSize: 100,
          spread: 0.01
        },
        recentQuotes: [
          { bestBid: 0.46, bestAsk: 0.47 },
          { bestBid: 0.45, bestAsk: 0.46 },
          { bestBid: 0.44, bestAsk: 0.45 }
        ],
        orderBook: book("up", 0.46, 0.47)
      })
    ).toBe(true);

    expect(
      isDailyFilteredEntryEligible({
        quote: {
          bestBid: 0.46,
          bidSize: 100,
          bestAsk: 0.47,
          askSize: 100,
          spread: 0.01
        },
        recentQuotes: [
          { bestBid: 0.46, bestAsk: 0.47 },
          { bestBid: 0.46, bestAsk: 0.47 },
          { bestBid: 0.44, bestAsk: 0.45 }
        ],
        orderBook: book("up", 0.46, 0.47)
      })
    ).toBe(false);
  });

  it("accepts a low executable entry after a favorable drop", () => {
    expect(
      isDailyEntryEligible({
        quote: {
          bestBid: 0.28,
          bidSize: 100,
          bestAsk: 0.29,
          askSize: 100,
          spread: 0.01
        },
        recentQuotes: [
          { bestBid: 0.28, bestAsk: 0.29 },
          { bestBid: 0.3, bestAsk: 0.31 }
        ],
        orderBook: book("up", 0.28, 0.29)
      })
    ).toBe(true);
  });

  it("rejects wide spreads and entries outside the configured range", () => {
    expect(
      isDailyEntryEligible({
        quote: {
          bestBid: 0.1,
          bidSize: 100,
          bestAsk: 0.14,
          askSize: 100,
          spread: 0.04
        },
        recentQuotes: [
          { bestBid: 0.12, bestAsk: 0.15 },
          { bestBid: 0.13, bestAsk: 0.16 }
        ],
        orderBook: book("down", 0.1, 0.14)
      })
    ).toBe(false);
  });

  it("chooses the cheaper eligible outcome", () => {
    const selected = selectDailyEntryCandidate([
      {
        outcome: "UP",
        tokenId: "up",
        quote: {
          bestBid: 0.39,
          bidSize: 100,
          bestAsk: 0.4,
          askSize: 100,
          spread: 0.01
        }
      },
      {
        outcome: "DOWN",
        tokenId: "down",
        quote: {
          bestBid: 0.28,
          bidSize: 100,
          bestAsk: 0.29,
          askSize: 100,
          spread: 0.01
        }
      }
    ]);

    expect(selected?.outcome).toBe("DOWN");
  });

  it("sells at take profit without waiting for the final window", () => {
    expect(shouldExitDailyCycle(0.03, 20_000)).toBe(true);
    expect(shouldExitDailyCycle(0.02, 20_000)).toBe(false);
  });

  it("forces liquidation during the last twenty minutes without a stop loss", () => {
    expect(shouldExitDailyCycle(-0.4, 1_200)).toBe(true);
    expect(shouldExitDailyCycle(-0.4, 1_201)).toBe(false);
  });

  it("calculates net exit profit after taker fee", () => {
    const result = calculateDailyExit(1, 2, 0.55);

    expect(result.finalValue).toBeLessThan(1.1);
    expect(result.profit).toBe(result.finalValue - 1);
    expect(result.roi).toBe(result.profit);
  });
});
