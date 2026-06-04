import { CryptoAsset, CryptoMarketType } from "../../config/assets";
import { CryptoTimeframe } from "../crypto/crypto-market.types";

export type Recommendation = "ENTER_SMALL" | "ENTER_MODERATE" | "WAIT" | "AVOID";

export type Confidence = "LOW" | "MODERATE" | "HIGH";

export type PredictedOutcome = "UP" | "DOWN" | "YES" | "NO";

export interface SignalInput {
  marketId: string;
  marketSlug: string | null;
  marketQuestion: string;
  marketType: CryptoMarketType | string;
  assetSymbol: CryptoAsset | string;
  timeframe: CryptoTimeframe | string;
  targetPrice: number | null;
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

export interface SignalFeatures {
  priceSource: "UP_DOWN" | "YES_NO" | "NONE";
  selectedPrice: number;
  oppositePrice: number;
  spread: number | null;
  liquidity: number | null;
  volume: number | null;
  secondsToClose: number | null;
  momentumScore: number;
  volatilityPenalty: number;
  dataCompleteness: number;
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
  features: SignalFeatures | Record<string, unknown>;
  confidenceAdjustment: number;
  historicalSummary: string;
}
