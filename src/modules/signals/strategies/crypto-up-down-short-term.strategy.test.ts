import { describe, expect, it } from "vitest";
import { SignalInput } from "../signal.types";
import { CryptoUpDownShortTermStrategy } from "./crypto-up-down-short-term.strategy";

const strategy = new CryptoUpDownShortTermStrategy();

function makeInput(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    marketId: "m1",
    marketSlug: "btc-up-down-5m",
    marketQuestion: "BTC Up or Down in 5 minutes?",
    marketType: "UP_DOWN_SHORT_TERM",
    assetSymbol: "BTC",
    timeframe: "5m",
    targetPrice: 100,
    targetPriceSource: "POLYMARKET_RTDS_CHAINLINK",
    targetPriceTrustedForLearning: true,
    currentAssetPrice: 101,
    upPrice: 0.55,
    downPrice: 0.45,
    yesPrice: 0.55,
    noPrice: 0.45,
    spread: 0.02,
    liquidity: 500,
    volume: 1000,
    secondsToClose: 60,
    momentumLast30s: 0.02,
    momentumLast60s: 0.01,
    momentumLast120s: 0.01,
    volatilityLast60s: 0.01,
    volatilityLast120s: 0.01,
    ...overrides
  };
}

describe("CryptoUpDownShortTermStrategy", () => {
  it("returns AVOID for high spread", () => {
    const result = strategy.evaluate(makeInput({ spread: 0.2 }));
    expect(result.recommendation).toBe("AVOID");
    expect(result.reason).toBe("Spread demasiado alto");
  });

  it("returns AVOID for low liquidity", () => {
    const result = strategy.evaluate(makeInput({ liquidity: 1 }));
    expect(result.recommendation).toBe("AVOID");
    expect(result.reason).toBe("Liquidez insuficiente");
  });

  it("returns WAIT when price is near target and a lot of time remains", () => {
    const result = strategy.evaluate(
      makeInput({
        currentAssetPrice: 100.05,
        targetPrice: 100,
        secondsToClose: 180
      })
    );
    expect(result.recommendation).toBe("WAIT");
    expect(result.reason).toContain("Precio muy cerca");
  });

  it("favors UP when current price is above target", () => {
    const result = strategy.evaluate(makeInput({ currentAssetPrice: 102, targetPrice: 100 }));
    expect(result.predictedOutcome).toBe("UP");
    expect(result.entryPrice).toBe(0.55);
  });

  it("favors DOWN when current price is below target", () => {
    const result = strategy.evaluate(
      makeInput({
        currentAssetPrice: 98,
        targetPrice: 100,
        upPrice: 0.45,
        downPrice: 0.55,
        yesPrice: 0.45,
        noPrice: 0.55,
        momentumLast30s: -0.02,
        momentumLast60s: -0.01,
        momentumLast120s: -0.01
      })
    );
    expect(result.predictedOutcome).toBe("DOWN");
    expect(result.entryPrice).toBe(0.55);
  });

  it.each(["BTC", "ETH", "SOL"] as const)("works with %s", (assetSymbol) => {
    const result = strategy.evaluate(makeInput({ assetSymbol }));
    expect(result.strategyName).toBe("crypto-up-down-short-term-v1");
    expect(result.predictedOutcome).toBe("UP");
  });

  it("marks conditional light entries separately from standard small entries", () => {
    const result = strategy.evaluate(
      makeInput({
        currentAssetPrice: 100.22,
        targetPrice: 100,
        upPrice: 0.55,
        downPrice: 0.44,
        yesPrice: 0.55,
        noPrice: 0.44,
        spread: 0.02,
        secondsToClose: 90,
        momentumLast30s: null,
        momentumLast60s: null,
        momentumLast120s: null,
        volatilityLast60s: null,
        volatilityLast120s: null
      })
    );

    expect(result.recommendation).toBe("ENTER_SMALL");
    expect(result.features.entryRule).toBe("ENTER_SMALL_LIGHT");
    expect(result.reason).toContain("Regla de entrada: ENTER_SMALL_LIGHT");
  });

  it("does not use light entries when target is not official", () => {
    const result = strategy.evaluate(
      makeInput({
        currentAssetPrice: 100.22,
        targetPrice: 100,
        targetPriceSource: "LOCAL_SPOT_APPROXIMATION",
        targetPriceTrustedForLearning: false,
        upPrice: 0.55,
        downPrice: 0.44,
        spread: 0.02,
        secondsToClose: 90,
        momentumLast30s: null,
        momentumLast60s: null,
        momentumLast120s: null,
        volatilityLast60s: null,
        volatilityLast120s: null
      })
    );

    expect(result.recommendation).toBe("WAIT");
    expect(result.features.entryRule).toBe("NONE");
  });

  it("allows light entries with lower edge and entry price up to 0.82", () => {
    const result = strategy.evaluate(
      makeInput({
        currentAssetPrice: 100.13,
        targetPrice: 100,
        upPrice: 0.81,
        downPrice: 0.18,
        spread: 0.035,
        secondsToClose: 35,
        momentumLast30s: null,
        momentumLast60s: null,
        momentumLast120s: null,
        volatilityLast60s: null,
        volatilityLast120s: null
      })
    );

    expect(result.recommendation).toBe("ENTER_SMALL");
    expect(result.features.entryRule).toBe("ENTER_SMALL_LIGHT");
  });
});
