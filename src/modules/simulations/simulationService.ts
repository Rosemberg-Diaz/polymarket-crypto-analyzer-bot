import { config } from "../../config/env";
import { StrategySignal } from "../signals/signal";

export interface SimulatedDecision {
  marketTitle: string;
  side: "YES" | "NO";
  stakeUsd: number;
  entryPrice: number;
  confidence: number;
}

export class SimulationService {
  createDecision(signal: StrategySignal): SimulatedDecision {
    const yesPrice = signal.market.yesPrice ?? 0.5;
    const noPrice = signal.market.noPrice ?? 0.5;
    const side = yesPrice <= noPrice ? "YES" : "NO";

    return {
      marketTitle: signal.market.title,
      side,
      stakeUsd: config.simulatedStakeUsd,
      entryPrice: side === "YES" ? yesPrice : noPrice,
      confidence: signal.confidence
    };
  }
}
