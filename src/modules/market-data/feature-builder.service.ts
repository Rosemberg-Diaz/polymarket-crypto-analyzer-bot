import { SignalInput, SignalResult } from "../signals/signal.types";

export interface FeatureBuilderInput {
  signalInput: SignalInput;
  signal: SignalResult;
}

export interface BotPredictionFeatures {
  assetSymbol: string;
  marketType: string;
  timeframe: string;
  predictedOutcome: string;
  entryPrice: number | null;
  upPrice: number | null;
  downPrice: number | null;
  yesPrice: number | null;
  noPrice: number | null;
  targetPrice: number | null;
  targetPriceSource: string | null;
  targetPriceTrustedForLearning: boolean;
  currentAssetPrice: number | null;
  distanceToTarget: number | null;
  distanceToTargetPercent: number | null;
  secondsToClose: number | null;
  spread: number | null;
  liquidity: number | null;
  volume: number | null;
  momentumLast30s: number | null;
  momentumLast60s: number | null;
  momentumLast120s: number | null;
  volatilityLast60s: number | null;
  volatilityLast120s: number | null;
  strategyName: string;
  recommendation: string;
  confidence: string;
  botProbability: number | null;
  impliedProbability: number | null;
  edge: number | null;
  entryRule: string | null;
}

export class FeatureBuilderService {
  buildPredictionFeatures(input: FeatureBuilderInput): BotPredictionFeatures {
    const distanceToTarget =
      input.signalInput.currentAssetPrice !== null && input.signalInput.targetPrice !== null
        ? input.signalInput.currentAssetPrice - input.signalInput.targetPrice
        : null;
    const distanceToTargetPercent =
      distanceToTarget !== null && input.signalInput.targetPrice !== null && input.signalInput.targetPrice > 0
        ? distanceToTarget / input.signalInput.targetPrice
        : null;

    return {
      assetSymbol: input.signalInput.assetSymbol,
      marketType: input.signalInput.marketType,
      timeframe: input.signalInput.timeframe,
      predictedOutcome: input.signal.predictedOutcome,
      entryPrice: normalizeNumber(input.signal.entryPrice),
      upPrice: normalizeNumber(input.signalInput.upPrice),
      downPrice: normalizeNumber(input.signalInput.downPrice),
      yesPrice: normalizeNumber(input.signalInput.yesPrice),
      noPrice: normalizeNumber(input.signalInput.noPrice),
      targetPrice: normalizeNumber(input.signalInput.targetPrice),
      targetPriceSource: input.signalInput.targetPriceSource ?? null,
      targetPriceTrustedForLearning: input.signalInput.targetPriceTrustedForLearning === true,
      currentAssetPrice: normalizeNumber(input.signalInput.currentAssetPrice),
      distanceToTarget: normalizeNumber(distanceToTarget),
      distanceToTargetPercent: normalizeNumber(distanceToTargetPercent),
      secondsToClose: normalizeNumber(input.signalInput.secondsToClose),
      spread: normalizeNumber(input.signalInput.spread),
      liquidity: normalizeNumber(input.signalInput.liquidity),
      volume: normalizeNumber(input.signalInput.volume),
      momentumLast30s: normalizeNumber(input.signalInput.momentumLast30s),
      momentumLast60s: normalizeNumber(input.signalInput.momentumLast60s),
      momentumLast120s: normalizeNumber(input.signalInput.momentumLast120s),
      volatilityLast60s: normalizeNumber(input.signalInput.volatilityLast60s),
      volatilityLast120s: normalizeNumber(input.signalInput.volatilityLast120s),
      strategyName: input.signal.strategyName,
      recommendation: input.signal.recommendation,
      confidence: input.signal.confidence,
      botProbability: normalizeNumber(input.signal.botProbability),
      impliedProbability: normalizeNumber(input.signal.impliedProbability),
      edge: normalizeNumber(input.signal.edge),
      entryRule: getStringFeature(input.signal.features, "entryRule")
    };
  }

  buildPredictionFeaturesJson(input: FeatureBuilderInput): string {
    return JSON.stringify(this.buildPredictionFeatures(input));
  }
}

function getStringFeature(features: SignalResult["features"], key: string): string | null {
  const record = features as Record<string, unknown>;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function normalizeNumber(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
