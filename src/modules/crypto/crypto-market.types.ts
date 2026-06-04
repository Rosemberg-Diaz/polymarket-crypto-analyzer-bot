import { CryptoAsset, CryptoMarketType } from "../../config/assets";

export type CryptoTimeframe = "5m" | "15m" | "1h" | "1d" | "unknown";

export type NormalizedOutcomeName = "UP" | "DOWN" | "YES" | "NO" | "OTHER";
export type TargetPriceSource =
  | "POLYMARKET_GAMMA"
  | "POLYMARKET_CRYPTO_PRICE_API"
  | "POLYMARKET_RTDS_CHAINLINK"
  | "POLYMARKET_UI_PAYLOAD"
  | "POLYMARKET_UMA_ANCILLARY"
  | "LOCAL_SPOT_APPROXIMATION"
  | "PREVIOUS_SNAPSHOT"
  | "UNKNOWN";

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
  tokens?: unknown;
  active?: boolean;
  closed?: boolean;
  rawData?: unknown;
}

export interface NormalizedCryptoMarketOutcome {
  externalTokenId: string | null;
  name: string;
  normalizedName: NormalizedOutcomeName;
  currentPrice: number | null;
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
  active: boolean;
  closed: boolean;
  endDate: Date | null;
  resolutionSource: string | null;
  targetPrice: number | null;
  targetPriceSource: TargetPriceSource;
  targetPriceTrustedForLearning: boolean;
  outcomes: NormalizedCryptoMarketOutcome[];
  tokenIds: string[];
  isOperable: boolean;
  nonOperableReason: string | null;
  priorityScore: number;
  rawData: string;
}
