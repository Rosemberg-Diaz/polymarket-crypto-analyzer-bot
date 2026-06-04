import { config } from "../../config/env";
import { NormalizedCryptoMarket } from "../crypto/crypto-market.types";
import { mapPolymarketCryptoMarket } from "../crypto/crypto-market.mapper";
import { looksLikeExcludedNonCryptoMarket } from "../crypto/crypto-market.utils";
import { PolymarketMarket } from "./polymarket.types";

const marketTypePriority: Record<string, number> = {
  UP_DOWN_SHORT_TERM: 120,
  ABOVE_BELOW: 40,
  PRICE_TARGET: -40,
  RANGE_MARKET: 20,
  CRYPTO_OTHER: -80
};

const timeframePriority: Record<string, number> = {
  "5m": 90,
  "15m": 80,
  "1h": 65,
  "1d": 45,
  unknown: 0
};

export function mapPolymarketMarketToCryptoMarket(market: PolymarketMarket): NormalizedCryptoMarket | null {
  const raw = getRawRecord(market);
  const question = market.question ?? market.title ?? getString(raw, "question") ?? getString(raw, "title") ?? "";
  const slug = market.slug ?? getString(raw, "slug") ?? null;
  const description = market.description ?? getString(raw, "description") ?? null;
  const tags = market.tags ?? parseTags(raw.tags);

  if (looksLikeExcludedNonCryptoMarket(question, slug, description, tags)) {
    return null;
  }

  if (market.closed === true || market.archived === true || market.active === false) {
    return null;
  }

  const outcomes = market.outcomes ?? raw.outcomes;
  const tokens = market.tokens ?? raw.tokens ?? raw.clobTokenIds ?? raw.clob_token_ids;

  const mapped = mapPolymarketCryptoMarket({
    id: market.id ?? getString(raw, "id"),
    conditionId: market.conditionId ?? getString(raw, "conditionId") ?? getString(raw, "condition_id"),
    slug: slug ?? undefined,
    question,
    title: market.title ?? getString(raw, "title"),
    description: description ?? undefined,
    category: market.category ?? getString(raw, "category"),
    tags,
    startDate: market.startDate ?? getString(raw, "startDate") ?? getString(raw, "start_date"),
    endDate: market.endDate ?? getString(raw, "endDate") ?? getString(raw, "end_date"),
    resolutionSource:
      market.resolutionSource ?? getString(raw, "resolutionSource") ?? getString(raw, "resolution_source"),
    outcomes,
    tokens,
    active: market.active ?? getBoolean(raw, "active") ?? true,
    closed: market.closed ?? getBoolean(raw, "closed") ?? false,
    rawData: market.raw ?? market
  });

  if (!mapped || mapped.outcomes.length === 0 || mapped.tokenIds.length === 0) {
    return null;
  }

  return {
    ...mapped,
    priorityScore: calculatePriorityScore(mapped)
  };
}

export function sortPolymarketCryptoMarkets(markets: NormalizedCryptoMarket[]): NormalizedCryptoMarket[] {
  return [...markets].sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) {
      return right.priorityScore - left.priorityScore;
    }

    const leftSeconds = getSecondsToClose(left);
    const rightSeconds = getSecondsToClose(right);
    if (leftSeconds !== rightSeconds) {
      return leftSeconds - rightSeconds;
    }

    return left.question.localeCompare(right.question);
  });
}

function calculatePriorityScore(market: NormalizedCryptoMarket): number {
  let score = 0;

  if (config.priorityAssets.includes(market.assetSymbol)) {
    score += 100;
  } else if (market.assetSymbol !== "OTHER") {
    score += 25;
  } else {
    score += 10;
  }

  score += marketTypePriority[market.marketType] ?? 0;
  score += timeframePriority[market.timeframe] ?? 0;
  score += getTimeToClosePriority(market);

  if (market.marketType === "PRICE_TARGET" && market.timeframe === "unknown") {
    score -= 50;
  }

  if (market.isOperable) {
    score += 10;
  }

  return score;
}

function getTimeToClosePriority(market: NormalizedCryptoMarket): number {
  const secondsToClose = getSecondsToClose(market);

  if (!Number.isFinite(secondsToClose)) {
    return 0;
  }

  if (secondsToClose <= 15 * 60) return 120;
  if (secondsToClose <= 60 * 60) return 100;
  if (secondsToClose <= 6 * 60 * 60) return 80;
  if (secondsToClose <= 24 * 60 * 60) return 60;
  if (secondsToClose <= 3 * 24 * 60 * 60) return 35;
  if (secondsToClose <= 7 * 24 * 60 * 60) return 15;
  if (secondsToClose <= 30 * 24 * 60 * 60) return -20;
  if (secondsToClose <= 90 * 24 * 60 * 60) return -120;

  return -260;
}

function getSecondsToClose(market: NormalizedCryptoMarket): number {
  if (!market.endDate) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor((market.endDate.getTime() - Date.now()) / 1000));
}

function getRawRecord(market: PolymarketMarket): Record<string, unknown> {
  return market.raw && typeof market.raw === "object" ? (market.raw as Record<string, unknown>) : {};
}

function parseTags(value: unknown): string[] {
  const parsed = parseMaybeJson(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((tag) => {
    if (typeof tag === "string") {
      return [tag];
    }

    if (tag && typeof tag === "object") {
      const record = tag as Record<string, unknown>;
      const label = record.label ?? record.name ?? record.slug;
      return typeof label === "string" ? [label] : [];
    }

    return [];
  });
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] : undefined;
}
