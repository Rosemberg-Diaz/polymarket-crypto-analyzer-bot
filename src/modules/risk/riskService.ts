import { config } from "../../config/env";
import { StrategySignal } from "../signals/signal";

export class RiskService {
  approveSimulation(signal: StrategySignal): boolean {
    return (
      config.appMode === "SIMULATION_ONLY" &&
      !config.enableRealTrading &&
      signal.market.spread <= config.maxSpread &&
      signal.market.liquidityUsd >= config.minLiquidity
    );
  }
}
