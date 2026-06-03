import {
  CryptoAsset,
  CryptoMarketType,
  SUPPORTED_CRYPTO_ASSETS
} from "../../config/assets";

const assetMatchers: Array<{ asset: CryptoAsset; tokens: string[] }> = [
  { asset: "BTC", tokens: ["BTC", "BITCOIN"] },
  { asset: "ETH", tokens: ["ETH", "ETHEREUM"] },
  { asset: "SOL", tokens: ["SOL", "SOLANA"] },
  { asset: "XRP", tokens: ["XRP", "RIPPLE"] },
  { asset: "DOGE", tokens: ["DOGE", "DOGECOIN"] },
  { asset: "AVAX", tokens: ["AVAX", "AVALANCHE"] },
  { asset: "BNB", tokens: ["BNB", "BINANCE"] }
];

export function classifyCryptoAsset(title: string): CryptoAsset {
  const normalized = title.toUpperCase();
  const match = assetMatchers.find(({ tokens }) =>
    tokens.some((token) => normalized.includes(token))
  );

  return match?.asset ?? "OTHER";
}

export function classifyCryptoMarketType(title: string): CryptoMarketType {
  const normalized = title.toUpperCase();

  if (normalized.includes("UP") && normalized.includes("DOWN")) {
    return "UP_DOWN_SHORT_TERM";
  }

  if (normalized.includes("ABOVE") || normalized.includes("BELOW")) {
    return "ABOVE_BELOW";
  }

  if (normalized.includes("BETWEEN") || normalized.includes("RANGE")) {
    return "RANGE_MARKET";
  }

  if (normalized.includes("$") || normalized.includes("PRICE")) {
    return "PRICE_TARGET";
  }

  return "CRYPTO_OTHER";
}

export function isSupportedCryptoAsset(asset: string): asset is CryptoAsset {
  return SUPPORTED_CRYPTO_ASSETS.includes(asset as CryptoAsset);
}
