import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { PolymarketMarket } from "../polymarket/polymarket.types";
import { SimulationService } from "../simulations/simulation.service";

interface ResolvedOutcome {
  name: string;
  normalizedName: string;
}

interface LearningStatUpdateInput {
  strategyName: string;
  marketType: string;
  assetSymbol: string;
  predictedOutcome: string;
  didWin: boolean;
  profit: number;
  roi: number;
}

const PENDING_LIMIT = 50;

export class ResolveSimulatedTradesJob {
  constructor(
    private readonly logger: LoggerService,
    private readonly polymarketClient = new PolymarketClient(),
    private readonly simulationService = new SimulationService()
  ) {}

  async runOnce(): Promise<void> {
    const pendingTrades = await prisma.simulatedTrade.findMany({
      where: {
        status: "PENDING"
      },
      include: {
        prediction: true,
        market: true
      },
      orderBy: {
        createdAt: "asc"
      },
      take: PENDING_LIMIT
    });

    if (pendingTrades.length === 0) {
      this.logger.info("No pending simulated trades to resolve.");
      return;
    }

    this.logger.info("Resolving pending simulated trades.", { count: pendingTrades.length });

    for (const trade of pendingTrades) {
      try {
        await this.resolveTrade(trade);
      } catch (error) {
        this.logger.error("Failed to resolve simulated trade.", error, {
          tradeId: trade.id,
          marketId: trade.marketId,
          predictionId: trade.predictionId
        });
      }
    }
  }

  private async resolveTrade(trade: Awaited<ReturnType<typeof this.loadTradeShape>>): Promise<void> {
    const slug = trade.market.slug;
    if (!slug) {
      this.logger.warn("Cannot resolve simulated trade because market slug is missing.", {
        tradeId: trade.id,
        marketId: trade.marketId
      });
      return;
    }

    if (slug.startsWith("mock-") || trade.market.resolutionSource === "MOCK_LOCAL_SCANNER") {
      await prisma.simulatedTrade.update({
        where: {
          id: trade.id
        },
        data: {
          status: "CANCELLED",
          result: "MOCK_MARKET_NOT_RESOLVABLE",
          resolvedAt: new Date()
        }
      });
      this.logger.info("Cancelled pending mock simulated trade.", {
        tradeId: trade.id,
        slug
      });
      return;
    }

    const market = await this.polymarketClient.getMarketBySlug(slug);
    if (!market) {
      this.logger.warn("Cannot resolve simulated trade because Polymarket market was not found.", {
        tradeId: trade.id,
        slug
      });
      return;
    }

    if (!isClearlyResolved(market)) {
      this.logger.warn("Market is not clearly resolved yet. Simulated trade remains pending.", {
        tradeId: trade.id,
        slug,
        closed: market.closed,
        active: market.active
      });
      return;
    }

    const winningOutcome = inferWinningOutcome(market);
    if (!winningOutcome) {
      this.logger.warn("Could not determine winning outcome. Simulated trade remains pending.", {
        tradeId: trade.id,
        slug
      });
      return;
    }

    const didWin = normalizeOutcome(trade.prediction.predictedOutcome) === winningOutcome.normalizedName;
    const calculation = this.simulationService.calculateTradeResult({
      stake: Number(trade.stake),
      entryPrice: Number(trade.entryPrice),
      didWin
    });
    const result = winningOutcome.normalizedName;

    await prisma.$transaction(async (tx) => {
      await tx.simulatedTrade.update({
        where: {
          id: trade.id
        },
        data: {
          status: "RESOLVED",
          result,
          isWin: calculation.isWin,
          finalValue: toDecimal(calculation.finalValue),
          profit: toDecimal(calculation.profit),
          roi: toDecimal(calculation.roi),
          resolvedAt: new Date()
        }
      });

      await this.updateLearningStat(tx, {
        strategyName: trade.prediction.strategyName,
        marketType: trade.prediction.marketType,
        assetSymbol: trade.prediction.assetSymbol,
        predictedOutcome: trade.prediction.predictedOutcome,
        didWin,
        profit: calculation.profit,
        roi: calculation.roi
      });
    });

    this.logger.info("Simulated trade resolved.", {
      market: trade.market.question,
      asset: trade.prediction.assetSymbol,
      prediction: trade.prediction.predictedOutcome,
      entryPrice: Number(trade.entryPrice),
      stake: Number(trade.stake),
      result,
      profit: calculation.profit,
      roi: calculation.roi
    });
  }

  private loadTradeShape() {
    return prisma.simulatedTrade.findFirstOrThrow({
      include: {
        prediction: true,
        market: true
      }
    });
  }

  private async updateLearningStat(
    tx: Prisma.TransactionClient,
    input: LearningStatUpdateInput
  ): Promise<void> {
    const existing = await tx.learningStat.findUnique({
      where: {
        strategyName_marketType_assetSymbol_predictedOutcome: {
          strategyName: input.strategyName,
          marketType: input.marketType,
          assetSymbol: input.assetSymbol,
          predictedOutcome: input.predictedOutcome
        }
      }
    });

    const totalPredictions = (existing?.totalPredictions ?? 0) + 1;
    const wins = (existing?.wins ?? 0) + (input.didWin ? 1 : 0);
    const losses = (existing?.losses ?? 0) + (input.didWin ? 0 : 1);
    const totalProfit = Number(existing?.totalProfit ?? 0) + input.profit;
    const totalRoi = Number(existing?.averageRoi ?? 0) * (existing?.totalPredictions ?? 0) + input.roi;
    const averageRoi = totalRoi / totalPredictions;
    const winRate = wins / totalPredictions;
    const maxDrawdown = Math.min(Number(existing?.maxDrawdown ?? 0), totalProfit);

    await tx.learningStat.upsert({
      where: {
        strategyName_marketType_assetSymbol_predictedOutcome: {
          strategyName: input.strategyName,
          marketType: input.marketType,
          assetSymbol: input.assetSymbol,
          predictedOutcome: input.predictedOutcome
        }
      },
      update: {
        totalPredictions,
        wins,
        losses,
        winRate: toDecimal(winRate),
        totalProfit: toDecimal(totalProfit),
        averageRoi: toDecimal(averageRoi),
        maxDrawdown: toDecimal(maxDrawdown)
      },
      create: {
        strategyName: input.strategyName,
        marketType: input.marketType,
        assetSymbol: input.assetSymbol,
        predictedOutcome: input.predictedOutcome,
        totalPredictions,
        wins,
        losses,
        winRate: toDecimal(winRate),
        totalProfit: toDecimal(totalProfit),
        averageRoi: toDecimal(averageRoi),
        maxDrawdown: toDecimal(maxDrawdown)
      }
    });
  }
}

function isClearlyResolved(market: PolymarketMarket): boolean {
  const raw = getRawRecord(market);
  const closed = market.closed === true || getBoolean(raw, "closed") === true;
  const active = market.active === false || getBoolean(raw, "active") === false;
  const hasResolution = inferWinningOutcome(market) !== null;

  return (closed || active) && hasResolution;
}

function inferWinningOutcome(market: PolymarketMarket): ResolvedOutcome | null {
  const raw = getRawRecord(market);
  const candidates = [
    getString(raw, "resolution"),
    getString(raw, "resolvedOutcome"),
    getString(raw, "winningOutcome"),
    getString(raw, "winner"),
    getString(raw, "outcome")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const normalized = normalizeOutcome(candidate);
    if (normalized !== "OTHER") {
      return {
        name: candidate,
        normalizedName: normalized
      };
    }
  }

  const outcomes = parseOutcomeObjects(raw.outcomes);
  const winningOutcome = outcomes.find((outcome) => outcome.isWinner || outcome.winner || outcome.resolved);
  if (winningOutcome?.name) {
    return {
      name: winningOutcome.name,
      normalizedName: normalizeOutcome(winningOutcome.name)
    };
  }

  return null;
}

function parseOutcomeObjects(value: unknown): Array<Record<string, unknown> & { name?: string; isWinner?: boolean; winner?: boolean; resolved?: boolean }> {
  const parsed = parseMaybeJson(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const name = record.name ?? record.outcome ?? record.title;

    return [{
      ...record,
      name: typeof name === "string" ? name : undefined,
      isWinner: record.isWinner === true,
      winner: record.winner === true,
      resolved: record.resolved === true
    }];
  });
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

function getRawRecord(market: PolymarketMarket): Record<string, unknown> {
  return market.raw && typeof market.raw === "object" ? (market.raw as Record<string, unknown>) : {};
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

function getString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] : undefined;
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(round6(value));
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
