const DATA_API_URL = "https://data-api.polymarket.com";

export interface PolymarketWalletActivity {
  timestamp: number;
  conditionId: string;
  type: string;
  size: number;
  usdcSize: number;
  transactionHash: string;
  asset: string;
  side: string;
  slug: string;
  outcome: string;
}

export interface PolymarketWalletPosition {
  asset: string;
  conditionId: string;
  size: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  slug: string;
  outcome: string;
  redeemable: boolean;
}

export class PolymarketWalletDataService {
  constructor(private readonly walletAddress: string) {}

  async getActivity(limit = 500): Promise<PolymarketWalletActivity[]> {
    const value = await this.fetchJson(
      `/activity?user=${encodeURIComponent(this.walletAddress)}&limit=${limit}`
    );
    return Array.isArray(value)
      ? value.map(normalizeActivity).filter(isNotNull)
      : [];
  }

  async getPositions(): Promise<PolymarketWalletPosition[]> {
    const value = await this.fetchJson(
      `/positions?user=${encodeURIComponent(this.walletAddress)}&sizeThreshold=0`
    );
    return Array.isArray(value)
      ? value.map(normalizePosition).filter(isNotNull)
      : [];
  }

  private async fetchJson(path: string): Promise<unknown> {
    const response = await fetch(`${DATA_API_URL}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new Error(`Polymarket Data API ${response.status}: ${path}`);
    }
    return response.json();
  }
}

function normalizeActivity(value: unknown): PolymarketWalletActivity | null {
  const row = asRecord(value);
  if (!row) return null;
  const timestamp = finite(row.timestamp);
  const usdcSize = finite(row.usdcSize);
  const size = finite(row.size);
  if (timestamp === null || usdcSize === null || size === null) return null;
  return {
    timestamp,
    conditionId: text(row.conditionId),
    type: text(row.type).toUpperCase(),
    size,
    usdcSize,
    transactionHash: text(row.transactionHash),
    asset: text(row.asset),
    side: text(row.side).toUpperCase(),
    slug: text(row.slug),
    outcome: text(row.outcome).toUpperCase()
  };
}

function normalizePosition(value: unknown): PolymarketWalletPosition | null {
  const row = asRecord(value);
  if (!row) return null;
  const size = finite(row.size);
  const initialValue = finite(row.initialValue);
  const currentValue = finite(row.currentValue);
  const cashPnl = finite(row.cashPnl);
  if (
    size === null ||
    initialValue === null ||
    currentValue === null ||
    cashPnl === null
  ) return null;
  return {
    asset: text(row.asset),
    conditionId: text(row.conditionId),
    size,
    initialValue,
    currentValue,
    cashPnl,
    slug: text(row.slug),
    outcome: text(row.outcome).toUpperCase(),
    redeemable: row.redeemable === true
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}
