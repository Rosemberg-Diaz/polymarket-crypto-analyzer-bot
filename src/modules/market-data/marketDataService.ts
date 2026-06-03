import { config } from "../../config/env";
import { CryptoMarketCandidate } from "../crypto/cryptoMarket";
import { PolymarketClient } from "../polymarket/polymarketClient";

export class MarketDataService {
  constructor(private readonly polymarketClient: PolymarketClient) {}

  async getEligibleCryptoMarkets(): Promise<CryptoMarketCandidate[]> {
    const markets = await this.polymarketClient.fetchCryptoMarkets();

    return markets
      .filter((market) => market.liquidityUsd >= config.minLiquidity)
      .filter((market) => market.spread <= config.maxSpread)
      .filter((market) => market.asset !== "OTHER" || config.priorityAssets.includes("OTHER"))
      .sort((left, right) => {
        if (config.prioritizeShortTermUpDown) {
          const leftPriority = left.marketType === "UP_DOWN_SHORT_TERM" ? 1 : 0;
          const rightPriority = right.marketType === "UP_DOWN_SHORT_TERM" ? 1 : 0;

          if (leftPriority !== rightPriority) {
            return rightPriority - leftPriority;
          }
        }

        const leftAssetPriority = config.priorityAssets.includes(left.asset) ? 1 : 0;
        const rightAssetPriority = config.priorityAssets.includes(right.asset) ? 1 : 0;

        return rightAssetPriority - leftAssetPriority;
      });
  }
}
