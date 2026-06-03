import { CryptoAsset, CryptoMarketType } from "../../config/assets";

export type CryptoTimeframe = "5m" | "15m" | "1h" | "1d" | "unknown";

export type NormalizedOutcomeName = "UP" | "DOWN" | "YES" | "NO" | "OTHER";

export interface CryptoMarketTextInput {
  question?: string | null;
  slug?: string | null;
  description?: string | null;
  tags?: string[] | null;
}

export interface SupportedInitialMarketInput {
  assetSymbol: CryptoAsset;
  marketType: CryptoMarketType;
  timeframe: CryptoTimeframe;
}

export interface RawPolymarketLikeMarket {
  id?: string;
  conditionId?: string;
  slug?: string;
  question?: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[] | Array<{ label?: string; name?: string; slug?: string }>;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  resolutionSource?: string | null;
  outcomes?: unknown;
  rawData?: unknown;
}

export interface NormalizedCryptoMarket {
  externalMarketId: string | null;
  slug: string | null;
  question: string;
  category: "CRYPTO";
  assetSymbol: CryptoAsset;
  baseAsset: CryptoAsset | null;
  quoteAsset: string | null;
  marketType: CryptoMarketType;
  timeframe: CryptoTimeframe;
  resolutionSource: string | null;
  targetPrice: number | null;
  rawData: string;
}
