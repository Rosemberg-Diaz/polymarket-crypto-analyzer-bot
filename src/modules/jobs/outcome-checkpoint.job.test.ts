import { describe, expect, it } from "vitest";
import {
  extractScannerChainlinkPrice,
  getOutcomeCheckpointEntryRule,
  isLateFiveMinuteCheckpoint,
  LATE_FIVE_MINUTE_SHADOW_BUDGET_USD
} from "./outcome-checkpoint.job";
import { getDueOutcomePredictionCheckpoints } from "./crypto-market-scanner.job";

function scannerRawData(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    orderbookSummary: {
      spotPrice: {
        source: "POLYMARKET_CHAINLINK",
        priceUsd: 62_500.25,
        fetchedAt: "2026-06-19T05:00:00.000Z",
        ...overrides
      }
    }
  });
}

describe("extractScannerChainlinkPrice", () => {
  it("returns a fresh scanner Chainlink price with its source timestamp", () => {
    const result = extractScannerChainlinkPrice(
      {
        currentAssetPrice: 62_500.25,
        rawData: scannerRawData(),
        createdAt: new Date("2026-06-19T05:00:01.000Z")
      },
      "BTC",
      new Date("2026-06-19T05:00:30.000Z").getTime(),
      90_000
    );

    expect(result?.priceUsd).toBe(62_500.25);
    expect(result?.source).toBe("POLYMARKET_CHAINLINK");
    expect(result?.fetchedAt.toISOString()).toBe(
      "2026-06-19T05:00:00.000Z"
    );
  });

  it("rejects stale scanner prices and non-Chainlink sources", () => {
    const snapshot = {
      currentAssetPrice: 62_500.25,
      rawData: scannerRawData(),
      createdAt: new Date("2026-06-19T05:00:01.000Z")
    };
    expect(
      extractScannerChainlinkPrice(
        snapshot,
        "BTC",
        new Date("2026-06-19T05:02:00.001Z").getTime(),
        90_000
      )
    ).toBeNull();
    expect(
      extractScannerChainlinkPrice(
        {
          ...snapshot,
          rawData: scannerRawData({ source: "COINBASE" })
        },
        "BTC",
        new Date("2026-06-19T05:00:30.000Z").getTime(),
        90_000
      )
    ).toBeNull();
  });

  it("rejects malformed metadata instead of treating snapshot time as source time", () => {
    expect(
      extractScannerChainlinkPrice(
        {
          currentAssetPrice: 62_500.25,
          rawData: JSON.stringify({ orderbookSummary: {} }),
          createdAt: new Date("2026-06-19T05:00:01.000Z")
        },
        "BTC",
        new Date("2026-06-19T05:00:02.000Z").getTime(),
        90_000
      )
    ).toBeNull();
  });
});

describe("late 5m outcome checkpoints", () => {
  it("schedules independent 15s and 10s checkpoints", () => {
    expect(getDueOutcomePredictionCheckpoints(15)).toEqual([15]);
    expect(getDueOutcomePredictionCheckpoints(14)).toEqual([15]);
    expect(getDueOutcomePredictionCheckpoints(10)).toEqual([10]);
    expect(getDueOutcomePredictionCheckpoints(9)).toEqual([10]);
  });

  it("labels late checkpoints separately with a $1.50 shadow budget", () => {
    expect(isLateFiveMinuteCheckpoint(15)).toBe(true);
    expect(isLateFiveMinuteCheckpoint(10)).toBe(true);
    expect(isLateFiveMinuteCheckpoint(30)).toBe(false);
    expect(getOutcomeCheckpointEntryRule(15))
      .toBe("OBSERVE_LATE_OUTCOME_CHECKPOINT_15S");
    expect(getOutcomeCheckpointEntryRule(10))
      .toBe("OBSERVE_LATE_OUTCOME_CHECKPOINT_10S");
    expect(LATE_FIVE_MINUTE_SHADOW_BUDGET_USD).toBe(1.5);
  });
});
