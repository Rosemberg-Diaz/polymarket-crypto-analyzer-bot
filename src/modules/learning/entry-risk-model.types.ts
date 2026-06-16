export type EntryRiskLabel = "ALLOW" | "CONSIDER_BLOCK";

export interface EntryRiskRawFeatures {
  assetSymbol: string;
  timeframe: string;
  outcome: string;
  entryBid: number;
  entryAsk: number;
  spread: number;
  liquidity: number;
  secondsToClose: number;
  bidSize: number;
  askSize: number;
  bidDepth5: number;
  askDepth5: number;
  depthImbalance: number;
  microPrice: number;
}

export interface EntryRiskTrainingSample {
  marketId: string;
  observedAt: Date;
  features: EntryRiskRawFeatures;
  highRisk: boolean;
  profit: number;
}

export interface LogisticRegressionArtifact {
  version: string;
  trainedAt: string;
  featureNames: string[];
  means: number[];
  standardDeviations: number[];
  weights: number[];
  intercept: number;
  threshold: number;
  trainingSamples: number;
  positiveSamples: number;
  validationSamples: number;
  validation: {
    accuracy: number;
    precision: number;
    recall: number;
    specificity: number;
    blockedSamples: number;
    allowedSamples: number;
    blockedProfit: number;
    allowedProfit: number;
  };
}

export interface EntryRiskScore {
  label: EntryRiskLabel;
  probability: number;
  modelVersion: string;
  features: EntryRiskRawFeatures;
}
