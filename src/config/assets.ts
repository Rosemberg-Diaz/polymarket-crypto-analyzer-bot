export const SUPPORTED_CRYPTO_ASSETS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "AVAX",
  "BNB",
  "OTHER"
] as const;

export type CryptoAsset = (typeof SUPPORTED_CRYPTO_ASSETS)[number];

export const SUPPORTED_CRYPTO_MARKET_TYPES = [
  "UP_DOWN_SHORT_TERM",
  "PRICE_TARGET",
  "ABOVE_BELOW",
  "RANGE_MARKET",
  "CRYPTO_OTHER"
] as const;

export type CryptoMarketType = (typeof SUPPORTED_CRYPTO_MARKET_TYPES)[number];

export const DEFAULT_PRIORITY_ASSETS: CryptoAsset[] = ["BTC", "ETH", "SOL"];
