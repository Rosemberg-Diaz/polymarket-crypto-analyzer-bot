const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3001";

export interface HealthStatus {
  appMode: string;
  enableRealTrading: boolean;
  scanIntervalSeconds: number;
  lastSnapshotAt: string | null;
  lastPredictionAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  totalPendingTrades: number;
  totalResolvedTrades: number;
  databaseStatus: "OK" | "ERROR";
  uptime: number;
  backupCount: number;
  databaseSizeBytes: number;
}

export interface PerformanceSummary {
  totalPredictions: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  averageRoi: number;
  bestAsset: string | null;
  worstAsset: string | null;
  bestStrategy: string | null;
  worstStrategy: string | null;
  mlReady: boolean;
  resolvedTradesForMl: number;
  minResolvedTradesForMl: number;
  charts: {
    cumulativeProfit: Array<{ date: string; profit: number }>;
    winRateByAsset: SegmentMetric[];
    profitByStrategy: SegmentMetric[];
    signalsByDay: Array<{ date: string; count: number }>;
  };
}

export interface SegmentMetric {
  key: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  averageRoi?: number;
}

export interface LogLine {
  timestamp: string | null;
  level: string;
  message: string;
  raw: string;
}

export interface MarketRow {
  id: string;
  question: string;
  assetSymbol: string;
  marketType: string;
  timeframe: string | null;
  active: boolean;
  closed: boolean;
  endDate: string | null;
  lastSnapshot: null | {
    createdAt: string;
    currentAssetPrice: number | null;
    upPrice: number | null;
    downPrice: number | null;
    spread: number | null;
    liquidity: number | null;
  };
}

export interface PredictionRow {
  id: string;
  createdAt: string;
  assetSymbol: string;
  marketQuestion: string;
  marketType: string;
  strategyName: string;
  predictedOutcome: string;
  entryPrice: number | null;
  impliedProbability: number | null;
  botProbability: number | null;
  edge: number | null;
  recommendation: string;
  confidence: number | null;
  reason: string | null;
  historicalSummary: string | null;
}

export interface TradeRow {
  id: string;
  createdAt: string;
  assetSymbol: string;
  marketQuestion: string;
  marketType: string;
  prediction: string;
  stake: number | null;
  entryPrice: number | null;
  shares: number | null;
  status: string;
  result: string | null;
  isWin: boolean | null;
  finalValue: number | null;
  profit: number | null;
  roi: number | null;
  resolvedAt: string | null;
}

export interface LearningStats {
  mlReady: boolean;
  resolvedTradesForMl: number;
  minResolvedTradesForMl: number;
  similarCasesAccumulated: number;
  byAsset: SegmentMetric[];
  byStrategy: SegmentMetric[];
  byMarketType: SegmentMetric[];
  byPredictedOutcome: SegmentMetric[];
  learningStats: Array<{
    id: string;
    strategyName: string;
    marketType: string;
    assetSymbol: string;
    predictedOutcome: string;
    totalPredictions: number;
    wins: number;
    losses: number;
    winRate: number | null;
    totalProfit: number | null;
    averageRoi: number | null;
    maxDrawdown: number | null;
    updatedAt: string;
  }>;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });

  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => apiGet<HealthStatus>("/health"),
  performance: () => apiGet<PerformanceSummary>("/api/performance/summary"),
  logs: (params: Record<string, string | number | undefined> = {}) =>
    apiGet<{ logs: LogLine[] }>(`/api/logs${buildQuery(params)}`),
  markets: (params: Record<string, string | number | boolean | undefined> = {}) =>
    apiGet<{ markets: MarketRow[] }>(`/api/markets${buildQuery(params)}`),
  predictions: (params: Record<string, string | number | undefined> = {}) =>
    apiGet<{ predictions: PredictionRow[] }>(`/api/predictions${buildQuery(params)}`),
  trades: (params: Record<string, string | number | boolean | undefined> = {}) =>
    apiGet<{ trades: TradeRow[] }>(`/api/trades${buildQuery(params)}`),
  learning: () => apiGet<LearningStats>("/api/learning/stats")
};
