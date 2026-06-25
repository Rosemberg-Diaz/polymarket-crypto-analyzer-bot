import {
  CryptoAsset,
  CryptoMarketType,
  SUPPORTED_CRYPTO_ASSETS,
  SUPPORTED_CRYPTO_MARKET_TYPES
} from "../../config/assets";
import { LearningService } from "../learning/learning.service";
import { CryptoUpDownShortTermStrategy } from "./strategies/crypto-up-down-short-term.strategy";
import { MomentumTimeBasedStrategy } from "./strategies/momentum-time-based.strategy";
import { Confidence, Recommendation, SignalInput, SignalResult } from "./signal.types";

const REAL_GATE_MIN_SIMILAR_CASES = 5;
const REAL_GATE_MIN_WIN_RATE = 0.6;
const REAL_GATE_MIN_TOTAL_PROFIT = 0;
const REAL_GATE_MAX_SECONDS_TO_CLOSE = 210;
const REAL_GATE_CHEAP_DOWN_ENTRY_PRICE = 0.6;
const REAL_GATE_CHEAP_DOWN_MIN_SECONDS_TO_CLOSE = 180;

type HistoricalPerformanceForGate = Awaited<ReturnType<LearningService["findSimilarHistoricalPerformance"]>>;

export class SignalEngine {
  private readonly upDownShortTermStrategy = new CryptoUpDownShortTermStrategy();
  private readonly momentumTimeBasedStrategy = new MomentumTimeBasedStrategy();

  constructor(private readonly learningService = new LearningService()) {}

  async generateSignal(input: SignalInput): Promise<SignalResult> {
    const cryptoValidation = this.validateCryptoInput(input);
    if (!cryptoValidation.isValid) {
      return createAvoidSignal("signal-engine-validation", cryptoValidation.reason);
    }

    let baseSignal: SignalResult;

    if (input.marketType === "UP_DOWN_SHORT_TERM") {
      if (input.timeframe === "5m") {
        baseSignal = this.momentumTimeBasedStrategy.evaluate(input);
      } else {
        baseSignal = this.upDownShortTermStrategy.evaluate(input);
      }
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

    const historicalGate = validateEntryAgainstHistoricalRegime(input, signal, baseEntryRule, performance);

    if (!historicalGate.allowed) {
      return blockEntryWithLearningReason(
        signal,
        baseRecommendation,
        baseEntryRule,
        performance,
        historicalGate.blockedReason,
        historicalGate.reason
      );
    }

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
          historicalProfit: performance.totalProfit,
          historicalAverageRoi: performance.averageRoi,
          confidenceAdjustment: 0,
          blockedByHistoricalGate: false
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
        historicalAverageRoi: performance.averageRoi,
        confidenceAdjustment: performance.confidenceAdjustment,
        blockedByHistoricalGate: false
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

function isEntryRecommendation(recommendation: Recommendation): boolean {
  return recommendation === "ENTER_SMALL" || recommendation === "ENTER_MODERATE";
}

function validateEntryAgainstHistoricalRegime(
  input: SignalInput,
  signal: SignalResult,
  baseEntryRule: string,
  performance: HistoricalPerformanceForGate
): { allowed: true } | { allowed: false; blockedReason: string; reason: string } {
  if (!isEntryRecommendation(signal.recommendation)) {
    return { allowed: true };
  }

  if (!baseEntryRule.startsWith("ENTER_")) {
    return { allowed: true };
  }

  const secondsToClose = input.secondsToClose ?? 0;

  if (secondsToClose > REAL_GATE_MAX_SECONDS_TO_CLOSE) {
    return {
      allowed: false,
      blockedReason: "TOO_EARLY_FOR_REAL_ENTRY",
      reason: `faltan ${secondsToClose}s para cerrar; maximo permitido ${REAL_GATE_MAX_SECONDS_TO_CLOSE}s`
    };
  }

  if (
    signal.predictedOutcome === "DOWN" &&
    signal.entryPrice < REAL_GATE_CHEAP_DOWN_ENTRY_PRICE &&
    secondsToClose > REAL_GATE_CHEAP_DOWN_MIN_SECONDS_TO_CLOSE
  ) {
    return {
      allowed: false,
      blockedReason: "CHEAP_DOWN_EARLY_RISK",
      reason:
        `DOWN barato y temprano: entryPrice=${signal.entryPrice}, secondsToClose=${secondsToClose}. ` +
        "Ese patron explico la mayor parte de las perdidas recientes."
    };
  }

  if (performance.totalSimilarCases < REAL_GATE_MIN_SIMILAR_CASES) {
    return {
      allowed: false,
      blockedReason: "INSUFFICIENT_SIMILAR_CASES",
      reason:
        `solo hay ${performance.totalSimilarCases} casos similares; ` +
        `minimo requerido ${REAL_GATE_MIN_SIMILAR_CASES}`
    };
  }

  if (performance.winRate < REAL_GATE_MIN_WIN_RATE) {
    return {
      allowed: false,
      blockedReason: "LOW_HISTORICAL_WIN_RATE",
      reason:
        `win rate historico comparable ${(performance.winRate * 100).toFixed(2)}%; ` +
        `minimo requerido ${(REAL_GATE_MIN_WIN_RATE * 100).toFixed(2)}%`
    };
  }

  if (performance.totalProfit <= REAL_GATE_MIN_TOTAL_PROFIT) {
    return {
      allowed: false,
      blockedReason: "NON_POSITIVE_HISTORICAL_PROFIT",
      reason:
        `profit historico comparable ${performance.totalProfit}; ` +
        `debe ser mayor a ${REAL_GATE_MIN_TOTAL_PROFIT}`
    };
  }

  return { allowed: true };
}

function blockEntryWithLearningReason(
  signal: SignalResult,
  baseRecommendation: Recommendation,
  baseEntryRule: string,
  performance: HistoricalPerformanceForGate,
  blockedReason: string,
  blockReason: string
): SignalResult {
  return {
    ...signal,
    recommendation: "WAIT",
    confidence: "LOW",
    reason: `${signal.reason} ${performance.historicalSummary} Bloqueado: ${blockReason}.`,
    historicalSummary: performance.historicalSummary,
    confidenceAdjustment: 0,
    features: {
      ...signal.features,
      entryRule: "NONE",
      baseRecommendation,
      baseEntryRule,
      finalRecommendation: "WAIT",
      finalEntryRule: "NONE",
      similarCases: performance.totalSimilarCases,
      historicalWinRate: performance.winRate,
      historicalProfit: performance.totalProfit,
      historicalAverageRoi: performance.averageRoi,
      confidenceAdjustment: 0,
      blockedReason,
      blockedByHistoricalGate: true
    }
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