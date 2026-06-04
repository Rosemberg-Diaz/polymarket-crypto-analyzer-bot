import { Prisma, SimulatedTrade } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { PolymarketMarket } from "../polymarket/polymarket.types";
import { SimulationService } from "../simulations/simulation.service";

interface OfficialGammaWinner {
  winner: "UP" | "DOWN" | "YES" | "NO";
  rows: Array<{
    name: string;
    normalizedName: string;
    price: number;
  }>;
}

interface ReprocessResult {
  scanned: number;
  updated: number;
  skipped: number;
}

const TRUSTED_RESULT_SOURCES = [
  "GAMMA_OUTCOME_PRICES",
  "POLYMARKET_EXPLICIT",
  "CLOB_FINAL_PRICE",
  "POLYMARKET_RTDS_CHAINLINK_CLOSE"
];

export class ReprocessOfficialGammaResultsJob {
  constructor(
    private readonly logger: LoggerService,
    private readonly polymarketClient = new PolymarketClient(),
    private readonly simulationService = new SimulationService()
  ) {}

  async runOnce(): Promise<ReprocessResult> {
    const trades = await prisma.simulatedTrade.findMany({
      where: {
        status: "RESOLVED",
        result: {
          contains: "LOCAL_SPOT_TARGET_FALLBACK"
        }
      },
      include: {
        market: true,
        prediction: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    let updated = 0;
    let skipped = 0;

    for (const trade of trades) {
      const winner = await this.resolveGammaWinner(trade.market.slug);
      if (!winner) {
        skipped += 1;
        this.logger.warn("Could not reprocess simulated trade with Gamma outcome prices.", {
          tradeId: trade.id,
          slug: trade.market.slug
        });
        continue;
      }

      const predictedOutcome = normalizeOutcome(trade.prediction.predictedOutcome);
      const didWin = predictedOutcome === winner.winner;
      const calculation = this.simulationService.calculateTradeResult({
        stake: Number(trade.stake),
        entryPrice: Number(trade.entryPrice),
        didWin
      });

      await prisma.simulatedTrade.update({
        where: {
          id: trade.id
        },
        data: {
          result: `${winner.winner}:GAMMA_OUTCOME_PRICES`,
          isWin: calculation.isWin,
          finalValue: toDecimal(calculation.finalValue),
          profit: toDecimal(calculation.profit),
          roi: toDecimal(calculation.roi),
          resolvedAt: trade.resolvedAt ?? new Date()
        }
      });

      updated += 1;
      this.logger.info("Reprocessed simulated trade using Gamma official outcome prices.", {
        tradeId: trade.id,
        slug: trade.market.slug,
        prediction: predictedOutcome,
        officialWinner: winner.winner,
        outcomePrices: winner.rows,
        profit: calculation.profit,
        roi: calculation.roi
      });
    }

    await rebuildLearningStatsFromTrustedTrades();

    const result = {
      scanned: trades.length,
      updated,
      skipped
    };

    this.logger.info("Official Gamma reprocess finished.", result);
    return result;
  }

  private async resolveGammaWinner(slug: string | null): Promise<OfficialGammaWinner | null> {
    if (!slug) {
      return null;
    }

    const market = await this.polymarketClient.getMarketBySlug(slug);
    if (!market) {
      return null;
    }

    return inferGammaWinnerFromOutcomePrices(market);
  }
}

export async function rebuildLearningStatsFromTrustedTrades(): Promise<void> {
  const trades = await prisma.simulatedTrade.findMany({
    where: {
      status: "RESOLVED",
      isWin: {
        not: null
      },
      OR: TRUSTED_RESULT_SOURCES.map((source) => ({
        result: {
          contains: source
        }
      }))
    },
    include: {
      prediction: true
    }
  });

  await prisma.$transaction(async (tx) => {
    await tx.learningStat.deleteMany({});

    const groups = new Map<string, {
      strategyName: string;
      marketType: string;
      assetSymbol: string;
      predictedOutcome: string;
      totalPredictions: number;
      wins: number;
      losses: number;
      totalProfit: number;
      totalRoi: number;
      maxDrawdown: number;
    }>();

    for (const trade of trades) {
      const key = [
        trade.prediction.strategyName,
        trade.prediction.marketType,
        trade.prediction.assetSymbol,
        trade.prediction.predictedOutcome
      ].join("|");
      const existing = groups.get(key) ?? {
        strategyName: trade.prediction.strategyName,
        marketType: trade.prediction.marketType,
        assetSymbol: trade.prediction.assetSymbol,
        predictedOutcome: trade.prediction.predictedOutcome,
        totalPredictions: 0,
        wins: 0,
        losses: 0,
        totalProfit: 0,
        totalRoi: 0,
        maxDrawdown: 0
      };

      existing.totalPredictions += 1;
      existing.wins += trade.isWin ? 1 : 0;
      existing.losses += trade.isWin ? 0 : 1;
      existing.totalProfit += Number(trade.profit ?? 0);
      existing.totalRoi += Number(trade.roi ?? 0);
      existing.maxDrawdown = Math.min(existing.maxDrawdown, existing.totalProfit);
      groups.set(key, existing);
    }

    for (const stat of groups.values()) {
      await tx.learningStat.create({
        data: {
          strategyName: stat.strategyName,
          marketType: stat.marketType,
          assetSymbol: stat.assetSymbol,
          predictedOutcome: stat.predictedOutcome,
          totalPredictions: stat.totalPredictions,
          wins: stat.wins,
          losses: stat.losses,
          winRate: toDecimal(stat.wins / stat.totalPredictions),
          totalProfit: toDecimal(stat.totalProfit),
          averageRoi: toDecimal(stat.totalRoi / stat.totalPredictions),
          maxDrawdown: toDecimal(stat.maxDrawdown)
        }
      });
    }
  });
}

function inferGammaWinnerFromOutcomePrices(market: PolymarketMarket): OfficialGammaWinner | null {
  const raw = getRawRecord(market);
  const outcomes = parseMaybeJson(raw.outcomes);
  const outcomePrices = parseMaybeJson(raw.outcomePrices);

  if (!Array.isArray(outcomes) || !Array.isArray(outcomePrices) || outcomes.length !== outcomePrices.length) {
    return null;
  }

  const rows = outcomes.flatMap((outcome, index) => {
    const normalizedName = normalizeOutcome(String(outcome));
    const price = Number(outcomePrices[index]);

    if (normalizedName === "OTHER" || !Number.isFinite(price)) {
      return [];
    }

    return [{
      name: String(outcome),
      normalizedName,
      price
    }];
  });
  const winner = rows.find((row) => row.price >= 0.98);

  if (!winner || !["UP", "DOWN", "YES", "NO"].includes(winner.normalizedName)) {
    return null;
  }

  return {
    winner: winner.normalizedName as OfficialGammaWinner["winner"],
    rows
  };
}

function normalizeOutcome(value: string): string {
  const normalized = value.trim().toUpperCase();

  if (["UP", "ABOVE", "OVER", "YES", "TRUE"].includes(normalized)) {
    return normalized === "YES" || normalized === "TRUE" ? "YES" : "UP";
  }

  if (["DOWN", "BELOW", "UNDER", "NO", "FALSE"].includes(normalized)) {
    return normalized === "NO" || normalized === "FALSE" ? "NO" : "DOWN";
  }

  return "OTHER";
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

function getRawRecord(market: PolymarketMarket): Record<string, unknown> {
  return market.raw && typeof market.raw === "object" ? (market.raw as Record<string, unknown>) : {};
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(round6(value));
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
