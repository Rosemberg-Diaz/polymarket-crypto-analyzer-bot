import { config } from "../../../config/env";
import {
  Confidence,
  PredictedOutcome,
  Recommendation,
  SignalInput,
  SignalResult
} from "../signal.types";

interface MomentumFeatures extends Record<string, unknown> {
  assetSymbol: string;
  timeframe: string;
  distanceToTarget: number | null;
  distancePercent: number | null;
  secondsToClose: number | null;
  momentumScore: number;
  momentumDirection: "UP" | "DOWN" | "NEUTRAL";
  entryPrice: number | null;
  predictedOutcome: PredictedOutcome;
  spread: number | null;
  liquidity: number | null;
  volume: number | null;
  volatilityPenalty: number;
}

export class MomentumTimeBasedStrategy {
  readonly strategyName = "momentum-time-based-v1";

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
      return this.avoid("Target price inválido", input);
    }

    const secondsToClose = input.secondsToClose ?? 0;

    if (secondsToClose > 60) {
      return this.wait("Tiempo restante > 60s, esperar entrada tardía", input);
    }

    if (secondsToClose < 15) {
      return this.wait("Tiempo restante < 15s, demasiado tarde", input);
    }

    const distanceToTarget = input.currentAssetPrice - input.targetPrice;
    const absDistance = Math.abs(distanceToTarget);
    const distancePercent = distanceToTarget / input.targetPrice;
    const absDistancePercent = Math.abs(distancePercent);

    if (absDistancePercent < 0.0005) {
      return this.wait("Distancia al target muy pequeña (< 0.05%)", input);
    }

    const momentumScore = this.calculateMomentum(input);
    const momentumDirection = this.getMomentumDirection(momentumScore);

    if (momentumDirection === "NEUTRAL") {
      return this.wait("Sin momentum claro en últimos 30s", input);
    }

    const predictedOutcome: PredictedOutcome = momentumDirection;
    const entryPrice = predictedOutcome === "UP" ? input.upPrice : input.downPrice;

    if (entryPrice === null || entryPrice < 0.01 || entryPrice > 0.99) {
      return this.avoid("Precio de entrada inválido", input);
    }

    if (entryPrice < 0.55 || entryPrice > 0.80) {
      return this.wait(
        `Precio de entrada $${entryPrice.toFixed(2)} fuera del rango óptimo (0.55-0.80)`,
        input
      );
    }

    const hasMomentumAlignment = this.hasMomentumAlignment(input, predictedOutcome);

    if (!hasMomentumAlignment) {
      return this.wait("Momentum no alineado con dirección favorables", input);
    }

    const edge = this.calculateEdge(predictedOutcome, distancePercent, secondsToClose, momentumScore);

    if (edge < 0.02) {
      return this.wait(`Edge insuficiente: ${edge.toFixed(4)}`, input);
    }

    const recommendation = edge >= 0.05 ? "ENTER_SMALL" : "WAIT";
    const confidence = edge >= 0.08 ? "HIGH" : edge >= 0.05 ? "MODERATE" : "LOW";

    const features: MomentumFeatures = {
      assetSymbol: input.assetSymbol,
      timeframe: input.timeframe,
      distanceToTarget,
      distancePercent,
      secondsToClose,
      momentumScore,
      momentumDirection,
      entryPrice,
      predictedOutcome,
      spread: input.spread,
      liquidity: input.liquidity,
      volume: input.volume,
      volatilityPenalty: 0
    };

    return {
      strategyName: this.strategyName,
      predictedOutcome,
      entryPrice,
      impliedProbability: entryPrice,
      botProbability: entryPrice + edge,
      edge,
      recommendation,
      confidence,
      reason: this.buildReason({
        input,
        distanceToTarget,
        distancePercent,
        secondsToClose,
        momentumScore,
        momentumDirection,
        entryPrice,
        edge,
        recommendation,
        predictedOutcome
      }),
      features,
      confidenceAdjustment: 0,
      historicalSummary: "Estrategia basada en momentum + timing. Observando rendimiento."
    };
  }

  private calculateMomentum(input: SignalInput): number {
    const momentum30s = input.momentumLast30s ?? 0;
    const momentum60s = input.momentumLast60s ?? 0;

    return momentum30s * 0.7 + momentum60s * 0.3;
  }

  private getMomentumDirection(momentumScore: number): "UP" | "DOWN" | "NEUTRAL" {
    if (momentumScore > 0.001) return "UP";
    if (momentumScore < -0.001) return "DOWN";
    return "NEUTRAL";
  }

  private hasMomentumAlignment(input: SignalInput, predictedOutcome: PredictedOutcome): boolean {
    const momentum30s = input.momentumLast30s ?? 0;

    if (predictedOutcome === "UP") {
      return momentum30s > 0;
    } else {
      return momentum30s < 0;
    }
  }

  private calculateEdge(
    predictedOutcome: PredictedOutcome,
    distancePercent: number,
    secondsToClose: number,
    momentumScore: number
  ): number {
    let edge = 0;

    const directionMultiplier = predictedOutcome === "UP" ? 1 : -1;
    const favorableDistance = distancePercent * directionMultiplier;

    edge += favorableDistance * 5;

    if (secondsToClose < 45 && favorableDistance > 0) {
      edge += favorableDistance * 8;
    }

    edge += Math.abs(momentumScore) * 3;

    if (secondsToClose < 30) {
      edge += 0.02;
    }

    return Math.max(0, edge);
  }

  private avoid(reason: string, input: SignalInput, features?: MomentumFeatures): SignalResult {
    return this.staticResult("AVOID", reason, input, features);
  }

  private wait(reason: string, input: SignalInput, features?: MomentumFeatures): SignalResult {
    return this.staticResult("WAIT", reason, input, features);
  }

  private staticResult(
    recommendation: Recommendation,
    reason: string,
    input: SignalInput,
    features?: MomentumFeatures
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
      features: features ?? {
        assetSymbol: input.assetSymbol,
        timeframe: input.timeframe,
        distanceToTarget: null,
        distancePercent: null,
        secondsToClose: input.secondsToClose,
        momentumScore: 0,
        momentumDirection: "NEUTRAL",
        entryPrice: null,
        predictedOutcome: "UP",
        spread: input.spread,
        liquidity: input.liquidity,
        volume: input.volume,
        volatilityPenalty: 0
      },
      confidenceAdjustment: 0,
      historicalSummary: "Estrategia basada en momentum + timing. Observando rendimiento."
    };
  }

  private buildReason(params: {
    input: SignalInput;
    distanceToTarget: number;
    distancePercent: number;
    secondsToClose: number;
    momentumScore: number;
    momentumDirection: string;
    entryPrice: number;
    edge: number;
    recommendation: Recommendation;
    predictedOutcome: PredictedOutcome;
  }): string {
    return [
      `Activo: ${params.input.assetSymbol}.`,
      `Tipo de mercado: ${params.input.marketType}.`,
      `Target: ${params.input.targetPrice?.toFixed(6)}.`,
      `Precio actual: ${params.input.currentAssetPrice?.toFixed(6)}.`,
      `Distancia al target: ${params.distanceToTarget.toFixed(6)} (${params.distancePercent.toFixed(6)}).`,
      `Tiempo restante: ${params.secondsToClose}s.`,
      `Momentum: ${params.momentumDirection} (${params.momentumScore.toFixed(6)}).`,
      `Outcome estimado: ${params.predictedOutcome}.`,
      `Precio de entrada: ${params.entryPrice.toFixed(2)}.`,
      `Edge: ${params.edge.toFixed(4)}.`,
      `Decision final: ${params.recommendation}.`
    ].join(" ");
  }
}
