import { CryptoAsset, CryptoMarketType } from "../../config/assets";
import { CryptoTimeframe } from "../crypto/crypto-market.types";

export type Recommendation = "ENTER_SMALL" | "ENTER_MODERATE" | "WAIT" | "AVOID";

export type Confidence = "LOW" | "MODERATE" | "HIGH";

export type PredictedOutcome = "UP" | "DOWN" | "YES" | "NO";

export type EntryRule =
  | "NONE"
  | "ENTER_SMALL_STANDARD"
  | "ENTER_SMALL_LIGHT"
  | "ENTER_MODERATE_STANDARD"
  | "ENTER_SMALL_LEARNING_DEFENSIVE"
  | "OBSERVE_SMALL_LIGHT"
  | "OBSERVE_MODERATE_STANDARD";

export interface SignalInput {
  marketId: string;
  marketSlug: string | null;
  marketQuestion: string;
  marketType: CryptoMarketType | string;
  assetSymbol: CryptoAsset | string;
  timeframe: CryptoTimeframe | string;
  targetPrice: number | null;
  targetPriceSource?: string | null;
  targetPriceTrustedForLearning?: boolean | null;
  currentAssetPrice: number | null;
  upPrice: number | null;
  downPrice: number | null;
  yesPrice: number | null;
  noPrice: number | null;
  spread: number | null;
  liquidity: number | null;
  volume: number | null;
  secondsToClose: number | null;
  momentumLast30s: number | null;
  momentumLast60s: number | null;
  momentumLast120s: number | null;
  volatilityLast60s: number | null;
  volatilityLast120s: number | null;
}

export interface SignalFeatures extends Record<string, unknown> {
  priceSource?: "UP_DOWN" | "YES_NO" | "NONE";
  selectedPrice?: number;
  oppositePrice?: number;

  assetSymbol?: string;
  marketType?: string;
  targetPrice?: number | null;
  currentAssetPrice?: number | null;
  distanceToTarget?: number | null;
  distancePercent?: number | null;
  absDistance?: number | null;

  spread: number | null;
  liquidity: number | null;
  volume: number | null;
  secondsToClose: number | null;

  momentumScore: number;
  volatilityPenalty: number;
  dataCompleteness?: number;

  strongDistance?: boolean;
  highEntryPrice?: boolean;

  targetPriceSource?: string | null;
  targetPriceTrustedForLearning?: boolean;

  entryRule?: EntryRule | string;
  baseRecommendation?: Recommendation;
  baseEntryRule?: EntryRule | string;
  finalRecommendation?: Recommendation;
  finalEntryRule?: EntryRule | string;

  similarCases?: number;
  historicalWinRate?: number;
  historicalProfit?: number;
  historicalAverageRoi?: number;
  confidenceAdjustment?: number;

  blockedReason?: string;
  blockedByHistoricalGate?: boolean;
}

export interface SignalResult {
  strategyName: string;
  predictedOutcome: PredictedOutcome;
  entryPrice: number;
  impliedProbability: number;
  botProbability: number;
  edge: number;
  recommendation: Recommendation;
  confidence: Confidence;
  reason: string;
  features: SignalFeatures;
  confidenceAdjustment: number;
  historicalSummary: string;
}