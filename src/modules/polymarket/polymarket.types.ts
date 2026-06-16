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
  nextCursor?: string;
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

export interface PolymarketMarketPage {
  markets: PolymarketMarket[];
  nextCursor: string | null;
}

export interface PolymarketEvent {
  id?: string;
  slug?: string;
  title?: string;
  ticker?: string;
  description?: string;
  category?: string;
  tags?: string[];
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  markets?: PolymarketMarket[];
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
  minOrderSize?: number | null;
  tickSize?: number | null;
  timestamp?: string | null;
  hash?: string | null;
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
