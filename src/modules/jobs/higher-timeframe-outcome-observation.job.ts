import { Prisma } from "@prisma/client";
import { CryptoAsset } from "../../config/assets";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { NormalizedCryptoMarket } from "../crypto/crypto-market.types";
import { CryptoPriceService } from "../market-data/crypto-price.service";
import { OfficialTargetResolverService } from "../market-data/official-target-resolver.service";
import { LoggerService } from "../logger/logger.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { PolymarketService } from "../polymarket/polymarket.service";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import { MlOutcomeShadowExecutionService } from "../simulations/ml-outcome-shadow-execution.service";
import { ObservationEvaluationService } from "../simulations/observation-evaluation.service";

export const HIGHER_TIMEFRAME_OUTCOME_STRATEGY =
  "HIGHER_TIMEFRAME_OUTCOME_CHECKPOINT_V1";
export const HIGHER_TIMEFRAME_HEURISTIC_VERSION =
  "HTF_DIRECTION_HEURISTIC_V1";

export const HIGHER_TIMEFRAME_CHECKPOINTS = {
  "1h": [12 * 60, 8 * 60, 4 * 60, 2 * 60],
  "4h": [48 * 60, 32 * 60, 16 * 60, 8 * 60]
} as const;

const CHECKPOINT_MAX_LATENESS_SECONDS = 45;
const DISCOVERY_CACHE_MS = 15 * 60_000;
const TARGET_CAPTURE_RETRY_WINDOW_MS = 3 * 60_000;

type HigherTimeframe = keyof typeof HIGHER_TIMEFRAME_CHECKPOINTS;

interface CachedDiscovery {
  expiresAt: number;
  markets: NormalizedCryptoMarket[];
}

export class HigherTimeframeOutcomeObservationJob {
  private readonly client = new PolymarketClient();
  private readonly polymarketService: PolymarketService;
  private readonly cryptoPriceService: CryptoPriceService;
  private readonly targetResolver: OfficialTargetResolverService;
  private readonly observationService = new ObservationEvaluationService();
  private readonly shadowExecutionService: MlOutcomeShadowExecutionService;
  private discoveryCache: CachedDiscovery | null = null;

  constructor(private readonly logger: LoggerService) {
    this.polymarketService = new PolymarketService(this.client, logger);
    this.cryptoPriceService = new CryptoPriceService(logger);
    this.targetResolver = new OfficialTargetResolverService(logger);
    this.shadowExecutionService = new MlOutcomeShadowExecutionService(logger);
  }

  async runOnce(): Promise<void> {
    if (!config.enableHigherTimeframeOutcomeObservation && !config.enableHtfRealTrading) {
      return;
    }

    const markets = await this.discoverMarkets();
    if (markets.length === 0) {
      return;
    }

    for (const market of markets) {
      try {
        const savedMarket = await this.upsertMarket(market);
        await this.ensureTargetSnapshot(savedMarket.id, market);
        await this.captureDueCheckpoint(savedMarket.id, market);
      } catch (error) {
        this.logger.error(
          "Higher-timeframe outcome observation failed for one market.",
          error,
          { slug: market.slug, timeframe: market.timeframe }
        );
      }
    }
  }

  private async discoverMarkets(): Promise<NormalizedCryptoMarket[]> {
    if (this.discoveryCache && this.discoveryCache.expiresAt > Date.now()) {
      return this.discoveryCache.markets;
    }

    const [oneHour, fourHour] = await Promise.all([
      this.polymarketService.getFastCryptoUpDown1hMarkets(),
      this.polymarketService.getFastCryptoUpDown4hMarkets()
    ]);
    const markets = [...oneHour, ...fourHour];
    this.discoveryCache = {
      expiresAt: Date.now() + DISCOVERY_CACHE_MS,
      markets
    };

    this.logger.info("Higher-timeframe crypto markets discovered.", {
      oneHour: oneHour.length,
      fourHour: fourHour.length,
      total: markets.length,
      mode: config.enableHtfRealTrading ? "REAL_TRADING" : "OBSERVATION_ONLY"
    });
    return markets;
  }

  private async upsertMarket(market: NormalizedCryptoMarket) {
    const externalMarketId =
      market.externalMarketId ?? `slug:${market.slug ?? market.question}`;
    const saved = await prisma.market.upsert({
      where: { externalMarketId },
      update: {
        slug: market.slug,
        question: market.question,
        assetSymbol: market.assetSymbol,
        baseAsset: market.baseAsset,
        quoteAsset: market.quoteAsset,
        marketType: market.marketType,
        timeframe: market.timeframe,
        active: market.active,
        closed: market.closed,
        endDate: market.endDate,
        resolutionSource: market.resolutionSource,
        rawData: market.rawData
      },
      create: {
        externalMarketId,
        slug: market.slug,
        question: market.question,
        category: "CRYPTO",
        assetSymbol: market.assetSymbol,
        baseAsset: market.baseAsset,
        quoteAsset: market.quoteAsset,
        marketType: market.marketType,
        timeframe: market.timeframe,
        active: market.active,
        closed: market.closed,
        startDate: inferWindowStart(market),
        endDate: market.endDate,
        resolutionSource: market.resolutionSource,
        rawData: market.rawData
      },
      include: { outcomes: true }
    });

    const desiredTokens = market.outcomes
      .map((outcome) => outcome.externalTokenId)
      .filter((token): token is string => Boolean(token))
      .sort();
    const existingTokens = saved.outcomes
      .map((outcome) => outcome.externalTokenId)
      .filter((token): token is string => Boolean(token))
      .sort();
    if (JSON.stringify(desiredTokens) !== JSON.stringify(existingTokens)) {
      await prisma.marketOutcome.deleteMany({ where: { marketId: saved.id } });
      await prisma.marketOutcome.createMany({
        data: market.outcomes.map((outcome) => ({
          marketId: saved.id,
          externalTokenId: outcome.externalTokenId,
          name: outcome.name,
          normalizedName: outcome.normalizedName,
          currentPrice: optionalDecimal(outcome.currentPrice)
        }))
      });
    }

    return saved;
  }

  private async ensureTargetSnapshot(
    marketId: string,
    market: NormalizedCryptoMarket
  ): Promise<void> {
    const existing = await this.loadTrustedTarget(marketId);
    if (existing) {
      return;
    }

    const windowStart = inferWindowStart(market);
    const targetCaptureDeadline = market.timeframe === "1h" && market.endDate
      ? market.endDate.getTime()
      : (windowStart?.getTime() ?? 0) + TARGET_CAPTURE_RETRY_WINDOW_MS;
    if (
      !windowStart ||
      Date.now() < windowStart.getTime() ||
      Date.now() > targetCaptureDeadline
    ) {
      return;
    }

    const target = market.timeframe === "1h"
      ? await resolveBinanceHourlyOpen(market)
      : await this.targetResolver.resolveOfficialTarget(market);
    if (target.targetPrice === null || !target.trustedForLearning) {
      this.logger.info("Higher-timeframe target not captured yet.", {
        slug: market.slug,
        timeframe: market.timeframe,
        reason: target.reason
      });
      return;
    }

    await prisma.marketSnapshot.create({
      data: {
        marketId,
        targetPrice: decimal(target.targetPrice),
        secondsToClose: market.endDate
          ? Math.max(
              0,
              Math.floor((market.endDate.getTime() - Date.now()) / 1_000)
            )
          : null,
        rawData: JSON.stringify({
          observationType: "HIGHER_TIMEFRAME_TARGET_CAPTURE",
          targetPriceSource: target.source,
          targetPriceTrustedForLearning: true,
          capturedAt: target.fetchedAt.toISOString(),
          rawEvidence: target.rawEvidence ?? null
        })
      }
    });
    this.logger.info("Higher-timeframe official target captured.", {
      slug: market.slug,
      assetSymbol: market.assetSymbol,
      timeframe: market.timeframe,
      targetPrice: target.targetPrice,
      source: target.source
    });
  }

  private async captureDueCheckpoint(
    marketId: string,
    market: NormalizedCryptoMarket
  ): Promise<void> {
    if (
      (market.timeframe !== "1h" && market.timeframe !== "4h") ||
      !market.endDate ||
      market.endDate.getTime() <= Date.now()
    ) {
      return;
    }

    const secondsToClose = Math.max(
      0,
      Math.floor((market.endDate.getTime() - Date.now()) / 1_000)
    );
    const checkpointSeconds = getDueHigherTimeframeCheckpoint(
      market.timeframe,
      secondsToClose
    );
    if (checkpointSeconds === null) {
      return;
    }

    const duplicate = await prisma.mlOutcomeShadowExecution.findUnique({
      where: { marketId_checkpointSeconds: { marketId, checkpointSeconds } },
      select: { id: true }
    });
    if (duplicate) {
      return;
    }

    const target = await this.loadTrustedTarget(marketId);
    const assetSymbol = toSupportedAsset(market.assetSymbol);
    if (!target || !assetSymbol) {
      this.logger.info("Higher-timeframe checkpoint skipped without trusted target.", {
        slug: market.slug,
        timeframe: market.timeframe,
        checkpointSeconds
      });
      return;
    }

    const spot = market.timeframe === "1h"
      ? await resolveBinanceCurrentPrice(assetSymbol)
      : await this.cryptoPriceService.getSpotPriceUsd(assetSymbol);
    if (spot.priceUsd === null || spot.priceUsd <= 0) {
      return;
    }

    const upOutcome = market.outcomes.find((outcome) =>
      ["UP", "YES"].includes(outcome.normalizedName)
    );
    const downOutcome = market.outcomes.find((outcome) =>
      ["DOWN", "NO"].includes(outcome.normalizedName)
    );
    if (!upOutcome?.externalTokenId || !downOutcome?.externalTokenId) {
      return;
    }

    const [upBook, downBook] = await Promise.all([
      this.client.getOrderBook(upOutcome.externalTokenId),
      this.client.getOrderBook(downOutcome.externalTokenId)
    ]);
    const upAsk = bestAsk(upBook);
    const downAsk = bestAsk(downBook);
    if (upAsk === null || downAsk === null) {
      return;
    }

    const predictedOutcome = spot.priceUsd >= target.price ? "UP" : "DOWN";
    const selectedTokenId =
      predictedOutcome === "UP"
        ? upOutcome.externalTokenId
        : downOutcome.externalTokenId;
    const selectedBook = predictedOutcome === "UP" ? upBook : downBook;
    const entryPrice = predictedOutcome === "UP" ? upAsk : downAsk;
    const distance = spot.priceUsd - target.price;
    const distancePercent = distance / target.price;
    const estimatedProbability = estimateHigherTimeframeProbability({
      distancePercent,
      secondsToClose,
      timeframe: market.timeframe
    });
    const impliedProbabilityUp = upAsk / (upAsk + downAsk);
    const probabilityForPrediction =
      predictedOutcome === "UP"
        ? estimatedProbability
        : 1 - estimatedProbability;
    const edge = probabilityForPrediction - entryPrice;
    const modelVersion =
      `${HIGHER_TIMEFRAME_HEURISTIC_VERSION}_${market.timeframe.toUpperCase()}`;

    const snapshot = await prisma.marketSnapshot.create({
      data: {
        marketId,
        upPrice: decimal(upAsk),
        downPrice: decimal(downAsk),
        targetPrice: decimal(target.price),
        currentAssetPrice: decimal(spot.priceUsd),
        distanceToTarget: decimal(distance),
        distanceToTargetPercent: decimal(distancePercent),
        secondsToClose,
        bid: optionalDecimal(bestBid(selectedBook)),
        ask: decimal(entryPrice),
        spread: optionalDecimal(bookSpread(selectedBook)),
        liquidity: optionalDecimal(bookDepthUsd(selectedBook)),
        rawOrderbook: JSON.stringify({
          selectedOutcome: predictedOutcome,
          selected: summarizeBook(selectedBook),
          up: summarizeBook(upBook),
          down: summarizeBook(downBook)
        }),
        rawData: JSON.stringify({
          observationType: "HIGHER_TIMEFRAME_OUTCOME_CHECKPOINT",
          checkpointSeconds,
          targetPriceSource: target.source,
          targetPriceTrustedForLearning: true,
          spotPriceSource: spot.source,
          heuristicVersion: modelVersion
        })
      }
    });

    const features = {
      strategyName: HIGHER_TIMEFRAME_OUTCOME_STRATEGY,
      observationType: "HIGHER_TIMEFRAME_OUTCOME_CHECKPOINT",
      assetSymbol: market.assetSymbol,
      timeframe: market.timeframe,
      checkpointSeconds,
      actualSecondsToClose: secondsToClose,
      targetPrice: target.price,
      targetPriceSource: target.source,
      targetPriceTrustedForLearning: true,
      currentAssetPrice: spot.priceUsd,
      currentAssetPriceSource: spot.source,
      distanceToTarget: distance,
      distanceToTargetPercent: distancePercent,
      upBestAsk: upAsk,
      downBestAsk: downAsk,
      upSpread: bookSpread(upBook),
      downSpread: bookSpread(downBook),
      upDepthUsd: bookDepthUsd(upBook),
      downDepthUsd: bookDepthUsd(downBook),
      impliedProbabilityUp,
      estimatedProbabilityUp: estimatedProbability,
      predictedOutcome,
      entryPrice,
      edge,
      modelVersion,
      mode: config.enableHtfRealTrading ? "REAL_TRADING" : "OBSERVATION_ONLY",
      realTradingAllowed: config.enableHtfRealTrading
    };
    const prediction = await prisma.botPrediction.create({
      data: {
        marketId,
        snapshotId: snapshot.id,
        strategyName: HIGHER_TIMEFRAME_OUTCOME_STRATEGY,
        assetSymbol: market.assetSymbol,
        marketType: market.marketType,
        predictedOutcome,
        entryPrice: decimal(entryPrice),
        impliedProbability: decimal(entryPrice),
        botProbability: decimal(probabilityForPrediction),
        edge: decimal(edge),
        confidence: decimal(probabilityForPrediction),
        recommendation: "WAIT",
        reason:
          `Observacion ${market.timeframe} en checkpoint ` +
          `${checkpointSeconds}s: ${predictedOutcome}.`,
        features: JSON.stringify(features),
        historicalSummary:
          "Heuristica inicial para recolectar etiquetas; modelo ML separado pendiente.",
        mlOutcomePrediction: predictedOutcome,
        mlProbabilityUp: decimal(estimatedProbability),
        mlProbabilityDown: decimal(1 - estimatedProbability),
        mlOutcomeEntryPrice: decimal(entryPrice),
        mlOutcomeModelVersion: modelVersion,
        mlOutcomeFeatures: JSON.stringify(features),
        mlOutcomeScoredAt: new Date()
      }
    });

    await this.observationService.createPendingObservation(
      prediction.id,
      marketId,
      `HTF_OUTCOME_${market.timeframe.toUpperCase()}_${checkpointSeconds}S`,
      config.enableHtfRealTrading ? config.htfRealStakeUsd : config.simulatedStakeUsd,
      entryPrice
    );

    // Calculate slippage for HTF (estimate based on spread)
    const spread = bookSpread(selectedBook) ?? 0;
    const slippage = spread / 2; // Approximate slippage as half of spread

    const shadow = await this.shadowExecutionService.createForPrediction({
      predictionId: prediction.id,
      marketId,
      assetSymbol: market.assetSymbol,
      timeframe: market.timeframe,
      predictedOutcome,
      tokenId: selectedTokenId,
      checkpointSeconds,
      actualSecondsToClose: secondsToClose,
      decisionPrice: entryPrice,
      modelProbability: probabilityForPrediction,
      orderBook: selectedBook
    });

    this.logger.info("Higher-timeframe outcome checkpoint stored.", {
      slug: market.slug,
      assetSymbol: market.assetSymbol,
      timeframe: market.timeframe,
      checkpointSeconds,
      actualSecondsToClose: secondsToClose,
      targetPrice: target.price,
      currentAssetPrice: spot.priceUsd,
      predictedOutcome,
      entryPrice,
      estimatedProbability: probabilityForPrediction,
      edge,
      shadowStatus: shadow?.status ?? null,
      mode: config.enableHtfRealTrading ? "REAL_TRADING" : "OBSERVATION_ONLY"
    });
  }

  private async loadTrustedTarget(
    marketId: string
  ): Promise<{ price: number; source: string } | null> {
    const row = await prisma.marketSnapshot.findFirst({
      where: { marketId, targetPrice: { not: null } },
      select: { targetPrice: true, rawData: true },
      orderBy: { createdAt: "asc" }
    });
    if (!row?.targetPrice) {
      return null;
    }

    const metadata = parseJson(row.rawData);
    if (metadata.targetPriceTrustedForLearning !== true) {
      return null;
    }
    return {
      price: Number(row.targetPrice),
      source:
        typeof metadata.targetPriceSource === "string"
          ? metadata.targetPriceSource
          : "UNKNOWN"
    };
  }
}

export function getDueHigherTimeframeCheckpoint(
  timeframe: HigherTimeframe,
  secondsToClose: number
): number | null {
  const checkpoint = HIGHER_TIMEFRAME_CHECKPOINTS[timeframe]
    .filter(
      (candidate) =>
        secondsToClose <= candidate &&
        candidate - secondsToClose <= CHECKPOINT_MAX_LATENESS_SECONDS
    )
    .sort((left, right) => left - secondsToClose - (right - secondsToClose))[0];
  return checkpoint ?? null;
}

export function estimateHigherTimeframeProbability(input: {
  distancePercent: number;
  secondsToClose: number;
  timeframe: HigherTimeframe;
}): number {
  const durationSeconds = input.timeframe === "1h" ? 60 * 60 : 4 * 60 * 60;
  const remainingFraction = Math.max(
    0.05,
    Math.min(1, input.secondsToClose / durationSeconds)
  );
  const normalizedDistance =
    Math.abs(input.distancePercent) * 100 / Math.sqrt(remainingFraction);
  const directionalConfidence = Math.min(0.45, normalizedDistance * 0.5);
  const probabilityCurrentDirection = 0.5 + directionalConfidence;
  return input.distancePercent >= 0
    ? probabilityCurrentDirection
    : 1 - probabilityCurrentDirection;
}

function inferWindowStart(market: NormalizedCryptoMarket): Date | null {
  const timestamp = market.slug?.match(/-(\d{10})$/)?.[1];
  if (timestamp) {
    return new Date(Number(timestamp) * 1_000);
  }
  if (!market.endDate) {
    return null;
  }
  const duration =
    market.timeframe === "1h"
      ? 60 * 60 * 1_000
      : market.timeframe === "4h"
        ? 4 * 60 * 60 * 1_000
        : null;
  return duration === null
    ? null
    : new Date(market.endDate.getTime() - duration);
}

function toSupportedAsset(asset: string): CryptoAsset | null {
  return ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"].includes(asset)
    ? (asset as CryptoAsset)
    : null;
}

function bestAsk(book: PolymarketOrderBook | null): number | null {
  const values = book?.asks
    .map((level) => Number(level.price))
    .filter((price) => Number.isFinite(price) && price > 0 && price < 1)
    .sort((left, right) => left - right);
  return values?.[0] ?? null;
}

function bestBid(book: PolymarketOrderBook | null): number | null {
  const values = book?.bids
    .map((level) => Number(level.price))
    .filter((price) => Number.isFinite(price) && price > 0 && price < 1)
    .sort((left, right) => right - left);
  return values?.[0] ?? null;
}

function bookSpread(book: PolymarketOrderBook | null): number | null {
  const ask = bestAsk(book);
  const bid = bestBid(book);
  return ask === null || bid === null ? null : ask - bid;
}

function bookDepthUsd(book: PolymarketOrderBook | null): number | null {
  if (!book) {
    return null;
  }
  return book.asks.reduce((sum, level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    return Number.isFinite(price) && Number.isFinite(size)
      ? sum + price * size
      : sum;
  }, 0);
}

function summarizeBook(book: PolymarketOrderBook | null) {
  return book
    ? {
        bestBid: bestBid(book),
        bestAsk: bestAsk(book),
        spread: bookSpread(book),
        askDepthUsd: bookDepthUsd(book),
        minOrderSize: book.minOrderSize ?? null,
        tickSize: book.tickSize ?? null,
        timestamp: book.timestamp ?? null
      }
    : null;
}

function parseJson(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function optionalDecimal(value: number | null): Prisma.Decimal | null {
  return value === null || !Number.isFinite(value) ? null : decimal(value);
}

async function resolveBinanceHourlyOpen(market: NormalizedCryptoMarket) {
  const asset = toSupportedAsset(market.assetSymbol);
  const windowStart = inferWindowStart(market);
  if (!asset || !windowStart) {
    return {
      targetPrice: null,
      source: "UNKNOWN" as const,
      trustedForLearning: false,
      reason: "Missing Binance symbol or hourly candle start.",
      fetchedAt: new Date()
    };
  }

  try {
    const params = new URLSearchParams({
      symbol: `${asset}USDT`,
      interval: "1h",
      startTime: String(windowStart.getTime()),
      limit: "1"
    });
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?${params.toString()}`
    );
    if (!response.ok) {
      throw new Error(`Binance returned HTTP ${response.status}.`);
    }
    const rows = await response.json() as unknown;
    const first = Array.isArray(rows) && Array.isArray(rows[0])
      ? rows[0]
      : null;
    const openPrice = Number(first?.[1]);
    const candleStart = Number(first?.[0]);
    if (
      !Number.isFinite(openPrice) ||
      openPrice <= 0 ||
      candleStart !== windowStart.getTime()
    ) {
      throw new Error("Binance did not return the expected hourly candle.");
    }
    return {
      targetPrice: openPrice,
      source: "BINANCE_1H_CANDLE_OPEN" as const,
      trustedForLearning: true,
      reason: "Captured the official Binance 1H candle open.",
      fetchedAt: new Date(),
      rawEvidence: JSON.stringify({
        symbol: `${asset}USDT`,
        interval: "1h",
        candleStart,
        openPrice
      })
    };
  } catch (error) {
    return {
      targetPrice: null,
      source: "UNKNOWN" as const,
      trustedForLearning: false,
      reason: error instanceof Error ? error.message : String(error),
      fetchedAt: new Date()
    };
  }
}

async function resolveBinanceCurrentPrice(asset: CryptoAsset) {
  try {
    const response = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`
    );
    if (!response.ok) {
      throw new Error(`Binance returned HTTP ${response.status}.`);
    }
    const payload = await response.json() as { price?: string };
    const price = Number(payload.price);
    return {
      assetSymbol: asset,
      priceUsd: Number.isFinite(price) && price > 0 ? price : null,
      source: "BINANCE_USDT",
      fetchedAt: new Date()
    };
  } catch {
    return {
      assetSymbol: asset,
      priceUsd: null,
      source: "ERROR",
      fetchedAt: new Date()
    };
  }
}
