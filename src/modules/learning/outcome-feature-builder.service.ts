import { OutcomeRawFeatures } from "./outcome-model.types";

export const OUTCOME_FEATURE_NAMES = [
  "distancePercent",
  "absoluteDistancePercent",
  "spotAboveTarget",
  "secondsRatio",
  "impliedProbabilityUp",
  "marketLeanUp",
  "checkpoint30",
  "checkpoint60",
  "checkpoint120",
  "checkpoint180",
  "assetBTC",
  "assetETH",
  "assetSOL",
  "assetXRP",
  "assetDOGE",
  "assetBNB"
] as const;

export function buildOutcomeVector(features: OutcomeRawFeatures): number[] {
  const asset = features.assetSymbol.toUpperCase();
  const duration = features.timeframe === "15m" ? 900 : 300;
  const distance = clamp(features.distanceToTargetPercent, -0.02, 0.02);
  const checkpoint = normalizeCheckpoint(
    features.secondsToClose,
    features.timeframe
  );

  return [
    distance,
    Math.abs(distance),
    distance > 0 ? 1 : 0,
    clamp(features.secondsToClose / duration, 0, 1),
    clamp(features.impliedProbabilityUp, 0.01, 0.99),
    features.impliedProbabilityUp >= 0.5 ? 1 : 0,
    checkpoint === 30 ? 1 : 0,
    checkpoint === 60 ? 1 : 0,
    checkpoint === 120 ? 1 : 0,
    checkpoint === 180 ? 1 : 0,
    asset === "BTC" ? 1 : 0,
    asset === "ETH" ? 1 : 0,
    asset === "SOL" ? 1 : 0,
    asset === "XRP" ? 1 : 0,
    asset === "DOGE" ? 1 : 0,
    asset === "BNB" ? 1 : 0
  ];
}

export function normalizeCheckpoint(
  secondsToClose: number,
  timeframe: "5m" | "15m"
): number {
  const candidates = timeframe === "15m"
    ? [30, 60, 120, 180, 300, 600, 900]
    : [30, 60, 120, 180, 300];
  return candidates.reduce((closest, candidate) =>
    Math.abs(candidate - secondsToClose) < Math.abs(closest - secondsToClose)
      ? candidate
      : closest
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}
