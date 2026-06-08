import {
  CryptoAsset,
  CryptoMarketType,
  SUPPORTED_CRYPTO_ASSETS,
  SUPPORTED_CRYPTO_MARKET_TYPES
} from "../../config/assets";
import { LearningService } from "../learning/learning.service";
import { CryptoUpDownShortTermStrategy } from "./strategies/crypto-up-down-short-term.strategy";
import { Confidence, Recommendation, SignalInput, SignalResult } from "./signal.types";

export class SignalEngine {
  private readonly upDownShortTermStrategy = new CryptoUpDownShortTermStrategy();

  constructor(private readonly learningService = new LearningService()) {}

  async generateSignal(input: SignalInput): Promise<SignalResult> {
    const cryptoValidation = this.validateCryptoInput(input);
    if (!cryptoValidation.isValid) {
      return createAvoidSignal("signal-engine-validation", cryptoValidation.reason);
    }

    let baseSignal: SignalResult;

    if (input.marketType === "UP_DOWN_SHORT_TERM") {
      baseSignal = this.upDownShortTermStrategy.evaluate(input);
    } else {
      baseSignal = createAvoidSignal(
        "signal-engine-router",
        `Market type ${input.marketType} is crypto but has no deterministic strategy enabled yet.`
      );
    }

    return this.applyLearning(input, baseSignal);
  }

  private validateCryptoInput(input: SignalInput): { isValid: true } | { isValid: false; reason: string } {
    if (!input.marketId || !input.marketQuestion) {
      return { isValid: false, reason: "Market id and question are required to generate a signal." };
    }

    if (!SUPPORTED_CRYPTO_ASSETS.includes(input.assetSymbol as CryptoAsset)) {
      return {
        isValid: false,
        reason: `Market asset ${input.assetSymbol || "unknown"} is not a supported crypto asset.`
      };
    }

    if (!SUPPORTED_CRYPTO_MARKET_TYPES.includes(input.marketType as CryptoMarketType)) {
      return {
        isValid: false,
        reason: `Market type ${input.marketType || "unknown"} is not a supported crypto market type.`
      };
    }

    return { isValid: true };
  }

  private async applyLearning(input: SignalInput, signal: SignalResult): Promise<SignalResult> {
    const baseRecommendation = signal.recommendation;
    const baseEntryRule = getEntryRule(signal.features);
    const performance = await this.learningService.findSimilarHistoricalPerformance({
      strategyName: signal.strategyName,
      marketType: input.marketType,
      assetSymbol: input.assetSymbol,
      predictedOutcome: signal.predictedOutcome,
      entryPrice: signal.entryPrice,
      secondsToClose: input.secondsToClose,
      distanceToTarget:
        input.currentAssetPrice !== null && input.targetPrice !== null
          ? input.currentAssetPrice - input.targetPrice
          : null,
      spread: input.spread,
      liquidity: input.liquidity,
      timeframe: input.timeframe
    });

    if (performance.confidenceAdjustment === 0) {
      return {
        ...signal,
        historicalSummary: performance.historicalSummary,
        confidenceAdjustment: 0,
        features: {
          ...signal.features,
          baseRecommendation,
          baseEntryRule,
          finalRecommendation: signal.recommendation,
          finalEntryRule: baseEntryRule,
          similarCases: performance.totalSimilarCases,
          historicalWinRate: performance.winRate,
          historicalProfit: performance.totalProfit
        }
      };
    }

    const adjustedBotProbability = clamp(signal.botProbability + performance.confidenceAdjustment, 0.01, 0.99);
    const adjustedEdge = adjustedBotProbability - signal.impliedProbability;
    const finalRecommendation = adjustRecommendation(
      signal.recommendation,
      performance.confidenceAdjustment,
      adjustedEdge
    );
    const finalEntryRule = getFinalEntryRule(baseEntryRule, baseRecommendation, finalRecommendation);

    return {
      ...signal,
      botProbability: round6(adjustedBotProbability),
      edge: round6(adjustedEdge),
      recommendation: finalRecommendation,
      confidence: adjustConfidence(signal.confidence, performance.confidenceAdjustment),
      reason: `${signal.reason} ${performance.historicalSummary}`,
      historicalSummary: performance.historicalSummary,
      confidenceAdjustment: performance.confidenceAdjustment,
      features: {
        ...signal.features,
        entryRule: finalEntryRule,
        baseRecommendation,
        baseEntryRule,
        finalRecommendation,
        finalEntryRule,
        similarCases: performance.totalSimilarCases,
        historicalWinRate: performance.winRate,
        historicalProfit: performance.totalProfit,
        confidenceAdjustment: performance.confidenceAdjustment
      }
    };
  }
}

function createAvoidSignal(strategyName: string, reason: string): SignalResult {
  return {
    strategyName,
    predictedOutcome: "YES",
    entryPrice: 0,
    impliedProbability: 0,
    botProbability: 0,
    edge: 0,
    recommendation: "AVOID",
    confidence: "LOW",
    reason,
    features: {
      priceSource: "NONE",
      selectedPrice: 0,
      oppositePrice: 0,
      spread: null,
      liquidity: null,
      volume: null,
      secondsToClose: null,
      momentumScore: 0,
      volatilityPenalty: 0,
      dataCompleteness: 0
    },
    confidenceAdjustment: 0,
    historicalSummary: "Esta senal no ha sido comparada todavia contra casos historicos similares."
  };
}

function adjustRecommendation(
  current: Recommendation,
  adjustment: number,
  adjustedEdge: number
): Recommendation {
  if (current === "AVOID") {
    return "AVOID";
  }

  if (adjustment < 0 && current === "ENTER_MODERATE") {
    return "ENTER_SMALL";
  }

  if (adjustment < 0 && current === "ENTER_SMALL") {
    return adjustedEdge > 0 ? "WAIT" : "AVOID";
  }

  if (adjustment < 0 && current === "WAIT" && adjustedEdge <= 0) {
    return "AVOID";
  }

  return current;
}

function getEntryRule(features: SignalResult["features"]): string {
  const value = (features as Record<string, unknown>).entryRule;
  return typeof value === "string" ? value : "NONE";
}

function getFinalEntryRule(
  baseEntryRule: string,
  baseRecommendation: Recommendation,
  finalRecommendation: Recommendation
): string {
  if (finalRecommendation === "WAIT" && baseEntryRule.startsWith("OBSERVE_")) {
    return baseEntryRule;
  }

  if (finalRecommendation === "WAIT" || finalRecommendation === "AVOID") {
    return "NONE";
  }

  if (baseRecommendation === "ENTER_MODERATE" && finalRecommendation === "ENTER_SMALL") {
    return "ENTER_SMALL_LEARNING_DEFENSIVE";
  }

  return baseEntryRule;
}

function adjustConfidence(current: Confidence, adjustment: number): Confidence {
  const levels: Confidence[] = ["LOW", "MODERATE", "HIGH"];
  const currentIndex = levels.indexOf(current);

  if (adjustment > 0) {
    return levels[Math.min(levels.length - 1, currentIndex + 1)];
  }

  if (adjustment < 0) {
    return levels[Math.max(0, currentIndex - 1)];
  }

  return current;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
