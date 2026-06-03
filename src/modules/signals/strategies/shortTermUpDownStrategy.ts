import { CryptoMarketCandidate } from "../../crypto/cryptoMarket";
import { StrategySignal } from "../signal";

export class ShortTermUpDownStrategy {
  readonly name = "short-term-up-down-baseline";

  evaluate(market: CryptoMarketCandidate): StrategySignal | null {
    if (market.marketType !== "UP_DOWN_SHORT_TERM") {
      return null;
    }

    if (market.yesPrice === undefined || market.noPrice === undefined) {
      return null;
    }

    const priceImbalance = Math.abs(market.yesPrice - market.noPrice);

    return {
      market,
      strategy: this.name,
      confidence: Math.max(0.5, Math.min(0.9, 0.5 + priceImbalance)),
      reason: "Baseline local simulation signal for short-term crypto Up/Down markets."
    };
  }
}
