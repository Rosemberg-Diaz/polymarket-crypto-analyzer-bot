export type PolymarketSide = "BUY" | "SELL";

export interface PolymarketClientOptions {
  gammaBaseUrl?: string;
  clobBaseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

export interface GetActiveMarketsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  tagId?: string;
  category?: string;
  includeRaw?: boolean;
}

export interface PolymarketMarket {
  id?: string;
  conditionId?: string;
  slug?: string;
  question?: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  startDate?: string;
  endDate?: string;
  resolutionSource?: string;
  outcomes?: unknown;
  tokens?: PolymarketToken[];
  raw?: unknown;
}

export interface PolymarketCryptoMarketSyncResult {
  fetchedMarkets: number;
  cryptoMarkets: number;
  savedMarkets: number;
  operableMarkets: number;
}

export interface PolymarketToken {
  token_id?: string;
  tokenId?: string;
  outcome?: string;
  price?: string | number;
  raw?: unknown;
}

export interface PolymarketOrderBookLevel {
  price: string;
  size: string;
}

export interface PolymarketOrderBook {
  tokenId: string;
  bids: PolymarketOrderBookLevel[];
  asks: PolymarketOrderBookLevel[];
  raw?: unknown;
}

export interface PolymarketPriceResponse {
  tokenId: string;
  side: PolymarketSide;
  price: number | null;
  raw?: unknown;
}

export interface PolymarketSpreadResponse {
  tokenId: string;
  spread: number | null;
  raw?: unknown;
}

export interface PolymarketPricesHistoryPoint {
  timestamp: number;
  price: number;
}

export interface PolymarketPricesHistoryResponse {
  tokenId: string;
  history: PolymarketPricesHistoryPoint[];
  raw?: unknown;
}
