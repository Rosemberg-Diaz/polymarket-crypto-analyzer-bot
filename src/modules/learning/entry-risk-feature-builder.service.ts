import { EntryRiskRawFeatures } from "./entry-risk-model.types";

export const ENTRY_RISK_FEATURE_NAMES = [
  "entryBid",
  "entryAsk",
  "spread",
  "secondsRatio",
  "liquidityLog",
  "bidSizeLog",
  "askSizeLog",
  "depthImbalance",
  "microPricePremium",
  "depthRatioLog",
  "timeframe15m",
  "outcomeDown",
  "assetBTC",
  "assetETH",
  "assetSOL",
  "assetXRP",
  "assetDOGE",
  "assetBNB"
] as const;

export function buildEntryRiskVector(features: EntryRiskRawFeatures): number[] {
  const midpoint = (features.entryBid + features.entryAsk) / 2;
  const duration = features.timeframe === "15m" ? 900 : 300;
  const depthRatio = (features.bidDepth5 + 1) / (features.askDepth5 + 1);
  const asset = features.assetSymbol.toUpperCase();

  return [
    finite(features.entryBid),
    finite(features.entryAsk),
    finite(features.spread),
    clamp(finite(features.secondsToClose) / duration, 0, 1.5),
    Math.log1p(Math.max(0, finite(features.liquidity))),
    Math.log1p(Math.max(0, finite(features.bidSize))),
    Math.log1p(Math.max(0, finite(features.askSize))),
    clamp(finite(features.depthImbalance), -1, 1),
    finite(features.microPrice) - midpoint,
    Math.log(Math.max(0.000001, depthRatio)),
    features.timeframe === "15m" ? 1 : 0,
    features.outcome.toUpperCase() === "DOWN" ? 1 : 0,
    asset === "BTC" ? 1 : 0,
    asset === "ETH" ? 1 : 0,
    asset === "SOL" ? 1 : 0,
    asset === "XRP" ? 1 : 0,
    asset === "DOGE" ? 1 : 0,
    asset === "BNB" ? 1 : 0
  ];
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
