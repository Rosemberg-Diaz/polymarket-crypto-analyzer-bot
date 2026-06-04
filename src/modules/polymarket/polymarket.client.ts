import { CryptoMarketCandidate } from "../crypto/cryptoMarket";
import {
  GetActiveMarketsParams,
  PolymarketClientOptions,
  PolymarketMarket,
  PolymarketOrderBook,
  PolymarketPriceResponse,
  PolymarketPricesHistoryPoint,
  PolymarketPricesHistoryResponse,
  PolymarketSide,
  PolymarketSpreadResponse
} from "./polymarket.types";

const DEFAULT_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const DEFAULT_CLOB_BASE_URL = "https://clob.polymarket.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

export class PolymarketClient {
  private readonly gammaBaseUrl: string;
  private readonly clobBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: PolymarketClientOptions = {}) {
    this.gammaBaseUrl = trimTrailingSlash(options.gammaBaseUrl ?? DEFAULT_GAMMA_BASE_URL);
    this.clobBaseUrl = trimTrailingSlash(options.clobBaseUrl ?? DEFAULT_CLOB_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  }

  async getActiveMarkets(params: GetActiveMarketsParams = {}): Promise<PolymarketMarket[]> {
    const searchParams = new URLSearchParams();
    searchParams.set("active", String(params.active ?? true));
    searchParams.set("closed", String(params.closed ?? false));

    if (params.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }

    if (params.offset !== undefined) {
      searchParams.set("offset", String(params.offset));
    }

    if (params.archived !== undefined) {
      searchParams.set("archived", String(params.archived));
    }

    if (params.tagId) {
      searchParams.set("tag_id", params.tagId);
    }

    if (params.category) {
      searchParams.set("category", params.category);
    }

    const raw = await this.requestUnknown(`${this.gammaBaseUrl}/markets?${searchParams.toString()}`);
    return normalizeMarkets(raw, params.includeRaw);
  }

  async searchMarkets(query: string): Promise<PolymarketMarket[]> {
    if (!query.trim()) {
      return [];
    }

    const searchParams = new URLSearchParams({
      search: query,
      active: "true",
      closed: "false"
    });
    const raw = await this.requestUnknown(`${this.gammaBaseUrl}/markets?${searchParams.toString()}`);

    return normalizeMarkets(raw, true);
  }

  async getMarketBySlug(slug: string): Promise<PolymarketMarket | null> {
    if (!slug.trim()) {
      return null;
    }

    const raw = await this.requestUnknown(`${this.gammaBaseUrl}/markets/slug/${encodeURIComponent(slug)}`);
    const markets = normalizeMarkets(raw, true);

    return markets[0] ?? (isRecord(raw) ? normalizeMarket(raw, true) : null);
  }

  async getOrderBook(tokenId: string): Promise<PolymarketOrderBook | null> {
    if (!tokenId.trim()) {
      return null;
    }

    const url = `${this.clobBaseUrl}/book?token_id=${encodeURIComponent(tokenId)}`;
    const raw = await this.requestUnknown(url);

    if (!isRecord(raw)) {
      return null;
    }

    return {
      tokenId,
      bids: normalizeOrderBookLevels(raw.bids),
      asks: normalizeOrderBookLevels(raw.asks),
      raw
    };
  }

  async getPrice(tokenId: string, side: PolymarketSide): Promise<PolymarketPriceResponse> {
    if (!tokenId.trim()) {
      return { tokenId, side, price: null };
    }

    const url = `${this.clobBaseUrl}/price?token_id=${encodeURIComponent(tokenId)}&side=${encodeURIComponent(side)}`;
    const raw = await this.requestUnknown(url);

    return {
      tokenId,
      side,
      price: extractNumber(raw, "price"),
      raw
    };
  }

  async getSpread(tokenId: string): Promise<PolymarketSpreadResponse> {
    if (!tokenId.trim()) {
      return { tokenId, spread: null };
    }

    const url = `${this.clobBaseUrl}/spread?token_id=${encodeURIComponent(tokenId)}`;
    const raw = await this.requestUnknown(url);

    return {
      tokenId,
      spread: extractNumber(raw, "spread"),
      raw
    };
  }

  async getPricesHistory(tokenId: string): Promise<PolymarketPricesHistoryResponse> {
    if (!tokenId.trim()) {
      return { tokenId, history: [] };
    }

    const url = `${this.clobBaseUrl}/prices-history?market=${encodeURIComponent(tokenId)}`;
    const raw = await this.requestUnknown(url);

    return {
      tokenId,
      history: normalizePricesHistory(raw),
      raw
    };
  }

  async fetchCryptoMarkets(): Promise<CryptoMarketCandidate[]> {
    // Compatibility method for the initial local scanner. The real public API
    // data is exposed through typed methods above and can be mapped upstream.
    return [];
  }

  private async requestUnknown(url: string): Promise<unknown> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json"
          }
        });

        if (response.status === 429) {
          const backoffMs = this.getBackoffMs(attempt, response);
          console.warn(`Polymarket rate limit hit. Backing off for ${backoffMs}ms.`);
          await sleep(backoffMs);
          continue;
        }

        if (!response.ok) {
          if (isTemporaryStatus(response.status) && attempt < this.maxRetries) {
            await sleep(this.getBackoffMs(attempt, response));
            continue;
          }

          console.warn(`Polymarket API returned HTTP ${response.status} for ${url}.`);
          return null;
        }

        if (response.status === 204) {
          return null;
        }

        return (await response.json()) as unknown;
      } catch (error) {
        if (attempt < this.maxRetries) {
          await sleep(this.getBackoffMs(attempt));
          continue;
        }

        console.warn("Polymarket API request failed.", {
          url,
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }

    return null;
  }

  private getBackoffMs(attempt: number, response?: Response): number {
    const retryAfter = response?.headers.get("retry-after");
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : null;

    if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }

    return this.retryBaseDelayMs * 2 ** attempt;
  }
}

function normalizeMarkets(raw: unknown, includeRaw = true): PolymarketMarket[] {
  if (Array.isArray(raw)) {
    return raw.filter(isRecord).map((item) => normalizeMarket(item, includeRaw));
  }

  if (isRecord(raw) && Array.isArray(raw.markets)) {
    return raw.markets.filter(isRecord).map((item) => normalizeMarket(item, includeRaw));
  }

  if (isRecord(raw) && Array.isArray(raw.data)) {
    return raw.data.filter(isRecord).map((item) => normalizeMarket(item, includeRaw));
  }

  return [];
}

function normalizeMarket(raw: Record<string, unknown>, includeRaw = true): PolymarketMarket {
  return {
    id: asString(raw.id),
    conditionId: asString(raw.conditionId ?? raw.condition_id),
    slug: asString(raw.slug),
    question: asString(raw.question),
    title: asString(raw.title),
    description: asString(raw.description),
    category: asString(raw.category),
    tags: normalizeTags(raw.tags),
    active: asBoolean(raw.active),
    closed: asBoolean(raw.closed),
    archived: asBoolean(raw.archived),
    startDate: asString(raw.startDate ?? raw.start_date),
    endDate: asString(raw.endDate ?? raw.end_date),
    resolutionSource: asString(raw.resolutionSource ?? raw.resolution_source),
    outcomes: raw.outcomes,
    tokens: normalizeTokens(raw.tokens ?? raw.clobTokenIds ?? raw.clob_token_ids),
    raw: includeRaw ? raw : undefined
  };
}

function normalizeTags(raw: unknown): string[] | undefined {
  const parsed = parseMaybeJson(raw);

  if (!Array.isArray(parsed)) {
    return undefined;
  }

  const tags = parsed.flatMap((tag) => {
    if (typeof tag === "string") {
      return [tag];
    }

    if (isRecord(tag)) {
      const label = tag.label ?? tag.name ?? tag.slug;
      return typeof label === "string" ? [label] : [];
    }

    return [];
  });

  return tags.length > 0 ? tags : undefined;
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

function normalizeTokens(raw: unknown): PolymarketMarket["tokens"] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (isRecord(item)) {
        return {
          token_id: asString(item.token_id),
          tokenId: asString(item.tokenId ?? item.token_id),
          outcome: asString(item.outcome),
          price: typeof item.price === "string" || typeof item.price === "number" ? item.price : undefined,
          raw: item
        };
      }

      return {
        tokenId: asString(item),
        token_id: asString(item)
      };
    });
  }

  return undefined;
}

function normalizeOrderBookLevels(raw: unknown): Array<{ price: string; size: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(isRecord).map((level) => ({
    price: String(level.price ?? "0"),
    size: String(level.size ?? "0")
  }));
}

function normalizePricesHistory(raw: unknown): PolymarketPricesHistoryPoint[] {
  const points = isRecord(raw) && Array.isArray(raw.history) ? raw.history : Array.isArray(raw) ? raw : [];

  return points.filter(isRecord).flatMap((point) => {
    const timestamp = Number(point.t ?? point.timestamp ?? point.time);
    const price = Number(point.p ?? point.price);

    if (!Number.isFinite(timestamp) || !Number.isFinite(price)) {
      return [];
    }

    return [{ timestamp, price }];
  });
}

function extractNumber(raw: unknown, key: string): number | null {
  if (!isRecord(raw)) {
    return null;
  }

  const value = raw[key];
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function isTemporaryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
