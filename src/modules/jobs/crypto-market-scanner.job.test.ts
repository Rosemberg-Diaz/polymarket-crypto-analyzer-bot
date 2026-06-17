import { describe, expect, it } from "vitest";
import { SignalInput, SignalResult } from "../signals/signal.types";
import {
  EDGE_ONLY_CRYPTO_OBSERVATION_TYPE,
  getDueOutcomePredictionCheckpoints,
  getEdgeOnlyCryptoObservationType,
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

  it("captures fixed outcome checkpoints without backfilling stale windows", () => {
    // 5m markets: only 30s checkpoint
    expect(getDueOutcomePredictionCheckpoints(180, "5m")).toEqual([]);
    expect(getDueOutcomePredictionCheckpoints(103, "5m")).toEqual([]);
    expect(getDueOutcomePredictionCheckpoints(58, "5m")).toEqual([]);
    expect(getDueOutcomePredictionCheckpoints(20, "5m")).toEqual([30]);
    expect(getDueOutcomePredictionCheckpoints(10, "5m")).toEqual([30]);
    expect(getDueOutcomePredictionCheckpoints(220, "5m")).toEqual([]);
    
    // 15m markets: 180s, 120s, 60s checkpoints (max lateness = 45s)
    expect(getDueOutcomePredictionCheckpoints(180, "15m")).toEqual([180]);
    expect(getDueOutcomePredictionCheckpoints(103, "15m")).toEqual([120]);
    expect(getDueOutcomePredictionCheckpoints(58, "15m")).toEqual([60]);
    expect(getDueOutcomePredictionCheckpoints(20, "15m")).toEqual([60]); // 60-20=40 <= 45 max lateness
    expect(getDueOutcomePredictionCheckpoints(220, "15m")).toEqual([]);
  });

  it("observes all fast crypto assets using only edge", () => {
    const signal = makeSignal("NONE", "WAIT");
    signal.edge = 0.03;

    for (const asset of ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]) {
      expect(getEdgeOnlyCryptoObservationType(makeInput(asset, 250), signal)).toBe(
        EDGE_ONLY_CRYPTO_OBSERVATION_TYPE
      );
    }
  });

  it("does not broaden the edge-only observation outside its exact scope", () => {
    const signal = makeSignal("NONE", "WAIT");
    signal.edge = 0.03;

    expect(getEdgeOnlyCryptoObservationType(makeInput("OTHER", 99), signal)).toBeNull();

    signal.edge = 0.029999;
    expect(getEdgeOnlyCryptoObservationType(makeInput("XRP", 99), signal)).toBeNull();
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

function makeInput(assetSymbol: string, secondsToClose: number): SignalInput {
  return {
    marketId: "market-1",
    marketSlug: "sol-updown-5m-test",
    marketQuestion: "SOL Up or Down?",
    marketType: "UP_DOWN_SHORT_TERM",
    assetSymbol,
    timeframe: "5m",
    targetPrice: 100,
    targetPriceSource: "POLYMARKET_RTDS_CHAINLINK",
    targetPriceTrustedForLearning: true,
    currentAssetPrice: 101,
    upPrice: 0.6,
    downPrice: 0.4,
    yesPrice: null,
    noPrice: null,
    spread: 0.01,
    liquidity: 1000,
    volume: 1000,
    secondsToClose,
    momentumLast30s: null,
    momentumLast60s: null,
    momentumLast120s: null,
    volatilityLast60s: null,
    volatilityLast120s: null
  };
}
