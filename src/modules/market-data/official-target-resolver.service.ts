import WebSocket from "ws";
import { TargetPriceSource, NormalizedCryptoMarket } from "../crypto/crypto-market.types";
import { LoggerService } from "../logger/logger.service";

export interface OfficialTargetResolution {
  targetPrice: number | null;
  source: TargetPriceSource;
  trustedForLearning: boolean;
  reason: string;
  fetchedAt: Date;
  rawEvidence?: string;
}

export interface OfficialChainlinkPriceResolution {
  price: number | null;
  source: "POLYMARKET_RTDS_CHAINLINK";
  trustedForLearning: boolean;
  reason: string;
  fetchedAt: Date;
  rawEvidence?: string;
}

interface OfficialTargetResolverOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  rtdsMaxRetries?: number;
  rtdsRetryBaseDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RTDS_MAX_RETRIES = 2;
const DEFAULT_RTDS_RETRY_BASE_DELAY_MS = 300;
const RTDS_WS_URL = "wss://ws-live-data.polymarket.com";
const RTDS_TARGET_MAX_DISTANCE_MS = 10_000;
const RTDS_TARGET_RECOVERY_GRACE_MS = 15_000;
const POLYMARKET_PAGE_URLS = [
  (slug: string) => `https://polymarket.com/event/${encodeURIComponent(slug)}`,
  (slug: string) => `https://polymarket.com/es/event/${encodeURIComponent(slug)}`,
  (slug: string) => `https://base.polymarket.com/event/${encodeURIComponent(slug)}`
];
const OFFICIAL_RAW_PRICE_KEYS = [
  "targetPrice",
  "target_price",
  "priceToBeat",
  "price_to_beat",
  "initialPrice",
  "initial_price",
  "startPrice",
  "start_price",
  "openingPrice",
  "opening_price",
  "strikePrice",
  "strike_price",
  "thresholdPrice",
  "threshold_price"
];
const OPERATIONAL_UP_DOWN_TARGET_SOURCES: TargetPriceSource[] = [
  "POLYMARKET_CRYPTO_PRICE_API",
  "POLYMARKET_RTDS_CHAINLINK",
  "POLYMARKET_UMA_ANCILLARY"
];

export function isOperationalUpDownTarget(
  targetPrice: number,
  source: string,
  currentAssetPrice: number | null
): boolean {
  if (
    !Number.isFinite(targetPrice) ||
    targetPrice <= 0 ||
    currentAssetPrice === null ||
    !Number.isFinite(currentAssetPrice) ||
    currentAssetPrice <= 0 ||
    !OPERATIONAL_UP_DOWN_TARGET_SOURCES.includes(source as TargetPriceSource)
  ) {
    return false;
  }

  return Math.abs(currentAssetPrice - targetPrice) / targetPrice <= 0.1;
}

export function isTrustedUpDownTargetForStorage(
  targetPrice: number,
  source: string,
  currentAssetPrice: number | null
): boolean {
  if (
    !Number.isFinite(targetPrice) ||
    targetPrice <= 0 ||
    !OPERATIONAL_UP_DOWN_TARGET_SOURCES.includes(source as TargetPriceSource)
  ) {
    return false;
  }

  if (currentAssetPrice === null) {
    return true;
  }

  return isOperationalUpDownTarget(targetPrice, source, currentAssetPrice);
}

export function isWithinRtdsTargetRecoveryWindow(
  timeframe: NormalizedCryptoMarket["timeframe"],
  windowStart: Date,
  nowMs = Date.now()
): boolean {
  const timeframeMs = getTimeframeMs(timeframe);
  if (timeframeMs === null) {
    return false;
  }

  return nowMs <= windowStart.getTime() + timeframeMs + RTDS_TARGET_RECOVERY_GRACE_MS;
}

export class OfficialTargetResolverService {
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly rtdsMaxRetries: number;
  private readonly rtdsRetryBaseDelayMs: number;

  constructor(
    private readonly logger?: LoggerService,
    options: OfficialTargetResolverOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
    this.rtdsMaxRetries = options.rtdsMaxRetries ?? DEFAULT_RTDS_MAX_RETRIES;
    this.rtdsRetryBaseDelayMs = options.rtdsRetryBaseDelayMs ?? DEFAULT_RTDS_RETRY_BASE_DELAY_MS;
  }

  async resolveOfficialTarget(market: NormalizedCryptoMarket): Promise<OfficialTargetResolution> {
    if (!market.slug) {
      return unresolved("Market slug is missing.");
    }

    const cryptoPriceResolution = await this.resolveFromPolymarketCryptoPriceApi(market);
    if (cryptoPriceResolution.targetPrice !== null) {
      return cryptoPriceResolution;
    }

    const rtdsResolution = await this.resolveFromPolymarketRtdsChainlink(market);
    if (rtdsResolution.targetPrice !== null) {
      return rtdsResolution;
    }

    const rawResolution = this.resolveFromRawData(market.rawData);
    if (rawResolution.targetPrice !== null) {
      return rawResolution;
    }

    const uiResolution = await this.resolveFromPolymarketUi(market.slug);
    if (uiResolution.targetPrice !== null) {
      return uiResolution;
    }

    return unresolved(uiResolution.reason || "Official target not found in public Polymarket payloads.");
  }

  async resolveFromPolymarketRtdsChainlink(market: NormalizedCryptoMarket): Promise<OfficialTargetResolution> {
    const symbol = market.assetSymbol === "OTHER" ? null : `${market.assetSymbol.toLowerCase()}/usd`;
    const windowStart = inferWindowStart(market);

    if (!symbol || !windowStart) {
      return unresolved("Missing symbol or window start for Polymarket RTDS Chainlink stream.");
    }

    if (!isWithinRtdsTargetRecoveryWindow(market.timeframe, windowStart)) {
      return unresolved("Window start is too old for RTDS target capture.");
    }

    try {
      const points = await this.fetchRtdsChainlinkPricesWithRetry(symbol);
      const firstTick = findFirstTickAfterBoundary(points, windowStart.getTime());

      if (!firstTick || firstTick.timestamp - windowStart.getTime() > RTDS_TARGET_MAX_DISTANCE_MS) {
        return unresolved("RTDS did not provide a Chainlink price close enough to window start.");
      }

      return {
        ...resolved(
          firstTick.value,
          "POLYMARKET_RTDS_CHAINLINK",
          "Found Chainlink opening price through Polymarket live RTDS stream."
        ),
        rawEvidence: JSON.stringify({
          symbol,
          windowStart: windowStart.toISOString(),
          point: firstTick,
          distanceMs: firstTick.timestamp - windowStart.getTime()
        })
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger?.debug("Polymarket RTDS Chainlink target fetch failed.", {
        slug: market.slug,
        symbol,
        reason
      });
      return unresolved(reason);
    }
  }

  async resolveChainlinkPriceAt(
    assetSymbol: string,
    timestamp: Date,
    maxDistanceMs = RTDS_TARGET_MAX_DISTANCE_MS
  ): Promise<OfficialChainlinkPriceResolution> {
    const symbol = assetSymbol === "OTHER" ? null : `${assetSymbol.toLowerCase()}/usd`;
    if (!symbol) {
      return unresolvedChainlinkPrice("Missing supported asset symbol for Polymarket RTDS Chainlink stream.");
    }

    try {
      const points = await this.fetchRtdsChainlinkPricesWithRetry(symbol);
      const closestPoint = findClosestPricePoint(points, timestamp.getTime());

      if (!closestPoint || Math.abs(closestPoint.timestamp - timestamp.getTime()) > maxDistanceMs) {
        return unresolvedChainlinkPrice("RTDS did not provide a Chainlink price close enough to requested timestamp.");
      }

      return {
        price: round6(closestPoint.value),
        source: "POLYMARKET_RTDS_CHAINLINK",
        trustedForLearning: true,
        reason: "Found Chainlink price through Polymarket live RTDS stream.",
        fetchedAt: new Date(),
        rawEvidence: JSON.stringify({
          symbol,
          requestedTimestamp: timestamp.toISOString(),
          point: closestPoint,
          distanceMs: Math.abs(closestPoint.timestamp - timestamp.getTime())
        })
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger?.debug("Polymarket RTDS Chainlink price fetch failed.", {
        assetSymbol,
        timestamp: timestamp.toISOString(),
        reason
      });
      return unresolvedChainlinkPrice(reason);
    }
  }

  private async fetchRtdsChainlinkPricesWithRetry(symbol: string): Promise<ChainlinkPricePoint[]> {
    let lastError: unknown = new Error("RTDS Chainlink price fetch did not run.");

    for (let attempt = 0; attempt <= this.rtdsMaxRetries; attempt += 1) {
      try {
        return await this.fetchRtdsChainlinkPrices(symbol);
      } catch (error) {
        lastError = error;
        if (attempt >= this.rtdsMaxRetries) {
          break;
        }

        const backoffMs = this.rtdsRetryBaseDelayMs * 2 ** attempt;
        this.logger?.warn("Polymarket RTDS connection failed. Retrying.", {
          symbol,
          attempt: attempt + 1,
          maxAttempts: this.rtdsMaxRetries + 1,
          backoffMs,
          reason: error instanceof Error ? error.message : String(error)
        });
        await sleep(backoffMs);
      }
    }

    throw lastError;
  }

  private fetchRtdsChainlinkPrices(symbol: string): Promise<ChainlinkPricePoint[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(RTDS_WS_URL);
      let settled = false;
      const finish = (
        callback: (value: ChainlinkPricePoint[] | Error) => void,
        value: ChainlinkPricePoint[] | Error
      ): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        callback(value);
      };
      const timeout = setTimeout(() => {
        finish(
          (error) => reject(error as Error),
          new Error("Timed out waiting for RTDS Chainlink price payload.")
        );
      }, this.timeoutMs);

      ws.on("open", () => {
        ws.send(JSON.stringify({
          action: "subscribe",
          subscriptions: [{
            topic: "crypto_prices_chainlink",
            type: "*",
            filters: JSON.stringify({ symbol })
          }]
        }));
      });

      ws.on("message", (data) => {
        const text = data.toString();
        if (!text.trim()) {
          return;
        }

        const points = parseRtdsChainlinkPoints(text, symbol);
        if (points.length === 0) {
          return;
        }

        finish((value) => resolve(value as ChainlinkPricePoint[]), points);
      });

      ws.on("error", (error) => {
        finish((value) => reject(value as Error), error);
      });

      ws.on("close", () => {
        if (!settled) {
          finish(
            (error) => reject(error as Error),
            new Error("RTDS connection closed before a Chainlink price payload arrived.")
          );
        }
      });
    });
  }

  async resolveFromPolymarketCryptoPriceApi(market: NormalizedCryptoMarket): Promise<OfficialTargetResolution> {
    const symbol = market.assetSymbol === "OTHER" ? null : market.assetSymbol;
    const windowStart = inferWindowStart(market);
    const variant = getCryptoPriceVariant(market.timeframe);

    if (!symbol || !windowStart || !market.endDate || !variant) {
      return unresolved("Missing symbol, window times, or supported timeframe for Polymarket crypto-price API.");
    }

    const params = new URLSearchParams({
      symbol,
      eventStartTime: windowStart.toISOString().replace(/\.\d{3}Z$/, "Z"),
      variant,
      endDate: market.endDate.toISOString().replace(/\.\d{3}Z$/, "Z")
    });
    const url = `https://polymarket.com/api/crypto/crypto-price?${params.toString()}`;

    try {
      const text = await this.fetchText(url, "application/json");
      const parsed = JSON.parse(text) as unknown;
      const targetPrice = extractCryptoPriceApiOpenPrice(parsed);

      if (targetPrice !== null) {
        return {
          ...resolved(
            targetPrice,
            "POLYMARKET_CRYPTO_PRICE_API",
            "Found Chainlink opening price through Polymarket crypto-price API."
          ),
          rawEvidence: text.slice(0, 2_000)
        };
      }

      return unresolved("Polymarket crypto-price API response did not include openPrice.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger?.debug("Polymarket crypto-price API target fetch failed.", {
        slug: market.slug,
        url,
        reason
      });
      return unresolved(reason);
    }
  }

  resolveFromRawData(rawData: string): OfficialTargetResolution {
    const parsed = parseJsonRecord(rawData);
    const directValue = findNumericValue(parsed, OFFICIAL_RAW_PRICE_KEYS);
    if (directValue !== null) {
      return resolved(directValue, "POLYMARKET_GAMMA", "Found explicit target price in Polymarket raw data.");
    }

    const text = JSON.stringify(parsed);
    const textValue = extractTargetFromText(text);
    if (textValue !== null) {
      return resolved(textValue, "POLYMARKET_GAMMA", "Found explicit target price in Polymarket text payload.");
    }

    return unresolved("No explicit target price found in Polymarket raw data.");
  }

  async resolveFromPolymarketUi(slug: string): Promise<OfficialTargetResolution> {
    let lastReason = "Polymarket UI payload did not expose a target.";

    for (const buildUrl of POLYMARKET_PAGE_URLS) {
      const url = buildUrl(slug);
      try {
        const html = await this.fetchText(url, "text/html,application/xhtml+xml,application/json");
        const targetPrice = extractTargetFromText(html);
        if (targetPrice !== null) {
          return {
            ...untrustedResolved(
              targetPrice,
              "POLYMARKET_UI_PAYLOAD",
              "Found target-like text in Polymarket UI payload; retained for audit only."
            ),
            rawEvidence: trimEvidence(html, targetPrice)
          };
        }
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
        this.logger?.debug("Official target UI fetch failed.", { slug, url, reason: lastReason });
      }
    }

    return unresolved(lastReason);
  }

  private async fetchText(url: string, accept: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: accept,
          Referer: "https://polymarket.com/",
          "User-Agent": "Mozilla/5.0 PolymarketCryptoAnalyzerBot/0.1"
        }
      });

      if (!response.ok) {
        throw new Error(`Polymarket UI returned HTTP ${response.status}.`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolved(
  targetPrice: number,
  source: TargetPriceSource,
  reason: string
): OfficialTargetResolution {
  return {
    targetPrice: round6(targetPrice),
    source,
    trustedForLearning: true,
    reason,
    fetchedAt: new Date()
  };
}

function untrustedResolved(
  targetPrice: number,
  source: TargetPriceSource,
  reason: string
): OfficialTargetResolution {
  return {
    targetPrice: round6(targetPrice),
    source,
    trustedForLearning: false,
    reason,
    fetchedAt: new Date()
  };
}

function unresolved(reason: string): OfficialTargetResolution {
  return {
    targetPrice: null,
    source: "UNKNOWN",
    trustedForLearning: false,
    reason,
    fetchedAt: new Date()
  };
}

function unresolvedChainlinkPrice(reason: string): OfficialChainlinkPriceResolution {
  return {
    price: null,
    source: "POLYMARKET_RTDS_CHAINLINK",
    trustedForLearning: false,
    reason,
    fetchedAt: new Date()
  };
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function findNumericValue(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const numericValue = toPositiveNumber(record[key]);
    if (numericValue !== null) {
      return numericValue;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const nestedNumericValue = findNumericValue(nestedValue, keys);
    if (nestedNumericValue !== null) {
      return nestedNumericValue;
    }
  }

  return null;
}

function extractTargetFromText(text: string): number | null {
  const patterns = [
    /(?:price\s*to\s*beat|precio\s*a\s*superar|target|strike\s*price|initial\s*price|start\s*price)[^0-9$]{0,80}\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i,
    /(?:targetPrice|priceToBeat|initialPrice|startPrice|strikePrice)"?\s*[:=]\s*"?\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = toPositiveNumber(match?.[1]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function trimEvidence(text: string, targetPrice: number): string {
  const targetText = String(targetPrice);
  const index = text.indexOf(targetText);
  if (index < 0) {
    return "";
  }

  return text.slice(Math.max(0, index - 160), index + targetText.length + 160);
}

function extractCryptoPriceApiOpenPrice(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return toPositiveNumber(record.openPrice ?? record.priceToBeat ?? record.ptb);
}

interface ChainlinkPricePoint {
  timestamp: number;
  value: number;
}

export function parseRtdsChainlinkPoints(text: string, expectedSymbol: string): ChainlinkPricePoint[] {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const record = parsed as Record<string, unknown>;
  const payload = record.payload;
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const payloadRecord = payload as Record<string, unknown>;
  const symbol = typeof payloadRecord.symbol === "string" ? payloadRecord.symbol.toLowerCase() : expectedSymbol;
  if (symbol !== expectedSymbol) {
    return [];
  }

  const data = payloadRecord.data;
  if (Array.isArray(data)) {
    return data.flatMap((item) => parseRtdsPoint(item));
  }

  const singlePoint = parseRtdsPoint(payloadRecord);
  return singlePoint.length > 0 ? singlePoint : [];
}

function parseRtdsPoint(value: unknown): ChainlinkPricePoint[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const timestamp = Number(record.timestamp ?? record.ts ?? record.time);
  const price = toPositiveNumber(record.value ?? record.price);

  if (!Number.isFinite(timestamp) || price === null) {
    return [];
  }

  return [{
    timestamp: timestamp > 10_000_000_000 ? timestamp : timestamp * 1000,
    value: price
  }];
}

export function findFirstTickAfterBoundary(points: ChainlinkPricePoint[], boundaryTimestamp: number): ChainlinkPricePoint | null {
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  return sorted.find((point) => point.timestamp >= boundaryTimestamp) ?? null;
}

export function findClosestPricePoint(points: ChainlinkPricePoint[], timestamp: number): ChainlinkPricePoint | null {
  return points.reduce<ChainlinkPricePoint | null>((closest, point) => {
    if (!closest) {
      return point;
    }

    return Math.abs(point.timestamp - timestamp) < Math.abs(closest.timestamp - timestamp) ? point : closest;
  }, null);
}

function inferWindowStart(market: NormalizedCryptoMarket): Date | null {
  const slugTimestamp = market.slug?.match(/-(\d{10})$/)?.[1];
  if (slugTimestamp) {
    const timestamp = Number(slugTimestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return new Date(timestamp * 1000);
    }
  }

  const durationMs = getTimeframeMs(market.timeframe);
  if (market.endDate && durationMs !== null) {
    return new Date(market.endDate.getTime() - durationMs);
  }

  return null;
}

function getCryptoPriceVariant(timeframe: string): string | null {
  if (timeframe === "5m") {
    return "five";
  }

  if (timeframe === "15m") {
    return "fifteen";
  }

  if (timeframe === "1h") {
    return "hour";
  }

  return null;
}

function getTimeframeMs(timeframe: string): number | null {
  if (timeframe === "5m") {
    return 5 * 60 * 1000;
  }

  if (timeframe === "15m") {
    return 15 * 60 * 1000;
  }

  if (timeframe === "1h") {
    return 60 * 60 * 1000;
  }

  return null;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
