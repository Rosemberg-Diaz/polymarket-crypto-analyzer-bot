import {
  NormalizedCryptoMarketOutcome,
  NormalizedCryptoMarket,
  RawPolymarketLikeMarket
} from "./crypto-market.types";
import {
  extractTargetPrice,
  inferAssetSymbol,
  inferCryptoMarketType,
  inferTimeframe,
  isCryptoMarket,
  normalizeOutcomeName
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
  const marketType = inferCryptoMarketType(question, slug, description);
  const targetPrice = extractTargetPrice(question, description, rawData);
  const outcomes = normalizeOutcomes(rawMarket.outcomes, rawMarket.tokens);
  const tokenIds = outcomes.flatMap((outcome) => (outcome.externalTokenId ? [outcome.externalTokenId] : []));
  const nonOperableReason = getNonOperableReason({
    marketType,
    targetPrice,
    outcomes,
    tokenIds,
    active: rawMarket.active ?? true,
    closed: rawMarket.closed ?? false
  });

  return {
    externalMarketId: rawMarket.conditionId ?? rawMarket.id ?? null,
    slug,
    question,
    category: "CRYPTO",
    assetSymbol,
    baseAsset: assetSymbol === "OTHER" ? null : assetSymbol,
    quoteAsset: inferQuoteAsset(question, slug, description),
    marketType,
    timeframe: inferTimeframe(question, slug, description),
    active: rawMarket.active ?? true,
    closed: rawMarket.closed ?? false,
    endDate: parseDate(rawMarket.endDate),
    resolutionSource: rawMarket.resolutionSource ?? null,
    targetPrice,
    outcomes,
    tokenIds,
    isOperable: nonOperableReason === null,
    nonOperableReason,
    priorityScore: 0,
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

function normalizeOutcomes(outcomesRaw: unknown, tokensRaw: unknown): NormalizedCryptoMarketOutcome[] {
  const outcomeNames = parseOutcomeNames(outcomesRaw);
  const tokens = parseTokens(tokensRaw);
  const maxLength = Math.max(outcomeNames.length, tokens.length);
  const outcomes: NormalizedCryptoMarketOutcome[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const token = tokens[index];
    const name = outcomeNames[index] ?? token?.outcome ?? `Outcome ${index + 1}`;

    outcomes.push({
      externalTokenId: token?.tokenId ?? null,
      name,
      normalizedName: normalizeOutcomeName(name),
      currentPrice: token?.price ?? null
    });
  }

  return outcomes;
}

function parseOutcomeNames(value: unknown): string[] {
  const parsed = parseMaybeJson(value);

  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => {
      if (typeof item === "string") {
        return [item];
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const name = record.name ?? record.outcome ?? record.title;
        return typeof name === "string" ? [name] : [];
      }

      return [];
    });
  }

  return [];
}

function parseTokens(value: unknown): Array<{ tokenId: string | null; outcome: string | null; price: number | null }> {
  const parsed = parseMaybeJson(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (typeof item === "string") {
      return [{ tokenId: item, outcome: null, price: null }];
    }

    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const tokenId = record.tokenId ?? record.token_id ?? record.id;
    const outcome = record.outcome ?? record.name;
    const price = Number(record.price);

    return [{
      tokenId: typeof tokenId === "string" ? tokenId : null,
      outcome: typeof outcome === "string" ? outcome : null,
      price: Number.isFinite(price) ? price : null
    }];
  });
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function getNonOperableReason(input: {
  marketType: string;
  targetPrice: number | null;
  outcomes: NormalizedCryptoMarketOutcome[];
  tokenIds: string[];
  active: boolean;
  closed: boolean;
}): string | null {
  if (!input.active || input.closed) {
    return "Market is not active.";
  }

  if (input.outcomes.length === 0) {
    return "Market has no outcomes.";
  }

  if (input.tokenIds.length === 0) {
    return "Market has no token ids.";
  }

  if (input.marketType === "UP_DOWN_SHORT_TERM" && input.targetPrice === null) {
    return "Missing targetPrice for Up/Down strategy.";
  }

  return null;
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return value;
  }

  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeStringify(value: unknown, maxLength = 20_000): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxLength) {
      return serialized;
    }

    return `${serialized.slice(0, maxLength)}...[truncated]`;
  } catch {
    return "{}";
  }
}
