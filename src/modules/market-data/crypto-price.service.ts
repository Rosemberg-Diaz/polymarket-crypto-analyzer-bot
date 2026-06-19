import WebSocket from "ws";
import { CryptoAsset, SUPPORTED_CRYPTO_ASSETS } from "../../config/assets";
import { LoggerService } from "../logger/logger.service";
import { parseRtdsChainlinkPoints } from "./official-target-resolver.service";

export interface CryptoSpotPrice {
  assetSymbol: CryptoAsset;
  priceUsd: number | null;
  source: "POLYMARKET_CHAINLINK" | "POLYMARKET_CRYPTO_PRICE_API" | "COINBASE" | "COINGECKO" | "UNSUPPORTED" | "ERROR";
  /**
   * Timestamp of the underlying source observation. For Chainlink this is
   * the timestamp carried by the RTDS tick, not the time the bot read it.
   */
  fetchedAt: Date;
  receivedAt?: Date;
}

interface CachedPrice {
  value: CryptoSpotPrice;
  expiresAt: number;
}

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const COINBASE_BASE_URL = "https://api.coinbase.com/v2";
const RTDS_WS_URL = "wss://ws-live-data.polymarket.com";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const CACHE_TTL_MS = 20_000;
const PERSISTENT_WS_RECONNECT_MS = 5_000;
const PERSISTENT_WS_HEARTBEAT_MS = 30_000;
const PERSISTENT_WS_STALE_DATA_MS = 60_000;
const PERSISTENT_WS_RESUBSCRIBE_MS = 300_000;

// Persistent WebSocket manager for real-time Polymarket Chainlink prices
class PersistentPriceWebSocket {
  private ws: WebSocket | null = null;
  private prices = new Map<CryptoAsset, CryptoSpotPrice>();
  private subscribers = new Set<(asset: CryptoAsset, price: CryptoSpotPrice) => void>();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private staleDataCheckInterval: NodeJS.Timeout | null = null;
  private resubscribeInterval: NodeJS.Timeout | null = null;
  private lastMessageReceivedAt: number = 0;
  private isConnecting = false;
  private logger: LoggerService | null = null;

  constructor() {}

  setLogger(logger: LoggerService): void {
    this.logger = logger;
  }

  start(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connect();
  }

  stop(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.staleDataCheckInterval) {
      clearInterval(this.staleDataCheckInterval);
      this.staleDataCheckInterval = null;
    }
    if (this.resubscribeInterval) {
      clearInterval(this.resubscribeInterval);
      this.resubscribeInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getPrice(asset: CryptoAsset): CryptoSpotPrice | null {
    return this.prices.get(asset) ?? null;
  }

  subscribe(callback: (asset: CryptoAsset, price: CryptoSpotPrice) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private connect(): void {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.ws = new WebSocket(RTDS_WS_URL);

      this.ws.on("open", () => {
        this.isConnecting = false;
        this.lastMessageReceivedAt = Date.now();
        this.logger?.info("Persistent Polymarket price WebSocket connected.");
        this.subscribeToAllAssets();
        this.startHeartbeat();
        this.startStaleDataCheck();
        this.startResubscribe();
      });

      this.ws.on("message", (data) => {
        const text = data.toString();
        if (!text.trim()) return;

        try {
          this.lastMessageReceivedAt = Date.now();
          // Parse all asset prices from the message
          for (const asset of SUPPORTED_CRYPTO_ASSETS) {
            if (asset === "OTHER") continue; // Skip invalid RTDS symbol
            const symbol = `${asset.toLowerCase()}/usd`;
            const points = parseRtdsChainlinkPoints(text, symbol);
            if (points.length > 0) {
              const latest = points.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
              const price: CryptoSpotPrice = {
                assetSymbol: asset,
                priceUsd: latest.value,
                source: "POLYMARKET_CHAINLINK",
                fetchedAt: new Date(latest.timestamp),
                receivedAt: new Date()
              };
              this.prices.set(asset, price);
              this.notifySubscribers(asset, price);
            }
          }
        } catch {
          // Ignore parse errors for individual messages
        }
      });

      this.ws.on("error", (error) => {
        this.isConnecting = false;
        this.logger?.warn("Persistent Polymarket price WebSocket error.", {
          error: error instanceof Error ? error.message : String(error)
        });
        this.scheduleReconnect();
      });

      this.ws.on("close", () => {
        this.isConnecting = false;
        this.stopHeartbeat();
        this.stopStaleDataCheck();
        this.stopResubscribe();
        this.scheduleReconnect();
      });
    } catch (error) {
      this.isConnecting = false;
      this.logger?.error("Failed to create persistent WebSocket.", error);
      this.scheduleReconnect();
    }
  }

  private subscribeToAllAssets(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const symbols = SUPPORTED_CRYPTO_ASSETS
      .filter(asset => asset !== "OTHER")
      .map(asset => `${asset.toLowerCase()}/usd`);

    // RTDS reliably streams subsequent updates when each filtered
    // subscription is sent independently. A grouped subscription can return
    // the initial snapshot for every asset but continue streaming only one.
    // Send with small delays to avoid overwhelming the server.
    let delay = 0;
    for (const symbol of symbols) {
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            action: "subscribe",
            subscriptions: [{
              topic: "crypto_prices_chainlink",
              type: "*",
              filters: JSON.stringify({ symbol })
            }]
          }));
        }
      }, delay);
      delay += 100;
    }

    this.logger?.info("Subscribed to all crypto price feeds.", {
      assets: symbols
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, PERSISTENT_WS_HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startStaleDataCheck(): void {
    this.stopStaleDataCheck();
    this.staleDataCheckInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      
      const timeSinceLastMessage = Date.now() - this.lastMessageReceivedAt;
      if (timeSinceLastMessage > PERSISTENT_WS_STALE_DATA_MS) {
        this.logger?.warn("Persistent WebSocket stale data detected. Reconnecting.", {
          timeSinceLastMessage,
          threshold: PERSISTENT_WS_STALE_DATA_MS
        });
        this.ws.close();
      }
    }, 30_000);
  }

  private stopStaleDataCheck(): void {
    if (this.staleDataCheckInterval) {
      clearInterval(this.staleDataCheckInterval);
      this.staleDataCheckInterval = null;
    }
  }

  private startResubscribe(): void {
    this.stopResubscribe();
    this.resubscribeInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.logger?.info("Periodic re-subscription to RTDS feeds.");
        this.subscribeToAllAssets();
      }
    }, PERSISTENT_WS_RESUBSCRIBE_MS);
  }

  private stopResubscribe(): void {
    if (this.resubscribeInterval) {
      clearInterval(this.resubscribeInterval);
      this.resubscribeInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, PERSISTENT_WS_RECONNECT_MS);
  }

  private notifySubscribers(asset: CryptoAsset, price: CryptoSpotPrice): void {
    for (const callback of this.subscribers) {
      try {
        callback(asset, price);
      } catch {
        // Ignore subscriber errors
      }
    }
  }
}

// Singleton instance
export const persistentPriceWs = new PersistentPriceWebSocket();

const COINGECKO_IDS: Partial<Record<CryptoAsset, string>> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  BNB: "binancecoin"
};

const COINBASE_PAIRS: Partial<Record<CryptoAsset, string>> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  XRP: "XRP-USD",
  DOGE: "DOGE-USD",
  AVAX: "AVAX-USD"
};

export class CryptoPriceService {
  private readonly cache = new Map<CryptoAsset, CachedPrice>();
  private static persistentWsStarted = false;

  constructor(
    private readonly logger?: LoggerService,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly maxRetries = DEFAULT_MAX_RETRIES,
    private readonly retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS
  ) {
    // Start persistent WebSocket only once
    if (!CryptoPriceService.persistentWsStarted && logger) {
      CryptoPriceService.persistentWsStarted = true;
      persistentPriceWs.setLogger(logger);
      persistentPriceWs.start();
      logger.info("Started persistent Polymarket price WebSocket.");
    }
  }

  async getSpotPriceUsd(assetSymbol: CryptoAsset): Promise<CryptoSpotPrice> {
    const cached = this.cache.get(assetSymbol);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // First, try to get price from persistent WebSocket (real-time Polymarket data)
    const persistentPrice = persistentPriceWs.getPrice(assetSymbol);
    if (persistentPrice && persistentPrice.priceUsd !== null) {
      // Use receivedAt for freshness (local time), fallback to fetchedAt
      const receiveTime = persistentPrice.receivedAt?.getTime() ?? persistentPrice.fetchedAt.getTime();
      const ageMs = Date.now() - receiveTime;
      if (ageMs < 10_000) {
        return this.cacheAndReturn(
          assetSymbol,
          persistentPrice.priceUsd,
          "POLYMARKET_CHAINLINK",
          persistentPrice.fetchedAt,
          persistentPrice.receivedAt
        );
      }
    }

    // Fallback to creating a new connection (original behavior)
    const chainlinkPrice = await this.fetchPolymarketChainlinkPrice(assetSymbol);
    if (chainlinkPrice !== null) {
      return this.cacheAndReturn(assetSymbol, chainlinkPrice, "POLYMARKET_CHAINLINK");
    }

    this.logger?.warn("Polymarket Chainlink price unavailable. Falling back to Coinbase.", {
      assetSymbol
    });

    const coinbasePair = COINBASE_PAIRS[assetSymbol];
    const coingeckoId = COINGECKO_IDS[assetSymbol];
    if (!coinbasePair && !coingeckoId) {
      return this.cacheAndReturn(assetSymbol, null, "UNSUPPORTED");
    }

    if (coinbasePair) {
      const coinbasePrice = await this.fetchCoinbasePrice(assetSymbol, coinbasePair);
      if (coinbasePrice !== null) {
        return this.cacheAndReturn(assetSymbol, coinbasePrice, "COINBASE");
      }
    }

    if (!coingeckoId) {
      return this.cacheAndReturn(assetSymbol, null, "ERROR");
    }

    const url = `${COINGECKO_BASE_URL}/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`;

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

        if (response.status === 429 && attempt < this.maxRetries) {
          const backoffMs = this.getBackoffMs(attempt, response);
          this.logger?.warn("CoinGecko rate limit hit. Backing off before retry.", {
            assetSymbol,
            backoffMs
          });
          await sleep(backoffMs);
          continue;
        }

        if (!response.ok) {
          if (isTemporaryStatus(response.status) && attempt < this.maxRetries) {
            await sleep(this.getBackoffMs(attempt, response));
            continue;
          }

          this.logger?.warn("CoinGecko price request returned non-OK response.", {
            assetSymbol,
            status: response.status
          });
          return this.cacheAndReturn(assetSymbol, null, "ERROR");
        }

        const raw = (await response.json()) as unknown;
        const price = extractUsdPrice(raw, coingeckoId);

        return this.cacheAndReturn(assetSymbol, price, price === null ? "ERROR" : "COINGECKO");
      } catch (error) {
        if (attempt < this.maxRetries) {
          await sleep(this.getBackoffMs(attempt));
          continue;
        }

        this.logger?.warn("CoinGecko price request failed.", {
          assetSymbol,
          error: error instanceof Error ? error.message : String(error)
        });
        return this.cacheAndReturn(assetSymbol, null, "ERROR");
      } finally {
        clearTimeout(timeout);
      }
    }

    return this.cacheAndReturn(assetSymbol, null, "ERROR");
  }

  /**
   * Reads only the persistent Polymarket Chainlink feed. This method never
   * opens a connection, waits for a network request, or falls back to another
   * exchange, so it is safe for the latency-sensitive real-order path.
   */
  getFreshPolymarketChainlinkPrice(
    assetSymbol: CryptoAsset,
    maxAgeMs = 3_000
  ): CryptoSpotPrice | null {
    const price = persistentPriceWs.getPrice(assetSymbol);
    return isFreshPolymarketChainlinkPrice(price, Date.now(), maxAgeMs)
      ? price
      : null;
  }

  async getCoinbaseSpotPriceUsd(assetSymbol: CryptoAsset): Promise<CryptoSpotPrice> {
    const coinbasePair = COINBASE_PAIRS[assetSymbol];
    if (!coinbasePair) {
      return {
        assetSymbol,
        priceUsd: null,
        source: "UNSUPPORTED",
        fetchedAt: new Date()
      };
    }

    const priceUsd = await this.fetchCoinbasePrice(assetSymbol, coinbasePair);
    return {
      assetSymbol,
      priceUsd,
      source: priceUsd === null ? "ERROR" : "COINBASE",
      fetchedAt: new Date()
    };
  }

  async getPolymarketCryptoPrice(
    assetSymbol: CryptoAsset,
    timeframe: string,
    endDate: Date
  ): Promise<CryptoSpotPrice> {
    const symbol = assetSymbol === "OTHER" ? null : assetSymbol;
    const variant = getCryptoPriceVariant(timeframe);
    const windowStart = inferWindowStartFromEnd(endDate, timeframe);

    if (!symbol || !windowStart || !variant) {
      this.logger?.warn("Cannot fetch Polymarket crypto price: missing parameters.", {
        assetSymbol,
        timeframe,
        endDate: endDate.toISOString()
      });
      return {
        assetSymbol,
        priceUsd: null,
        source: "ERROR",
        fetchedAt: new Date()
      };
    }

    const params = new URLSearchParams({
      symbol,
      eventStartTime: windowStart.toISOString().replace(/\.\d{3}Z$/, "Z"),
      variant,
      endDate: endDate.toISOString().replace(/\.\d{3}Z$/, "Z")
    });
    const url = `https://polymarket.com/api/crypto/crypto-price?${params.toString()}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Referer: "https://polymarket.com/",
          "User-Agent": "Mozilla/5.0 PolymarketCryptoAnalyzerBot/0.1"
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger?.warn("Polymarket crypto-price API returned non-OK response.", {
          assetSymbol,
          status: response.status
        });
        return {
          assetSymbol,
          priceUsd: null,
          source: "ERROR",
          fetchedAt: new Date()
        };
      }

      const text = await response.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const closePrice = toPositiveNumber(parsed.closePrice);

      this.logger?.info("POLYMARKET_CRYPTO_PRICE_API real-time price", {
        assetSymbol,
        symbol,
        closePrice,
        openPrice: parsed.openPrice,
        completed: parsed.completed,
        fullResponse: text.slice(0, 300)
      });

      if (closePrice !== null) {
        return this.cacheAndReturn(assetSymbol, closePrice, "POLYMARKET_CRYPTO_PRICE_API");
      }

      return {
        assetSymbol,
        priceUsd: null,
        source: "ERROR",
        fetchedAt: new Date()
      };
    } catch (error) {
      this.logger?.warn("Polymarket crypto-price API request failed.", {
        assetSymbol,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        assetSymbol,
        priceUsd: null,
        source: "ERROR",
        fetchedAt: new Date()
      };
    }
  }

  private fetchPolymarketChainlinkPrice(assetSymbol: CryptoAsset): Promise<number | null> {
    const symbol = `${assetSymbol.toLowerCase()}/usd`;

    return new Promise((resolve) => {
      const ws = new WebSocket(RTDS_WS_URL);
      let settled = false;
      const finish = (price: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        resolve(price);
      };
      const timeout = setTimeout(() => finish(null), this.timeoutMs);

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
        if (!text.trim()) return;

        try {
          const points = parseRtdsChainlinkPoints(text, symbol);
          if (points.length === 0) return;
          const latest = points.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
          finish(latest.value);
        } catch {
          finish(null);
        }
      });

      ws.on("error", () => finish(null));
      ws.on("close", () => finish(null));
    });
  }

  private async fetchCoinbasePrice(assetSymbol: CryptoAsset, pair: string): Promise<number | null> {
    const url = `${COINBASE_BASE_URL}/prices/${encodeURIComponent(pair)}/spot`;

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

        if (response.status === 429 && attempt < this.maxRetries) {
          const backoffMs = this.getBackoffMs(attempt, response);
          this.logger?.warn("Coinbase rate limit hit. Backing off before retry.", {
            assetSymbol,
            backoffMs
          });
          await sleep(backoffMs);
          continue;
        }

        if (!response.ok) {
          if (isTemporaryStatus(response.status) && attempt < this.maxRetries) {
            await sleep(this.getBackoffMs(attempt, response));
            continue;
          }

          this.logger?.warn("Coinbase price request returned non-OK response. Falling back.", {
            assetSymbol,
            status: response.status
          });
          return null;
        }

        const raw = (await response.json()) as unknown;
        return extractCoinbaseUsdPrice(raw);
      } catch (error) {
        if (attempt < this.maxRetries) {
          await sleep(this.getBackoffMs(attempt));
          continue;
        }

        this.logger?.warn("Coinbase price request failed. Falling back.", {
          assetSymbol,
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }

    return null;
  }

  private cacheAndReturn(
    assetSymbol: CryptoAsset,
    priceUsd: number | null,
    source: CryptoSpotPrice["source"],
    fetchedAt = new Date(),
    receivedAt?: Date
  ): CryptoSpotPrice {
    const value: CryptoSpotPrice = {
      assetSymbol,
      priceUsd,
      source,
      fetchedAt,
      receivedAt
    };

    this.cache.set(assetSymbol, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS
    });

    return value;
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

export function isFreshPolymarketChainlinkPrice(
  price: CryptoSpotPrice | null,
  nowMs: number,
  maxAgeMs: number
): price is CryptoSpotPrice {
  if (
    !price ||
    price.source !== "POLYMARKET_CHAINLINK" ||
    price.priceUsd === null ||
    !Number.isFinite(price.priceUsd) ||
    price.priceUsd <= 0 ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs < 0
  ) {
    return false;
  }

  // Use receivedAt for freshness (local time), fallback to fetchedAt
  const receiveTime = price.receivedAt?.getTime() ?? price.fetchedAt.getTime();
  const ageMs = nowMs - receiveTime;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function extractUsdPrice(raw: unknown, coingeckoId: string): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const asset = (raw as Record<string, unknown>)[coingeckoId];
  if (!asset || typeof asset !== "object") {
    return null;
  }

  const price = Number((asset as Record<string, unknown>).usd);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function extractCoinbaseUsdPrice(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = (raw as Record<string, unknown>).data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const amount = Number((data as Record<string, unknown>).amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function isTemporaryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
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

function inferWindowStartFromEnd(endDate: Date, timeframe: string): Date | null {
  const durationMs = getTimeframeMs(timeframe);
  if (durationMs !== null) {
    return new Date(endDate.getTime() - durationMs);
  }

  return null;
}
