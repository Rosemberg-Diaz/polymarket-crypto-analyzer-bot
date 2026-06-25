import { describe, expect, it } from "vitest";
import { LearningService, SimilarHistoricalPerformance } from "../learning/learning.service";
import { SignalEngine } from "./signal.engine";
import { SignalInput } from "./signal.types";

function makeInput(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    marketId: "market-1",
    marketSlug: "sol-updown-5m",
    marketQuestion: "SOL Up or Down in 5 minutes?",
    marketType: "UP_DOWN_SHORT_TERM",
    assetSymbol: "SOL",
    timeframe: "5m",
    targetPrice: 100,
    targetPriceSource: "POLYMARKET_RTDS_CHAINLINK",
    targetPriceTrustedForLearning: true,
    currentAssetPrice: 100.05,
    upPrice: 0.75,
    downPrice: 0.24,
    yesPrice: 0.75,
    noPrice: 0.24,
    spread: 0.02,
    liquidity: 500,
    volume: 1000,
    secondsToClose: 180,
    momentumLast30s: null,
    momentumLast60s: null,
    momentumLast120s: null,
    volatilityLast60s: null,
    volatilityLast120s: null,
    ...overrides
  };
}

function makeLearningService(result: SimilarHistoricalPerformance): LearningService {
  return {
    findSimilarHistoricalPerformance: async () => result
  } as LearningService;
}

describe("SignalEngine learning safeguards", () => {
  it("does not promote a base WAIT into an actionable signal", async () => {
    const engine = new SignalEngine(
      makeLearningService({
        totalSimilarCases: 30,
        wins: 27,
        losses: 3,
        winRate: 0.9,
        totalProfit: 25,
        averageRoi: 0.2,
        confidenceAdjustment: 0.04,
        historicalSummary: "Strong historical pattern."
      })
    );

    const signal = await engine.generateSignal(makeInput());

    expect(signal.recommendation).toBe("WAIT");
    expect(signal.features).toMatchObject({
      entryRule: "NONE",
      baseRecommendation: "WAIT",
      baseEntryRule: "NONE",
      finalRecommendation: "WAIT",
      finalEntryRule: "NONE",
      confidenceAdjustment: 0.04,
      similarCases: 30,
      blockedByHistoricalGate: false
    });
  });

  it("blocks moderate candidates when comparable historical learning is negative", async () => {
    const engine = new SignalEngine(
      makeLearningService({
        totalSimilarCases: 25,
        wins: 10,
        losses: 15,
        winRate: 0.4,
        totalProfit: -10,
        averageRoi: -0.08,
        confidenceAdjustment: -0.05,
        historicalSummary: "Weak historical pattern."
      })
    );

    const signal = await engine.generateSignal(
      makeInput({
        assetSymbol: "BTC",
        marketSlug: "btc-updown-15m",
        marketQuestion: "BTC Up or Down in 15 minutes?",
        timeframe: "15m",
        currentAssetPrice: 101.5,
        upPrice: 0.7,
        downPrice: 0.29,
        secondsToClose: 120,
        momentumLast30s: 0.06,
        momentumLast60s: 0.05,
        momentumLast120s: 0.04,
        volatilityLast60s: 0,
        volatilityLast120s: 0
      })
    );

    expect(signal.recommendation).toBe("WAIT");
    expect(signal.confidence).toBe("LOW");
    expect(signal.features).toMatchObject({
      entryRule: "NONE",
      baseRecommendation: "ENTER_MODERATE",
      baseEntryRule: "ENTER_MODERATE_STANDARD",
      finalRecommendation: "WAIT",
      finalEntryRule: "NONE",
      similarCases: 25,
      historicalWinRate: 0.4,
      historicalProfit: -10,
      confidenceAdjustment: 0,
      blockedByHistoricalGate: true
    });

    expect(String(signal.features.blockedReason)).toMatch(
      /LOW_HISTORICAL_WIN_RATE|NON_POSITIVE_HISTORICAL_PROFIT/
    );
  });

  it("keeps BTC LIGHT candidates observational even when learning is positive", async () => {
    const engine = new SignalEngine(
      makeLearningService({
        totalSimilarCases: 25,
        wins: 17,
        losses: 8,
        winRate: 0.68,
        totalProfit: 12,
        averageRoi: 0.06,
        confidenceAdjustment: 0.03,
        historicalSummary: "Positive historical pattern."
      })
    );

    const signal = await engine.generateSignal(
      makeInput({
        assetSymbol: "BTC",
        marketSlug: "btc-updown-15m",
        marketQuestion: "BTC Up or Down in 15 minutes?",
        timeframe: "15m",
        currentAssetPrice: 100.22,
        targetPrice: 100,
        upPrice: 0.55,
        downPrice: 0.44,
        secondsToClose: 90,
        momentumLast30s: null,
        momentumLast60s: null,
        momentumLast120s: null,
        volatilityLast60s: null,
        volatilityLast120s: null
      })
    );

    expect(signal.recommendation).toBe("WAIT");
    expect(signal.features).toMatchObject({
      entryRule: "OBSERVE_SMALL_LIGHT",
      baseRecommendation: "WAIT",
      baseEntryRule: "OBSERVE_SMALL_LIGHT",
      finalRecommendation: "WAIT",
      finalEntryRule: "OBSERVE_SMALL_LIGHT",
      confidenceAdjustment: 0.03,
      blockedByHistoricalGate: false
    });
  });

  it("allows SOL LIGHT UP candidates when comparable historical learning is positive", async () => {
    const engine = new SignalEngine(
      makeLearningService({
        totalSimilarCases: 25,
        wins: 17,
        losses: 8,
        winRate: 0.68,
        totalProfit: 12,
        averageRoi: 0.06,
        confidenceAdjustment: 0.03,
        historicalSummary: "Positive historical pattern."
      })
    );

    const signal = await engine.generateSignal(
      makeInput({
        assetSymbol: "SOL",
        marketSlug: "sol-updown-15m",
        marketQuestion: "SOL Up or Down in 15 minutes?",
        timeframe: "15m",
        currentAssetPrice: 100.22,
        targetPrice: 100,
        upPrice: 0.55,
        downPrice: 0.44,
        secondsToClose: 90,
        momentumLast30s: null,
        momentumLast60s: null,
        momentumLast120s: null,
        volatilityLast60s: null,
        volatilityLast120s: null
      })
    );

    expect(signal.recommendation).toBe("ENTER_SMALL");
    expect(signal.features).toMatchObject({
      entryRule: "ENTER_SMALL_LIGHT",
      baseRecommendation: "ENTER_SMALL",
      baseEntryRule: "ENTER_SMALL_LIGHT",
      finalRecommendation: "ENTER_SMALL",
      finalEntryRule: "ENTER_SMALL_LIGHT",
      similarCases: 25,
      historicalWinRate: 0.68,
      historicalProfit: 12,
      confidenceAdjustment: 0.03,
      blockedByHistoricalGate: false
    });
  });
});
