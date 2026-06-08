import { config } from "../../../config/env";
import {
  Confidence,
  PredictedOutcome,
  Recommendation,
  SignalInput,
  SignalResult
} from "../signal.types";

interface StrategyFeatures extends Record<string, unknown> {
  assetSymbol: string;
  marketType: string;
  targetPrice: number | null;
  currentAssetPrice: number | null;
  distanceToTarget: number | null;
  absDistance: number | null;
  distancePercent: number | null;
  secondsToClose: number | null;
  spread: number | null;
  liquidity: number | null;
  volume: number | null;
  momentumScore: number;
  volatilityPenalty: number;
  strongDistance: boolean;
  highEntryPrice: boolean;
  targetPriceSource: string | null;
  targetPriceTrustedForLearning: boolean;
  entryRule:
    | "NONE"
    | "ENTER_SMALL_STANDARD"
    | "ENTER_SMALL_LIGHT"
    | "ENTER_MODERATE_STANDARD"
    | "OBSERVE_SMALL_LIGHT"
    | "OBSERVE_MODERATE_STANDARD";
}

interface RecommendationDecision {
  recommendation: Recommendation;
  entryRule: StrategyFeatures["entryRule"];
}

export class CryptoUpDownShortTermStrategy {
  readonly strategyName = "crypto-up-down-short-term-v1";

  evaluate(input: SignalInput): SignalResult {
    if (input.spread !== null && input.spread > config.maxSpread) {
      return this.avoid("Spread demasiado alto", input);
    }

    if (input.liquidity !== null && input.liquidity < config.minLiquidity) {
      return this.avoid("Liquidez insuficiente", input);
    }

    if (input.targetPrice === null || input.currentAssetPrice === null) {
      return this.avoid("Faltan datos esenciales", input);
    }

    if (input.targetPrice <= 0) {
      return this.avoid("Faltan datos esenciales: targetPrice debe ser mayor a cero", input);
    }

    const distanceToTarget = input.currentAssetPrice - input.targetPrice;
    const absDistance = Math.abs(distanceToTarget);
    const distancePercent = distanceToTarget / input.targetPrice;
    const absDistancePercent = Math.abs(distancePercent);
    const secondsToClose = input.secondsToClose ?? 0;

    if (absDistancePercent < 0.001 && secondsToClose > 120) {
      return this.wait(
        "Precio muy cerca del target y aun falta mucho tiempo",
        input,
        this.buildFeatures(input, distanceToTarget, absDistance, distancePercent, 0, 0)
      );
    }

    const predictedOutcome: PredictedOutcome = input.currentAssetPrice > input.targetPrice ? "UP" : "DOWN";
    const entryPrice = predictedOutcome === "UP" ? input.upPrice : input.downPrice;

    if (!isValidEntryPrice(entryPrice)) {
      return this.avoid(
        `Faltan datos esenciales: precio de entrada ${predictedOutcome} invalido`,
        input,
        this.buildFeatures(input, distanceToTarget, absDistance, distancePercent, 0, 0)
      );
    }

    const impliedProbability = entryPrice;
    const momentumScore = calculateMomentumScore(input, predictedOutcome);
    const volatilityPenalty = calculateVolatilityPenalty(input);
    const strongDistance = absDistancePercent >= 0.004;
    const highEntryPrice = entryPrice > 0.82;

    if (entryPrice > 0.82 && !(secondsToClose < 45 && strongDistance)) {
      return this.avoid(
        "Precio de entrada mayor a 0.82 sin suficiente ventaja por tiempo/distancia",
        input,
        this.buildFeatures(input, distanceToTarget, absDistance, distancePercent, momentumScore, volatilityPenalty)
      );
    }

    const botProbability = this.estimateBotProbability({
      impliedProbability,
      predictedOutcome,
      distancePercent,
      secondsToClose,
      momentumScore,
      volatilityPenalty,
      entryPrice
    });
    const edge = botProbability - impliedProbability;
    const recommendationDecision = decideRecommendation({
      edge,
      highEntryPrice,
      secondsToClose,
      strongDistance,
      entryPrice,
      spread: input.spread,
      distancePercent,
      predictedOutcome,
      assetSymbol: input.assetSymbol,
      targetPriceTrustedForLearning: input.targetPriceTrustedForLearning === true
    });
    const recommendation = recommendationDecision.recommendation;
    const confidence = decideConfidence(edge, absDistancePercent, secondsToClose, input);
    const features = this.buildFeatures(
      input,
      distanceToTarget,
      absDistance,
      distancePercent,
      momentumScore,
      volatilityPenalty,
      recommendationDecision.entryRule
    );

    return {
      strategyName: this.strategyName,
      predictedOutcome,
      entryPrice: round6(entryPrice),
      impliedProbability: round6(impliedProbability),
      botProbability: round6(botProbability),
      edge: round6(edge),
      recommendation,
      confidence,
      reason: this.buildReason({
        input,
        targetPrice: input.targetPrice,
        currentAssetPrice: input.currentAssetPrice,
        distanceToTarget,
        distancePercent,
        secondsToClose,
        entryPrice,
        impliedProbability,
        botProbability,
        edge,
        recommendation,
        predictedOutcome,
        entryRule: recommendationDecision.entryRule
      }),
      features,
      confidenceAdjustment: 0,
      historicalSummary: "Esta senal no ha sido comparada todavia contra casos historicos similares."
    };
  }

  private estimateBotProbability(params: {
    impliedProbability: number;
    predictedOutcome: PredictedOutcome;
    distancePercent: number;
    secondsToClose: number;
    momentumScore: number;
    volatilityPenalty: number;
    entryPrice: number;
  }): number {
    const directionMultiplier = params.predictedOutcome === "UP" ? 1 : -1;
    const favorableDistance = params.distancePercent * directionMultiplier;
    let probability = params.impliedProbability;

    probability += clamp(favorableDistance * 8, 0, 0.12);

    if (params.secondsToClose < 45 && favorableDistance > 0) {
      probability += clamp(favorableDistance * 12, 0.02, 0.1);
    } else if (params.secondsToClose < 120 && favorableDistance > 0) {
      probability += clamp(favorableDistance * 6, 0.01, 0.06);
    }

    probability += clamp(params.momentumScore, -0.06, 0.06);
    probability -= params.volatilityPenalty;

    if (params.entryPrice > 0.82 && !(params.secondsToClose < 45 && favorableDistance >= 0.004)) {
      probability -= 0.08;
    }

    return clamp(probability, 0.01, 0.99);
  }

  private avoid(reason: string, input: SignalInput, features?: StrategyFeatures): SignalResult {
    return this.staticResult("AVOID", reason, input, features);
  }

  private wait(reason: string, input: SignalInput, features?: StrategyFeatures): SignalResult {
    return this.staticResult("WAIT", reason, input, features);
  }

  private staticResult(
    recommendation: Recommendation,
    reason: string,
    input: SignalInput,
    features?: StrategyFeatures
  ): SignalResult {
    return {
      strategyName: this.strategyName,
      predictedOutcome: "UP",
      entryPrice: 0,
      impliedProbability: 0,
      botProbability: 0,
      edge: 0,
      recommendation,
      confidence: "LOW",
      reason,
      features:
        features ??
        this.buildFeatures(
          input,
          input.currentAssetPrice !== null && input.targetPrice !== null
            ? input.currentAssetPrice - input.targetPrice
            : null,
          input.currentAssetPrice !== null && input.targetPrice !== null
            ? Math.abs(input.currentAssetPrice - input.targetPrice)
            : null,
          input.currentAssetPrice !== null && input.targetPrice !== null && input.targetPrice > 0
            ? (input.currentAssetPrice - input.targetPrice) / input.targetPrice
            : null,
          0,
          0
        ),
      confidenceAdjustment: 0,
      historicalSummary: "Esta senal no ha sido comparada todavia contra casos historicos similares."
    };
  }

  private buildFeatures(
    input: SignalInput,
    distanceToTarget: number | null,
    absDistance: number | null,
    distancePercent: number | null,
    momentumScore: number,
    volatilityPenalty: number,
    entryRule: StrategyFeatures["entryRule"] = "NONE"
  ): StrategyFeatures {
    return {
      assetSymbol: input.assetSymbol,
      marketType: input.marketType,
      targetPrice: nullableRound6(input.targetPrice),
      currentAssetPrice: nullableRound6(input.currentAssetPrice),
      distanceToTarget: nullableRound6(distanceToTarget),
      absDistance: nullableRound6(absDistance),
      distancePercent: nullableRound6(distancePercent),
      secondsToClose: input.secondsToClose,
      spread: nullableRound6(input.spread),
      liquidity: nullableRound6(input.liquidity),
      volume: nullableRound6(input.volume),
      momentumScore: round6(momentumScore),
      volatilityPenalty: round6(volatilityPenalty),
      strongDistance: distancePercent !== null && Math.abs(distancePercent) >= 0.004,
      highEntryPrice: Boolean((input.upPrice !== null && input.upPrice > 0.82) || (input.downPrice !== null && input.downPrice > 0.82)),
      targetPriceSource: input.targetPriceSource ?? null,
      targetPriceTrustedForLearning: input.targetPriceTrustedForLearning === true,
      entryRule
    };
  }

  private buildReason(params: {
    input: SignalInput;
    targetPrice: number;
    currentAssetPrice: number;
    distanceToTarget: number;
    distancePercent: number;
    secondsToClose: number;
    entryPrice: number;
    impliedProbability: number;
    botProbability: number;
    edge: number;
    recommendation: Recommendation;
    predictedOutcome: PredictedOutcome;
    entryRule: StrategyFeatures["entryRule"];
  }): string {
    return [
      `Activo: ${params.input.assetSymbol}.`,
      `Tipo de mercado: ${params.input.marketType}.`,
      `Target: ${round6(params.targetPrice)}.`,
      `Precio actual: ${round6(params.currentAssetPrice)}.`,
      `Distancia al target: ${round6(params.distanceToTarget)} (${round6(params.distancePercent)}).`,
      `Tiempo restante: ${params.secondsToClose}s.`,
      `Outcome estimado: ${params.predictedOutcome}.`,
      `Precio de entrada: ${round6(params.entryPrice)}.`,
      `Probabilidad implicita: ${round6(params.impliedProbability)}.`,
      `Probabilidad estimada: ${round6(params.botProbability)}.`,
      `Edge: ${round6(params.edge)}.`,
      `Regla de entrada: ${params.entryRule}.`,
      `Decision final: ${params.recommendation}.`
    ].join(" ");
  }
}

function calculateMomentumScore(input: SignalInput, predictedOutcome: PredictedOutcome): number {
  const values = [
    { value: input.momentumLast30s, weight: 0.5 },
    { value: input.momentumLast60s, weight: 0.3 },
    { value: input.momentumLast120s, weight: 0.2 }
  ].filter((item): item is { value: number; weight: number } => item.value !== null);

  if (values.length === 0) {
    return 0;
  }

  const weighted = values.reduce((sum, item) => sum + item.value * item.weight, 0);
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  const rawMomentum = weighted / totalWeight;
  const favorsOutcome = predictedOutcome === "UP" ? rawMomentum : -rawMomentum;

  return clamp(favorsOutcome, -0.08, 0.08);
}

function calculateVolatilityPenalty(input: SignalInput): number {
  const values = [input.volatilityLast60s, input.volatilityLast120s].filter((value): value is number => value !== null);

  if (values.length === 0) {
    return 0.01;
  }

  const averageVolatility = values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
  return clamp(averageVolatility * 0.3, 0, 0.08);
}

function decideRecommendation(params: {
  edge: number;
  highEntryPrice: boolean;
  secondsToClose: number;
  strongDistance: boolean;
  entryPrice: number;
  spread: number | null;
  distancePercent: number;
  predictedOutcome: PredictedOutcome;
  assetSymbol: string;
  targetPriceTrustedForLearning: boolean;
}): RecommendationDecision {
  if (params.entryPrice > 0.82 && !(params.secondsToClose < 45 && params.strongDistance)) {
    return { recommendation: "AVOID", entryRule: "NONE" };
  }

  if (!params.targetPriceTrustedForLearning) {
    return {
      recommendation: params.edge > 0 ? "WAIT" : "AVOID",
      entryRule: "NONE"
    };
  }

  if (isStandardDownReversalRisk(params)) {
    return { recommendation: "WAIT", entryRule: "NONE" };
  }

  if (params.edge >= 0.08) {
    if (isModerateEntryRisk(params)) {
      return { recommendation: "WAIT", entryRule: "NONE" };
    }

    return { recommendation: "ENTER_MODERATE", entryRule: "ENTER_MODERATE_STANDARD" };
  }

  if (params.edge >= 0.03) {
    return { recommendation: "ENTER_SMALL", entryRule: "ENTER_SMALL_STANDARD" };
  }

  if (isLightEntrySetup(params)) {
    if (isOperationalLightEntrySetup(params)) {
      return { recommendation: "ENTER_SMALL", entryRule: "ENTER_SMALL_LIGHT" };
    }

    return { recommendation: "WAIT", entryRule: "OBSERVE_SMALL_LIGHT" };
  }

  if (params.edge > 0) {
    return { recommendation: "WAIT", entryRule: "NONE" };
  }

  return {
    recommendation: params.strongDistance && params.secondsToClose < 60 ? "WAIT" : "AVOID",
    entryRule: "NONE"
  };
}

function isStandardDownReversalRisk(params: {
  predictedOutcome: PredictedOutcome;
  secondsToClose: number;
  entryPrice: number;
}): boolean {
  return (
    params.predictedOutcome === "DOWN" &&
    params.secondsToClose >= 60 &&
    params.secondsToClose <= 119 &&
    params.entryPrice >= 0.75
  );
}

function isModerateEntryRisk(params: {
  assetSymbol: string;
  secondsToClose: number;
  entryPrice: number;
}): boolean {
  if (params.secondsToClose > 180 && params.entryPrice < 0.65) {
    return true;
  }

  return params.assetSymbol === "ETH" && params.entryPrice < 0.7;
}

function isLightEntrySetup(params: {
  edge: number;
  entryPrice: number;
  spread: number | null;
  secondsToClose: number;
  distancePercent: number;
  predictedOutcome: PredictedOutcome;
  targetPriceTrustedForLearning: boolean;
}): boolean {
  const directionMultiplier = params.predictedOutcome === "UP" ? 1 : -1;
  const favorableDistance = params.distancePercent * directionMultiplier;

  return (
    params.targetPriceTrustedForLearning &&
    params.edge >= 0.015 &&
    params.entryPrice >= 0.35 &&
    params.entryPrice <= 0.82 &&
    params.secondsToClose >= 25 &&
    params.secondsToClose <= 120 &&
    params.spread !== null &&
    params.spread <= 0.04 &&
    favorableDistance >= 0.0005
  );
}

function isOperationalLightEntrySetup(_params: {
  assetSymbol: string;
}): boolean {
  return false;
}

function decideConfidence(
  edge: number,
  absDistancePercent: number,
  secondsToClose: number,
  input: SignalInput
): Confidence {
  const hasMomentum = input.momentumLast30s !== null || input.momentumLast60s !== null || input.momentumLast120s !== null;

  if (edge >= 0.08 && absDistancePercent >= 0.006 && secondsToClose < 120 && hasMomentum) {
    return "HIGH";
  }

  if (edge >= 0.03 && absDistancePercent >= 0.002) {
    return "MODERATE";
  }

  return "LOW";
}

function isValidEntryPrice(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0 && value < 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nullableRound6(value: number | null): number | null {
  return value === null ? null : round6(value);
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
