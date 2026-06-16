import { describe, expect, it } from "vitest";
import { config } from "../../config/env";
import { isLiveShortExitEntryEligible } from "./live-short-exit-trading.service";

describe("LiveShortExitTradingService gate", () => {
  it("limits the real budget to three dollars", () => {
    expect(config.shortExitRealStakeUsd).toBeLessThanOrEqual(3);
  });

  it("allows only the validated BTC 5m entry filter", () => {
    const eligible = (
      asset: string,
      timeframe: string,
      price: number,
      spread: number,
      trigger = "RISING_BID_TIGHT_SPREAD"
    ) => isLiveShortExitEntryEligible(
      asset,
      timeframe,
      price,
      spread,
      trigger
    );

    expect(eligible("BTC", "5m", 0.58, 0.01)).toBe(true);
    expect(eligible("XRP", "5m", 0.58, 0.01)).toBe(false);
    expect(eligible("BTC", "15m", 0.58, 0.01)).toBe(false);
    expect(eligible("BTC", "5m", 0.54, 0.01)).toBe(false);
    expect(eligible("BTC", "5m", 0.61, 0.01)).toBe(false);
    expect(eligible("BTC", "5m", 0.58, 0.02)).toBe(false);
    expect(eligible("BTC", "5m", 0.58, 0.01, "WINDOW_END_EXECUTABLE"))
      .toBe(false);
  });
});
