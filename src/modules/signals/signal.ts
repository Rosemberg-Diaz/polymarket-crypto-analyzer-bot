import { CryptoMarketCandidate } from "../crypto/cryptoMarket";

export interface StrategySignal {
  market: CryptoMarketCandidate;
  strategy: string;
  confidence: number;
  reason: string;
}
