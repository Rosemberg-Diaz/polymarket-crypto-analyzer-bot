import { describe, expect, it } from "vitest";
import { SignalResult } from "../signals/signal.types";
import { hasPersistablePredictionRule } from "./crypto-market-scanner.job";

describe("CryptoMarketScannerJob prediction persistence", () => {
  it("does not persist a signal without an entry rule", () => {
    expect(hasPersistablePredictionRule(makeSignal("NONE", "WAIT"))).toBe(false);
    expect(hasPersistablePredictionRule(makeSignal("NONE", "AVOID"))).toBe(false);
  });

  it("persists operational and observation rules", () => {
    expect(hasPersistablePredictionRule(makeSignal("ENTER_SMALL_STANDARD", "ENTER_SMALL"))).toBe(true);
    expect(hasPersistablePredictionRule(makeSignal("ENTER_SMALL_LIGHT", "ENTER_SMALL"))).toBe(true);
    expect(hasPersistablePredictionRule(makeSignal("OBSERVE_SMALL_LIGHT", "WAIT"))).toBe(true);
    expect(hasPersistablePredictionRule(makeSignal("OBSERVE_MODERATE_STANDARD", "WAIT"))).toBe(true);
  });
});

function makeSignal(entryRule: string, recommendation: SignalResult["recommendation"]): SignalResult {
  return {
    strategyName: "crypto-up-down-short-term",
    predictedOutcome: "UP",
    entryPrice: 0.65,
    impliedProbability: 0.65,
    botProbability: 0.67,
    edge: 0.02,
    recommendation,
    confidence: "MODERATE",
    reason: "test",
    features: { entryRule },
    confidenceAdjustment: 0,
    historicalSummary: "test"
  };
}
