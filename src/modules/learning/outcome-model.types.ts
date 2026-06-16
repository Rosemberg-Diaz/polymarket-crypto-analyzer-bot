export type OutcomeTimeframe = "5m" | "15m";
export type BinaryOutcome = "UP" | "DOWN";

export interface OutcomeRawFeatures {
  assetSymbol: string;
  timeframe: OutcomeTimeframe;
  targetPrice: number;
  currentAssetPrice: number;
  distanceToTargetPercent: number;
  secondsToClose: number;
  impliedProbabilityUp: number;
  checkpointSeconds: number;
}

export interface OutcomeTrainingSample {
  marketId: string;
  marketAt: Date;
  checkpointSeconds: number;
  features: OutcomeRawFeatures;
  winner: BinaryOutcome;
}

export interface OutcomeValidationMetrics {
  samples: number;
  markets: number;
  accuracy: number;
  precisionUp: number;
  precisionDown: number;
  recallUp: number;
  recallDown: number;
  baselineMarketAccuracy: number;
  baselineSpotAccuracy: number;
}

export interface OutcomeModelArtifact {
  version: string;
  timeframe: OutcomeTimeframe;
  trainedAt: string;
  featureNames: string[];
  means: number[];
  standardDeviations: number[];
  weights: number[];
  intercept: number;
  threshold: number;
  trainingSamples: number;
  trainingMarkets: number;
  validation: OutcomeValidationMetrics;
  normalization: {
    trustedTargetsOnly: true;
    officialOutcomesOnly: true;
    grouping: "MARKET_AND_NORMALIZED_CHECKPOINT";
    split: "CHRONOLOGICAL_BY_MARKET";
  };
}

export interface OutcomeModelScore {
  predictedOutcome: BinaryOutcome;
  probabilityUp: number;
  probabilityDown: number;
  modelVersion: string;
  features: OutcomeRawFeatures;
}
