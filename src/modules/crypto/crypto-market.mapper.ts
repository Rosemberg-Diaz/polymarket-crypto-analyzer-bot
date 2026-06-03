import {
  NormalizedCryptoMarket,
  RawPolymarketLikeMarket
} from "./crypto-market.types";
import {
  extractTargetPrice,
  inferAssetSymbol,
  inferCryptoMarketType,
  inferTimeframe,
  isCryptoMarket
} from "./crypto-market.utils";

export function mapPolymarketCryptoMarket(rawMarket: RawPolymarketLikeMarket): NormalizedCryptoMarket | null {
  const question = rawMarket.question ?? rawMarket.title ?? "";
  const slug = rawMarket.slug ?? null;
  const description = rawMarket.description ?? null;
  const tags = normalizeTags(rawMarket.tags);

  if (!isCryptoMarket(question, slug, description, tags)) {
    return null;
  }

  const assetSymbol = inferAssetSymbol(question, slug, description);
  const rawData = rawMarket.rawData ?? rawMarket;

  return {
    externalMarketId: rawMarket.conditionId ?? rawMarket.id ?? null,
    slug,
    question,
    category: "CRYPTO",
    assetSymbol,
    baseAsset: assetSymbol === "OTHER" ? null : assetSymbol,
    quoteAsset: inferQuoteAsset(question, slug, description),
    marketType: inferCryptoMarketType(question, slug, description),
    timeframe: inferTimeframe(question, slug, description),
    resolutionSource: rawMarket.resolutionSource ?? null,
    targetPrice: extractTargetPrice(question, description, rawData),
    rawData: safeStringify(rawData)
  };
}

function normalizeTags(tags: RawPolymarketLikeMarket["tags"]): string[] {
  if (!tags) {
    return [];
  }

  return tags.map((tag) => {
    if (typeof tag === "string") {
      return tag;
    }

    return tag.label ?? tag.name ?? tag.slug ?? "";
  });
}

function inferQuoteAsset(
  question?: string | null,
  slug?: string | null,
  description?: string | null
): string | null {
  const text = [question, slug, description].filter(Boolean).join(" ").toUpperCase();

  if (/\b(USD|USDC|USDT|DOLLAR|DOLLARS)\b|\$/.test(text)) {
    return "USD";
  }

  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}
