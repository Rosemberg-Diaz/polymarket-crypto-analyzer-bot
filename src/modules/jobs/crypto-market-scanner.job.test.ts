import { describe, expect, it } from "vitest";
import { SignalResult } from "../signals/signal.types";
import {
  getHistoricalGateObservationType,
  hasPersistablePredictionRule
} from "./crypto-market-scanner.job";

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

  it("persists a STANDARD entry blocked by insufficient similar cases", () => {
    const signal = makeSignal("NONE", "WAIT");
    signal.features = {
      entryRule: "NONE",
      baseEntryRule: "ENTER_SMALL_STANDARD",
      blockedByHistoricalGate: true,
      blockedReason: "INSUFFICIENT_SIMILAR_CASES"
    };

    expect(hasPersistablePredictionRule(signal)).toBe(true);
    expect(getHistoricalGateObservationType(signal)).toBe(
      "OBSERVE_HISTORICAL_GATE_ENTER_SMALL_STANDARD_INSUFFICIENT_SIMILAR_CASES"
    );
  });

  it("persists a STANDARD entry blocked by a historical quality rule", () => {
    const signal = makeSignal("NONE", "WAIT");
    signal.features = {
      entryRule: "NONE",
      baseEntryRule: "ENTER_SMALL_STANDARD",
      blockedByHistoricalGate: true,
      blockedReason: "LOW_HISTORICAL_WIN_RATE"
    };

    expect(hasPersistablePredictionRule(signal)).toBe(true);
    expect(getHistoricalGateObservationType(signal)).toBe(
      "OBSERVE_HISTORICAL_GATE_ENTER_SMALL_STANDARD_LOW_HISTORICAL_WIN_RATE"
    );
  });

  it("persists a MODERATE candidate rejected by the real-entry timing gate", () => {
    const signal = makeSignal("NONE", "WAIT");
    signal.features = {
      entryRule: "NONE",
      baseEntryRule: "ENTER_MODERATE_STANDARD",
      blockedByHistoricalGate: true,
      blockedReason: "TOO_EARLY_FOR_REAL_ENTRY"
    };

    expect(hasPersistablePredictionRule(signal)).toBe(true);
    expect(getHistoricalGateObservationType(signal)).toBe(
      "OBSERVE_HISTORICAL_GATE_ENTER_MODERATE_STANDARD_TOO_EARLY_FOR_REAL_ENTRY"
    );
  });

  it("does not broaden observation to non-STANDARD entry rules", () => {
    const signal = makeSignal("NONE", "WAIT");
    signal.features = {
      entryRule: "NONE",
      baseEntryRule: "ENTER_SMALL_LIGHT",
      blockedByHistoricalGate: true,
      blockedReason: "INSUFFICIENT_SIMILAR_CASES"
    };

    expect(hasPersistablePredictionRule(signal)).toBe(false);
    expect(getHistoricalGateObservationType(signal)).toBeNull();
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
