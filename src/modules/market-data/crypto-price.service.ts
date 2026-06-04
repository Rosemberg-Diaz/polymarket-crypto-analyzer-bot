import { CryptoAsset } from "../../config/assets";
import { LoggerService } from "../logger/logger.service";

export interface CryptoSpotPrice {
  assetSymbol: CryptoAsset;
  priceUsd: number | null;
  source: "COINGECKO" | "UNSUPPORTED" | "ERROR";
  fetchedAt: Date;
}

interface CachedPrice {
  value: CryptoSpotPrice;
  expiresAt: number;
}

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const CACHE_TTL_MS = 20_000;

const COINGECKO_IDS: Partial<Record<CryptoAsset, string>> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  BNB: "binancecoin"
};

export class CryptoPriceService {
  private readonly cache = new Map<CryptoAsset, CachedPrice>();

  constructor(
    private readonly logger?: LoggerService,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly maxRetries = DEFAULT_MAX_RETRIES,
    private readonly retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS
  ) {}

  async getSpotPriceUsd(assetSymbol: CryptoAsset): Promise<CryptoSpotPrice> {
    const cached = this.cache.get(assetSymbol);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const coingeckoId = COINGECKO_IDS[assetSymbol];
    if (!coingeckoId) {
      return this.cacheAndReturn(assetSymbol, null, "UNSUPPORTED");
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

  private cacheAndReturn(
    assetSymbol: CryptoAsset,
    priceUsd: number | null,
    source: CryptoSpotPrice["source"]
  ): CryptoSpotPrice {
    const value: CryptoSpotPrice = {
      assetSymbol,
      priceUsd,
      source,
      fetchedAt: new Date()
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

function isTemporaryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
