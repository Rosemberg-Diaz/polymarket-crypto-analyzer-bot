import { CryptoMarketCandidate } from "../crypto/cryptoMarket";
import { StrategySignal } from "./signal";
import { ShortTermUpDownStrategy } from "./strategies/shortTermUpDownStrategy";

export class SignalService {
  private readonly strategies = [new ShortTermUpDownStrategy()];

  generateSignals(markets: CryptoMarketCandidate[]): StrategySignal[] {
    return markets.flatMap((market) =>
      this.strategies
        .map((strategy) => strategy.evaluate(market))
        .filter((signal): signal is StrategySignal => signal !== null)
    );
  }
}
