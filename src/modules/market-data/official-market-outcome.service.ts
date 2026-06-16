import { prisma } from "../../database/client";
import { PolymarketClient } from "../polymarket/polymarket.client";
import {
  inferGammaWinnerFromOutcomePrices,
  inferWinningOutcome,
  normalizeOutcome
} from "../jobs/resolve-simulated-trades.job";

export interface OfficialMarketOutcome {
  outcome: string;
  source: "POLYMARKET_EXPLICIT" | "GAMMA_OUTCOME_PRICES" | "CLOB_FINAL_PRICE";
}

const FINAL_WIN_PRICE = 0.98;

export class OfficialMarketOutcomeService {
  constructor(private readonly polymarketClient = new PolymarketClient()) {}

  async resolve(marketId: string, slug: string): Promise<OfficialMarketOutcome | null> {
    const market = await this.polymarketClient.getMarketBySlug(slug);
    if (!market) {
      return null;
    }

    const direct = inferWinningOutcome(market) ?? inferGammaWinnerFromOutcomePrices(market);
    if (
      direct &&
      (direct.source === "POLYMARKET_EXPLICIT" ||
        direct.source === "GAMMA_OUTCOME_PRICES" ||
        direct.source === "CLOB_FINAL_PRICE")
    ) {
      return {
        outcome: direct.normalizedName,
        source: direct.source
      };
    }

    if (market.closed !== true && market.active !== false) {
      return null;
    }

    const outcomes = await prisma.marketOutcome.findMany({
      where: {
        marketId,
        externalTokenId: { not: null }
      }
    });
    for (const outcome of outcomes) {
      if (!outcome.externalTokenId) {
        continue;
      }

      const price = await this.polymarketClient.getPrice(outcome.externalTokenId, "BUY");
      const normalized = normalizeOutcome(outcome.normalizedName || outcome.name);
      if (price.price !== null && price.price >= FINAL_WIN_PRICE && normalized !== "OTHER") {
        return {
          outcome: normalized,
          source: "CLOB_FINAL_PRICE"
        };
      }
    }

    return null;
  }
}
