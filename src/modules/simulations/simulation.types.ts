export type SimulatedTradeStatus = "PENDING" | "RESOLVED" | "CANCELLED" | "ERROR";

export interface SimulatedTradeCalculationInput {
  stake: number;
  entryPrice: number;
  didWin: boolean;
}

export interface SimulatedTradeCalculationResult {
  stake: number;
  entryPrice: number;
  shares: number;
  finalValue: number;
  profit: number;
  roi: number;
  isWin: boolean;
}

export interface SimulatedDecision {
  marketTitle: string;
  side: "YES" | "NO";
  stakeUsd: number;
  entryPrice: number;
  confidence: number;
}
