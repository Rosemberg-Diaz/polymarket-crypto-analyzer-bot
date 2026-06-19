import { describe, expect, it } from "vitest";
import {
  estimateHigherTimeframeProbability,
  getDueHigherTimeframeCheckpoint
} from "./higher-timeframe-outcome-observation.job";

describe("higher-timeframe outcome checkpoints", () => {
  it("uses proportional checkpoints for 1h", () => {
    expect(getDueHigherTimeframeCheckpoint("1h", 720)).toBe(720);
    expect(getDueHigherTimeframeCheckpoint("1h", 455)).toBe(480);
    expect(getDueHigherTimeframeCheckpoint("1h", 400)).toBeNull();
  });

  it("uses proportional checkpoints for 4h", () => {
    expect(getDueHigherTimeframeCheckpoint("4h", 2880)).toBe(2880);
    expect(getDueHigherTimeframeCheckpoint("4h", 1900)).toBe(1920);
    expect(getDueHigherTimeframeCheckpoint("4h", 1800)).toBeNull();
  });

  it("raises confidence as directional distance grows", () => {
    const near = estimateHigherTimeframeProbability({
      distancePercent: 0.0002,
      secondsToClose: 720,
      timeframe: "1h"
    });
    const far = estimateHigherTimeframeProbability({
      distancePercent: 0.002,
      secondsToClose: 720,
      timeframe: "1h"
    });
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(0.95);
  });

  it("returns a probability below 0.5 when the asset is below target", () => {
    expect(
      estimateHigherTimeframeProbability({
        distancePercent: -0.001,
        secondsToClose: 1920,
        timeframe: "4h"
      })
    ).toBeLessThan(0.5);
  });
});
