import { prisma } from "../../database/client";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { PolymarketMarket } from "../polymarket/polymarket.types";
import {
  inferGammaWinnerFromOutcomePrices,
  inferWinningOutcome,
  normalizeOutcome
} from "../jobs/resolve-simulated-trades.job";

export interface OfficialMarketOutcome {
  outcome: string;
  source:
    | "POLYMARKET_EXPLICIT"
    | "GAMMA_OUTCOME_PRICES"
    | "GAMMA_OUTCOME_PRICES_FINAL_LIVE"
    | "CLOB_FINAL_PRICE";
}

const FINAL_WIN_PRICE = 0.98;
const LIVE_FINAL_WIN_PRICE = 0.999;
const LIVE_FINAL_LOSS_PRICE = 0.001;
const LIVE_FINAL_OUTCOME_DELAY_MS = 5 * 60_000;

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

    const finalLive = inferFinalLiveWinnerFromOutcomePrices(market, new Date());
    if (finalLive) {
      return finalLive;
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

function inferFinalLiveWinnerFromOutcomePrices(
  market: PolymarketMarket,
  now: Date
): OfficialMarketOutcome | null {
  const endDate = getMarketEndDate(market);
  if (!endDate || endDate.getTime() > now.getTime() - LIVE_FINAL_OUTCOME_DELAY_MS) {
    return null;
  }

  const raw = getRawRecord(market);
  const outcomes = parseMaybeJson(raw.outcomes);
  const outcomePrices = parseMaybeJson(raw.outcomePrices);

  if (
    !Array.isArray(outcomes) ||
    !Array.isArray(outcomePrices) ||
    outcomes.length !== outcomePrices.length ||
    outcomes.length < 2
  ) {
    return null;
  }

  const rows = outcomes.flatMap((outcome, index) => {
    const normalizedName = normalizeOutcome(String(outcome));
    const price = Number(outcomePrices[index]);

    if (normalizedName === "OTHER" || !Number.isFinite(price)) {
      return [];
    }

    return [{ normalizedName, price }];
  });

  const winners = rows.filter((row) => row.price >= LIVE_FINAL_WIN_PRICE);
  const losers = rows.filter((row) => row.price <= LIVE_FINAL_LOSS_PRICE);

  if (winners.length !== 1 || losers.length !== rows.length - 1) {
    return null;
  }

  return {
    outcome: winners[0].normalizedName,
    source: "GAMMA_OUTCOME_PRICES_FINAL_LIVE"
  };
}

function getMarketEndDate(market: PolymarketMarket): Date | null {
  const raw = getRawRecord(market);
  const value = market.endDate ?? getString(raw, "endDate") ?? getString(raw, "end_date");
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getRawRecord(market: PolymarketMarket): Record<string, unknown> {
  if (market.raw && typeof market.raw === "object") {
    return market.raw as Record<string, unknown>;
  }

  return market as unknown as Record<string, unknown>;
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
