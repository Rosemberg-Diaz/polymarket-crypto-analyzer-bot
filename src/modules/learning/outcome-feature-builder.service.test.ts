import { describe, expect, it } from "vitest";
import {
  buildOutcomeVector,
  normalizeCheckpoint
} from "./outcome-feature-builder.service";

describe("outcome feature normalization", () => {
  it("normalizes legacy seconds to the nearest comparable checkpoint", () => {
    expect(normalizeCheckpoint(27, "5m")).toBe(30);
    expect(normalizeCheckpoint(104, "5m")).toBe(120);
    expect(normalizeCheckpoint(780, "15m")).toBe(900);
  });

  it("builds finite vectors with asset and direction features", () => {
    const vector = buildOutcomeVector({
      assetSymbol: "SOL",
      timeframe: "5m",
      targetPrice: 100,
      currentAssetPrice: 101,
      distanceToTargetPercent: 0.01,
      secondsToClose: 60,
      impliedProbabilityUp: 0.65,
      checkpointSeconds: 60
    });

    expect(vector.every(Number.isFinite)).toBe(true);
    expect(vector[2]).toBe(1);
    expect(vector[12]).toBe(1);
  });
});
