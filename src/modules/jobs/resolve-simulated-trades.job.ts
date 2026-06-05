import { Prisma } from "@prisma/client";
import { CryptoAsset, SUPPORTED_CRYPTO_ASSETS } from "../../config/assets";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { PolymarketMarket } from "../polymarket/polymarket.types";
import { CryptoPriceService } from "../market-data/crypto-price.service";
import { OfficialTargetResolverService } from "../market-data/official-target-resolver.service";
import { SimulationService } from "../simulations/simulation.service";

interface ResolvedOutcome {
  name: string;
  normalizedName: string;
  source:
    | "POLYMARKET_EXPLICIT"
    | "GAMMA_OUTCOME_PRICES"
    | "CLOB_FINAL_PRICE"
    | "POLYMARKET_RTDS_CHAINLINK_CLOSE"
    | "LOCAL_SPOT_TARGET_FALLBACK";
  details?: Record<string, unknown>;
  trustedForLearning: boolean;
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
const OFFICIAL_RESOLUTION_DELAY_MS = 60 * 1000;
const UNRESOLVED_WARNING_INTERVAL_MS = 5 * 60 * 1000;
const LOCAL_UP_DOWN_FALLBACK_DELAY_MS = 30 * 1000;
const FINAL_PRICE_WIN_THRESHOLD = 0.98;
const FINAL_PRICE_LOSS_THRESHOLD = 0.02;

export class ResolveSimulatedTradesJob {
  private readonly lastUnresolvedWarningByTrade = new Map<string, number>();

  constructor(
    private readonly logger: LoggerService,
    private readonly polymarketClient = new PolymarketClient(),
    private readonly simulationService = new SimulationService(),
    private readonly cryptoPriceService = new CryptoPriceService(logger),
    private readonly officialTargetResolverService = new OfficialTargetResolverService(logger)
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

    if (this.shouldDelayResolutionAttempt(trade)) {
      this.logger.debug("Skipping simulated trade resolution until official result delay has passed.", {
        tradeId: trade.id,
        slug,
        marketEndDate: trade.market.endDate?.toISOString() ?? null,
        waitUntil: trade.market.endDate
          ? new Date(trade.market.endDate.getTime() + OFFICIAL_RESOLUTION_DELAY_MS).toISOString()
          : null
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

    const winningOutcome = await this.resolveWinningOutcome(trade, market);
    if (!winningOutcome) {
      this.logUnresolvedTradeWarning(trade, {
        tradeId: trade.id,
        slug,
        closed: market.closed,
        active: market.active
      });
      return;
    }

    const didWin = normalizeOutcome(trade.prediction.predictedOutcome) === winningOutcome.normalizedName;
    const calculation = this.simulationService.calculateTradeResult({
      stake: Number(trade.stake),
      entryPrice: Number(trade.entryPrice),
      didWin
    });
    const result = `${winningOutcome.normalizedName}:${winningOutcome.source}`;

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

      if (winningOutcome.trustedForLearning) {
        await this.updateLearningStat(tx, {
          strategyName: trade.prediction.strategyName,
          marketType: trade.prediction.marketType,
          assetSymbol: trade.prediction.assetSymbol,
          predictedOutcome: trade.prediction.predictedOutcome,
          didWin,
          profit: calculation.profit,
          roi: calculation.roi
        });
      }
    });

    this.logger.info("Simulated trade resolved.", {
      market: trade.market.question,
      asset: trade.prediction.assetSymbol,
      prediction: trade.prediction.predictedOutcome,
      entryPrice: Number(trade.entryPrice),
      stake: Number(trade.stake),
      result: winningOutcome.normalizedName,
      resolutionSource: winningOutcome.source,
      trustedForLearning: winningOutcome.trustedForLearning,
      resolutionDetails: winningOutcome.details,
      profit: calculation.profit,
      roi: calculation.roi
    });
  }

  private shouldDelayResolutionAttempt(trade: Awaited<ReturnType<typeof this.loadTradeShape>>): boolean {
    if (!trade.market.endDate) {
      return false;
    }

    return Date.now() < trade.market.endDate.getTime() + OFFICIAL_RESOLUTION_DELAY_MS;
  }

  private logUnresolvedTradeWarning(
    trade: Awaited<ReturnType<typeof this.loadTradeShape>>,
    context: Record<string, unknown>
  ): void {
    const lastWarnedAt = this.lastUnresolvedWarningByTrade.get(trade.id) ?? 0;
    const now = Date.now();

    if (now - lastWarnedAt < UNRESOLVED_WARNING_INTERVAL_MS) {
      this.logger.debug("Could not determine winning outcome yet; simulated trade remains pending.", context);
      return;
    }

    this.lastUnresolvedWarningByTrade.set(trade.id, now);
    this.logger.warn("Could not determine winning outcome. Simulated trade remains pending.", context);
  }

  private async resolveWinningOutcome(
    trade: Awaited<ReturnType<typeof this.loadTradeShape>>,
    market: PolymarketMarket
  ): Promise<ResolvedOutcome | null> {
    const explicitOutcome = inferWinningOutcome(market);
    if (explicitOutcome) {
      return explicitOutcome;
    }

    const gammaOutcome = inferGammaWinnerFromOutcomePrices(market);
    if (gammaOutcome) {
      return gammaOutcome;
    }

    const closed = isClosedOrInactive(market);
    if (!closed) {
      return null;
    }

    if (trade.market.marketType === "UP_DOWN_SHORT_TERM") {
      const chainlinkOutcome = await this.inferUpDownWinnerFromChainlinkClose(trade);
      if (chainlinkOutcome) {
        return chainlinkOutcome;
      }
    }

    const finalPriceOutcome = await this.inferWinnerFromFinalOutcomePrices(trade);
    if (finalPriceOutcome) {
      return finalPriceOutcome;
    }

    if (trade.market.marketType === "UP_DOWN_SHORT_TERM") {
      return this.inferUpDownWinnerFromLocalSpot(trade);
    }

    return null;
  }

  private async inferWinnerFromFinalOutcomePrices(
    trade: Awaited<ReturnType<typeof this.loadTradeShape>>
  ): Promise<ResolvedOutcome | null> {
    const outcomes = await prisma.marketOutcome.findMany({
      where: {
        marketId: trade.marketId,
        externalTokenId: {
          not: null
        }
      }
    });

    for (const outcome of outcomes) {
      if (!outcome.externalTokenId) {
        continue;
      }

      const price = await this.polymarketClient.getPrice(outcome.externalTokenId, "BUY");
      if (price.price === null) {
        continue;
      }

      const normalizedName = normalizeOutcome(outcome.normalizedName || outcome.name);
      if (price.price >= FINAL_PRICE_WIN_THRESHOLD && normalizedName !== "OTHER") {
        return {
          name: outcome.name,
          normalizedName,
          source: "CLOB_FINAL_PRICE",
          trustedForLearning: true,
          details: {
            tokenId: outcome.externalTokenId,
            finalBuyPrice: price.price
          }
        };
      }
    }

    const predictedOutcome = normalizeOutcome(trade.prediction.predictedOutcome);
    const predictedOutcomeRecord = outcomes.find(
      (outcome) => normalizeOutcome(outcome.normalizedName || outcome.name) === predictedOutcome
    );

    if (!predictedOutcomeRecord?.externalTokenId) {
      return null;
    }

    const predictedPrice = await this.polymarketClient.getPrice(predictedOutcomeRecord.externalTokenId, "BUY");
    if (predictedPrice.price !== null && predictedPrice.price <= FINAL_PRICE_LOSS_THRESHOLD) {
      const opposite = getOppositeOutcome(predictedOutcome);
      if (opposite) {
        return {
          name: opposite,
          normalizedName: opposite,
          source: "CLOB_FINAL_PRICE",
          trustedForLearning: true,
          details: {
            tokenId: predictedOutcomeRecord.externalTokenId,
            predictedOutcomeFinalBuyPrice: predictedPrice.price
          }
        };
      }
    }

    return null;
  }

  private async inferUpDownWinnerFromChainlinkClose(
    trade: Awaited<ReturnType<typeof this.loadTradeShape>>
  ): Promise<ResolvedOutcome | null> {
    if (trade.market.marketType !== "UP_DOWN_SHORT_TERM") {
      return null;
    }

    if (!trade.market.endDate || Date.now() < trade.market.endDate.getTime() + LOCAL_UP_DOWN_FALLBACK_DELAY_MS) {
      return null;
    }

    const target = await this.findTrustedTargetPrice(trade.marketId);
    if (!target) {
      return null;
    }

    const closePrice = await this.officialTargetResolverService.resolveChainlinkPriceAt(
      trade.prediction.assetSymbol,
      trade.market.endDate,
      15_000
    );

    if (closePrice.price === null || !closePrice.trustedForLearning) {
      return null;
    }

    if (closePrice.price === target.targetPrice) {
      return null;
    }

    const normalizedName = closePrice.price > target.targetPrice ? "UP" : "DOWN";
    return {
      name: normalizedName,
      normalizedName,
      source: "POLYMARKET_RTDS_CHAINLINK_CLOSE",
      trustedForLearning: true,
      details: {
        targetPrice: target.targetPrice,
        targetPriceSource: target.targetPriceSource,
        closePrice: closePrice.price,
        closePriceSource: closePrice.source,
        closeEvidence: closePrice.rawEvidence,
        rule: "UP wins when Chainlink close price is greater than target; otherwise DOWN."
      }
    };
  }

  private async inferUpDownWinnerFromLocalSpot(
    trade: Awaited<ReturnType<typeof this.loadTradeShape>>
  ): Promise<ResolvedOutcome | null> {
    if (trade.market.marketType !== "UP_DOWN_SHORT_TERM") {
      return null;
    }

    if (!trade.market.endDate || Date.now() < trade.market.endDate.getTime() + LOCAL_UP_DOWN_FALLBACK_DELAY_MS) {
      return null;
    }

    const targetPrice = await this.findTargetPrice(trade.marketId);
    if (targetPrice === null) {
      return null;
    }

    const closeSnapshot = await prisma.marketSnapshot.findFirst({
      where: {
        marketId: trade.marketId,
        currentAssetPrice: {
          not: null
        },
        createdAt: {
          gte: new Date(trade.market.endDate.getTime() - 60 * 1000)
        }
      },
      select: {
        currentAssetPrice: true,
        createdAt: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    const assetSymbol = toCryptoAsset(trade.prediction.assetSymbol);
    const spotPrice = closeSnapshot || !assetSymbol ? null : await this.cryptoPriceService.getSpotPriceUsd(assetSymbol);
    const resolutionPrice = closeSnapshot?.currentAssetPrice
      ? Number(closeSnapshot.currentAssetPrice)
      : spotPrice?.priceUsd ?? null;

    if (resolutionPrice === null || !Number.isFinite(resolutionPrice)) {
      return null;
    }

    if (resolutionPrice === targetPrice) {
      return null;
    }

    const normalizedName = resolutionPrice > targetPrice ? "UP" : "DOWN";
    return {
      name: normalizedName,
      normalizedName,
      source: "LOCAL_SPOT_TARGET_FALLBACK",
      trustedForLearning: false,
      details: {
        targetPrice,
        targetPriceSource: await this.findTargetPriceSource(trade.marketId),
        resolutionPrice,
        priceSource: closeSnapshot ? "LAST_LOCAL_SNAPSHOT_NEAR_CLOSE" : spotPrice?.source,
        priceTimestamp: closeSnapshot?.createdAt.toISOString() ?? spotPrice?.fetchedAt.toISOString() ?? null,
        note: "Local fallback is an approximation when Polymarket does not expose a clear winner."
      }
    };
  }

  private async findTargetPrice(marketId: string): Promise<number | null> {
    const snapshot = await prisma.marketSnapshot.findFirst({
      where: {
        marketId,
        targetPrice: {
          not: null
        }
      },
      select: {
        targetPrice: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (!snapshot?.targetPrice) {
      return null;
    }

    const targetPrice = Number(snapshot.targetPrice);
    return Number.isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null;
  }

  private async findTargetPriceSource(marketId: string): Promise<string | null> {
    const snapshot = await prisma.marketSnapshot.findFirst({
      where: {
        marketId,
        targetPrice: {
          not: null
        }
      },
      select: {
        rawData: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (!snapshot?.rawData) {
      return null;
    }

    const parsed = parseMaybeJson(snapshot.rawData);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const source = (parsed as Record<string, unknown>).targetPriceSource;
    return typeof source === "string" ? source : null;
  }

  private async findTrustedTargetPrice(marketId: string): Promise<{
    targetPrice: number;
    targetPriceSource: string | null;
  } | null> {
    const snapshot = await prisma.marketSnapshot.findFirst({
      where: {
        marketId,
        targetPrice: {
          not: null
        }
      },
      select: {
        targetPrice: true,
        rawData: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (!snapshot?.targetPrice) {
      return null;
    }

    const raw = parseSnapshotRawData(snapshot.rawData);
    if (raw.targetPriceTrustedForLearning !== true) {
      return null;
    }

    const targetPrice = Number(snapshot.targetPrice);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      return null;
    }

    return {
      targetPrice,
      targetPriceSource: typeof raw.targetPriceSource === "string" ? raw.targetPriceSource : null
    };
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

function isClosedOrInactive(market: PolymarketMarket): boolean {
  const raw = getRawRecord(market);
  return (
    market.closed === true ||
    getBoolean(raw, "closed") === true ||
    market.active === false ||
    getBoolean(raw, "active") === false
  );
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
        normalizedName: normalized,
        source: "POLYMARKET_EXPLICIT",
        trustedForLearning: true
      };
    }
  }

  const outcomes = parseOutcomeObjects(raw.outcomes);
  const winningOutcome = outcomes.find((outcome) => outcome.isWinner || outcome.winner || outcome.resolved);
  if (winningOutcome?.name) {
    return {
      name: winningOutcome.name,
      normalizedName: normalizeOutcome(winningOutcome.name),
      source: "POLYMARKET_EXPLICIT",
      trustedForLearning: true
    };
  }

  return null;
}

function inferGammaWinnerFromOutcomePrices(market: PolymarketMarket): ResolvedOutcome | null {
  const raw = getRawRecord(market);
  const umaResolutionStatus = getString(raw, "umaResolutionStatus")?.toLowerCase();
  const closed = market.closed === true || getBoolean(raw, "closed") === true;
  const outcomes = parseMaybeJson(raw.outcomes);
  const outcomePrices = parseMaybeJson(raw.outcomePrices);

  if (
    umaResolutionStatus !== "resolved" &&
    !closed
  ) {
    return null;
  }

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

  if (!winner) {
    return null;
  }

  return {
    name: winner.name,
    normalizedName: winner.normalizedName,
    source: "GAMMA_OUTCOME_PRICES",
    trustedForLearning: true,
    details: {
      outcomePrices: rows
    }
  };
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

function getOppositeOutcome(value: string): "UP" | "DOWN" | "YES" | "NO" | null {
  if (value === "UP") {
    return "DOWN";
  }

  if (value === "DOWN") {
    return "UP";
  }

  if (value === "YES") {
    return "NO";
  }

  if (value === "NO") {
    return "YES";
  }

  return null;
}

function toCryptoAsset(value: string): CryptoAsset | null {
  return SUPPORTED_CRYPTO_ASSETS.includes(value as CryptoAsset) ? (value as CryptoAsset) : null;
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

function parseSnapshotRawData(value: string | null): Record<string, unknown> {
  const parsed = parseMaybeJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
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
