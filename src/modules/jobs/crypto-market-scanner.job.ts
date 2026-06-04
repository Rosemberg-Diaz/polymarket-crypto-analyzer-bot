import { Market, Prisma } from "@prisma/client";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import {
  NormalizedCryptoMarket,
  NormalizedCryptoMarketOutcome
} from "../crypto/crypto-market.types";
import { LoggerService } from "../logger/logger.service";
import { CryptoPriceService } from "../market-data/crypto-price.service";
import { FeatureBuilderService } from "../market-data/feature-builder.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { PolymarketService } from "../polymarket/polymarket.service";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import { RiskAssessment, RiskService } from "../risk/risk.service";
import { SignalEngine } from "../signals/signal.engine";
import { SignalInput, SignalResult } from "../signals/signal.types";
import { SimulationService } from "../simulations/simulation.service";

interface MarketRuntimeData {
  upPrice: number | null;
  downPrice: number | null;
  yesPrice: number | null;
  noPrice: number | null;
  spread: number | null;
  liquidity: number | null;
  volume: number | null;
  currentAssetPrice: number | null;
  secondsToClose: number | null;
  orderbookSummary: Record<string, unknown> | null;
  rawOrderbook: unknown | null;
}

const DUPLICATE_SIGNAL_WINDOW_MS = 30 * 1000;
const MAX_MARKETS_PER_SCAN = 25;
const UP_DOWN_TARGET_CAPTURE_WINDOW_MS = 60 * 1000;
const UP_DOWN_5M_WINDOW_MS = 5 * 60 * 1000;

export class CryptoMarketScannerJob {
  private readonly polymarketClient = new PolymarketClient();
  private readonly polymarketService: PolymarketService;
  private readonly signalEngine = new SignalEngine();
  private readonly riskService = new RiskService();
  private readonly simulationService = new SimulationService(this.riskService);
  private readonly featureBuilderService = new FeatureBuilderService();
  private readonly cryptoPriceService: CryptoPriceService;
  private readonly lastSignalByMarket = new Map<string, number>();

  constructor(private readonly logger: LoggerService) {
    this.polymarketService = new PolymarketService(this.polymarketClient, this.logger);
    this.cryptoPriceService = new CryptoPriceService(this.logger);
  }

  async runOnce(): Promise<void> {
    this.logger.info("Crypto market scanner started.");

    const markets = await this.polymarketService.getActiveCryptoMarkets({ limit: 200 });
    const prioritizedMarkets = markets.slice(0, MAX_MARKETS_PER_SCAN);

    if (prioritizedMarkets.length === 0) {
      this.logger.warn("No active crypto markets found from Polymarket.");
      return;
    }

    for (const market of prioritizedMarkets) {
      try {
        await this.processMarket(market);
      } catch (error) {
        this.logger.error("Failed to process Polymarket crypto market.", error, {
          externalMarketId: market.externalMarketId,
          slug: market.slug,
          question: market.question
        });
      }
    }

    this.logger.info("Crypto market scanner finished.", {
      fetchedCryptoMarkets: markets.length,
      processedMarkets: prioritizedMarkets.length
    });
  }

  private async processMarket(normalizedMarket: NormalizedCryptoMarket): Promise<void> {
    const savedMarket = await this.upsertMarket(normalizedMarket);
    await this.upsertOutcomes(savedMarket.id, normalizedMarket.outcomes);

    const runtimeData = await this.loadRuntimeData(normalizedMarket);
    const market = await this.resolveUpDownTargetPrice(savedMarket.id, normalizedMarket, runtimeData);
    const marketKey = this.getMarketKey(market);
    const shouldSkipSignal = await this.hasRecentSignal(savedMarket.id, marketKey);
    const signalInput = this.toSignalInput(savedMarket.id, market, runtimeData);
    const signal = shouldSkipSignal
      ? createStaticSignal("crypto-market-scanner-duplicate", "Skipped duplicate signal within 30 seconds.", "WAIT")
      : await this.signalEngine.generateSignal(signalInput);
    const riskAssessment = await this.riskService.evaluateSignal(signalInput, signal, savedMarket.category);
    const shouldStoreFullOrderbook = signal.recommendation !== "AVOID";
    const snapshot = await this.createSnapshot(
      savedMarket.id,
      market,
      runtimeData,
      shouldStoreFullOrderbook
    );
    let simulationText = "No simulation created.";
    const hasOperationalStrategy = this.hasOperationalStrategy(market);

    if (!hasOperationalStrategy) {
      simulationText = `Market stored without prediction: ${market.marketType} has no enabled strategy.`;
    } else if (!shouldSkipSignal) {
      const prediction = await this.createPrediction(savedMarket.id, snapshot.id, market, signalInput, signal);
      this.lastSignalByMarket.set(marketKey, Date.now());

      if (
        riskAssessment.allowed &&
        (signal.recommendation === "ENTER_SMALL" || signal.recommendation === "ENTER_MODERATE")
      ) {
        const trade = await this.simulationService.createPendingSimulation(
          prediction.id,
          savedMarket.id,
          config.simulatedStakeUsd,
          signal.entryPrice
        );
        simulationText = `Pending simulated trade ${trade.id}, stake $${config.simulatedStakeUsd}, shares ${trade.shares.toString()}.`;
      } else if (!riskAssessment.allowed) {
        simulationText = `Risk blocked: ${riskAssessment.reason} (${riskAssessment.riskLevel}).`;
      } else if (signal.recommendation === "WAIT") {
        simulationText = "Prediction stored, recommendation is WAIT.";
      }
    } else {
      simulationText = "Duplicate signal skipped; market and snapshot were still updated.";
    }

    this.printMarketResult(market, runtimeData, signal, riskAssessment, simulationText);
  }

  private async upsertMarket(market: NormalizedCryptoMarket): Promise<Market> {
    const externalMarketId = market.externalMarketId ?? `slug:${market.slug ?? market.question}`;

    return prisma.market.upsert({
      where: { externalMarketId },
      update: {
        slug: market.slug,
        question: market.question,
        category: market.category,
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
        category: market.category,
        assetSymbol: market.assetSymbol,
        baseAsset: market.baseAsset,
        quoteAsset: market.quoteAsset,
        marketType: market.marketType,
        timeframe: market.timeframe,
        active: market.active,
        closed: market.closed,
        startDate: new Date(),
        endDate: market.endDate,
        resolutionSource: market.resolutionSource,
        rawData: market.rawData
      }
    });
  }

  private async upsertOutcomes(marketId: string, outcomes: NormalizedCryptoMarketOutcome[]): Promise<void> {
    await prisma.marketOutcome.deleteMany({ where: { marketId } });

    if (outcomes.length === 0) {
      return;
    }

    await prisma.marketOutcome.createMany({
      data: outcomes.map((outcome) => ({
        marketId,
        externalTokenId: outcome.externalTokenId,
        name: outcome.name,
        normalizedName: outcome.normalizedName,
        currentPrice: outcome.currentPrice === null ? null : toDecimal(outcome.currentPrice)
      }))
    });
  }

  private async loadRuntimeData(market: NormalizedCryptoMarket): Promise<MarketRuntimeData> {
    const upOutcome = findOutcome(market, ["UP", "YES"]);
    const downOutcome = findOutcome(market, ["DOWN", "NO"]);
    const upPrice = await this.getOutcomePrice(upOutcome);
    const downPrice = await this.getOutcomePrice(downOutcome);
    const spreads = await Promise.all([
      upOutcome?.externalTokenId ? this.polymarketClient.getSpread(upOutcome.externalTokenId) : null,
      downOutcome?.externalTokenId ? this.polymarketClient.getSpread(downOutcome.externalTokenId) : null
    ]);
    const orderbooks = await Promise.all([
      upOutcome?.externalTokenId ? this.polymarketClient.getOrderBook(upOutcome.externalTokenId) : null,
      downOutcome?.externalTokenId ? this.polymarketClient.getOrderBook(downOutcome.externalTokenId) : null
    ]);
    const spotPrice = await this.cryptoPriceService.getSpotPriceUsd(market.assetSymbol);
    const spreadValues = spreads.flatMap((spread) => (spread?.spread === null || spread?.spread === undefined ? [] : [spread.spread]));

    return {
      upPrice,
      downPrice,
      yesPrice: upPrice,
      noPrice: downPrice,
      spread: spreadValues.length > 0 ? Math.max(...spreadValues) : null,
      liquidity: extractMarketNumber(market.rawData, ["liquidity", "liquidityNum", "liquidityClob", "liquidity_usd"]),
      volume: extractMarketNumber(market.rawData, ["volume", "volumeNum", "volumeClob", "volume_24hr"]),
      currentAssetPrice: spotPrice.priceUsd,
      secondsToClose: market.endDate ? Math.max(0, Math.floor((market.endDate.getTime() - Date.now()) / 1000)) : null,
      orderbookSummary: {
        orderbooks: summarizeOrderbooks(orderbooks),
        spotPrice: {
          source: spotPrice.source,
          priceUsd: spotPrice.priceUsd,
          fetchedAt: spotPrice.fetchedAt.toISOString()
        }
      },
      rawOrderbook: {
        up: orderbooks[0]?.raw ?? null,
        down: orderbooks[1]?.raw ?? null
      }
    };
  }

  private async getOutcomePrice(outcome: NormalizedCryptoMarketOutcome | null): Promise<number | null> {
    if (!outcome?.externalTokenId) {
      return outcome?.currentPrice ?? null;
    }

    const price = await this.polymarketClient.getPrice(outcome.externalTokenId, "BUY");
    return price.price ?? outcome.currentPrice;
  }

  private async resolveUpDownTargetPrice(
    marketId: string,
    market: NormalizedCryptoMarket,
    runtimeData: MarketRuntimeData
  ): Promise<NormalizedCryptoMarket> {
    if (market.marketType !== "UP_DOWN_SHORT_TERM" || market.targetPrice !== null) {
      return market;
    }

    const existingTarget = await prisma.marketSnapshot.findFirst({
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

    if (existingTarget?.targetPrice) {
      return withCapturedTarget(market, Number(existingTarget.targetPrice), "previous_snapshot");
    }

    const windowStart = inferUpDownWindowStart(market);
    const currentPrice = runtimeData.currentAssetPrice;
    const now = Date.now();

    if (
      windowStart !== null &&
      currentPrice !== null &&
      now >= windowStart.getTime() &&
      now <= windowStart.getTime() + UP_DOWN_TARGET_CAPTURE_WINDOW_MS
    ) {
      this.logger.info("Captured Up/Down target price from local spot price.", {
        market: market.question,
        slug: market.slug,
        assetSymbol: market.assetSymbol,
        targetPrice: currentPrice,
        source: "local_spot_at_window_start",
        windowStart: windowStart.toISOString()
      });

      return withCapturedTarget(market, currentPrice, "local_spot_at_window_start");
    }

    return {
      ...market,
      nonOperableReason:
        windowStart === null
          ? "Cannot infer Up/Down window start for target capture."
          : "Waiting to capture Up/Down target price near window start."
    };
  }

  private async createSnapshot(
    marketId: string,
    market: NormalizedCryptoMarket,
    runtimeData: MarketRuntimeData,
    storeFullOrderbook: boolean
  ) {
    const distanceToTarget =
      market.targetPrice !== null && runtimeData.currentAssetPrice !== null
        ? runtimeData.currentAssetPrice - market.targetPrice
        : null;
    const distanceToTargetPercent =
      distanceToTarget !== null && market.targetPrice !== null && market.targetPrice > 0
        ? distanceToTarget / market.targetPrice
        : null;

    return prisma.marketSnapshot.create({
      data: {
        marketId,
        upPrice: toNullableDecimal(runtimeData.upPrice),
        downPrice: toNullableDecimal(runtimeData.downPrice),
        yesPrice: toNullableDecimal(runtimeData.yesPrice),
        noPrice: toNullableDecimal(runtimeData.noPrice),
        bid: toNullableDecimal(getBestBid(runtimeData.orderbookSummary)),
        ask: toNullableDecimal(getBestAsk(runtimeData.orderbookSummary)),
        spread: toNullableDecimal(runtimeData.spread),
        liquidity: toNullableDecimal(runtimeData.liquidity),
        volume: toNullableDecimal(runtimeData.volume),
        targetPrice: toNullableDecimal(market.targetPrice),
        currentAssetPrice: toNullableDecimal(runtimeData.currentAssetPrice),
        distanceToTarget: toNullableDecimal(distanceToTarget),
        distanceToTargetPercent: toNullableDecimal(distanceToTargetPercent),
        secondsToClose: runtimeData.secondsToClose,
        momentumLast30s: null,
        momentumLast60s: null,
        momentumLast120s: null,
        volatilityLast60s: null,
        volatilityLast120s: null,
        rawOrderbook: storeFullOrderbook ? stringifyWithLimit(runtimeData.rawOrderbook) : null,
        rawData: stringifyWithLimit({
          market: {
            externalMarketId: market.externalMarketId,
            slug: market.slug,
            isOperable: market.isOperable,
            nonOperableReason: market.nonOperableReason
          },
          orderbookSummary: runtimeData.orderbookSummary
        })
      }
    });
  }

  private toSignalInput(
    marketId: string,
    market: NormalizedCryptoMarket,
    runtimeData: MarketRuntimeData
  ): SignalInput {
    return {
      marketId,
      marketSlug: market.slug,
      marketQuestion: market.question,
      marketType: market.marketType,
      assetSymbol: market.assetSymbol,
      timeframe: market.timeframe,
      targetPrice: market.targetPrice,
      currentAssetPrice: runtimeData.currentAssetPrice,
      upPrice: runtimeData.upPrice,
      downPrice: runtimeData.downPrice,
      yesPrice: runtimeData.yesPrice,
      noPrice: runtimeData.noPrice,
      spread: runtimeData.spread,
      liquidity: runtimeData.liquidity,
      volume: runtimeData.volume,
      secondsToClose: runtimeData.secondsToClose,
      momentumLast30s: null,
      momentumLast60s: null,
      momentumLast120s: null,
      volatilityLast60s: null,
      volatilityLast120s: null
    };
  }

  private async createPrediction(
    marketId: string,
    snapshotId: string,
    market: NormalizedCryptoMarket,
    signalInput: SignalInput,
    signal: SignalResult
  ) {
    const features = this.featureBuilderService.buildPredictionFeaturesJson({
      signalInput,
      signal
    });

    return prisma.botPrediction.create({
      data: {
        marketId,
        snapshotId,
        strategyName: signal.strategyName,
        assetSymbol: market.assetSymbol,
        marketType: market.marketType,
        predictedOutcome: signal.predictedOutcome,
        entryPrice: toDecimal(signal.entryPrice),
        impliedProbability: toDecimal(signal.impliedProbability),
        botProbability: toDecimal(signal.botProbability),
        edge: toDecimal(signal.edge),
        confidence: toDecimal(confidenceToScore(signal.confidence)),
        recommendation: signal.recommendation,
        reason: market.isOperable ? signal.reason : `${market.nonOperableReason ?? "Market is not operable."} ${signal.reason}`,
        features,
        historicalSummary: signal.historicalSummary
      }
    });
  }

  private isDuplicateWithinWindow(marketKey: string): boolean {
    const lastSignalAt = this.lastSignalByMarket.get(marketKey);
    return lastSignalAt !== undefined && Date.now() - lastSignalAt < DUPLICATE_SIGNAL_WINDOW_MS;
  }

  private async hasRecentSignal(marketId: string, marketKey: string): Promise<boolean> {
    if (this.isDuplicateWithinWindow(marketKey)) {
      return true;
    }

    const recentPrediction = await prisma.botPrediction.findFirst({
      where: {
        marketId,
        createdAt: {
          gte: new Date(Date.now() - DUPLICATE_SIGNAL_WINDOW_MS)
        }
      },
      select: {
        createdAt: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!recentPrediction) {
      return false;
    }

    this.lastSignalByMarket.set(marketKey, recentPrediction.createdAt.getTime());
    return true;
  }

  private getMarketKey(market: NormalizedCryptoMarket): string {
    return market.externalMarketId ?? market.slug ?? market.question;
  }

  private hasOperationalStrategy(market: NormalizedCryptoMarket): boolean {
    return market.marketType === "UP_DOWN_SHORT_TERM" && market.isOperable;
  }

  private printMarketResult(
    market: NormalizedCryptoMarket,
    runtimeData: MarketRuntimeData,
    signal: SignalResult,
    riskAssessment: RiskAssessment,
    simulationText: string
  ): void {
    const output = [
      `Mercado: ${market.question}`,
      `Activo: ${market.assetSymbol}`,
      `Target: ${market.targetPrice ?? "unknown"}`,
      `Precio actual: ${runtimeData.currentAssetPrice ?? "unknown"}`,
      `Up price: ${runtimeData.upPrice ?? "unknown"}`,
      `Down price: ${runtimeData.downPrice ?? "unknown"}`,
      `Tiempo restante: ${runtimeData.secondsToClose ?? "unknown"}s`,
      `Recomendacion: ${signal.recommendation}`,
      `Razon: ${signal.reason}`,
      `Simulacion potencial: ${simulationText}`
    ].join(" | ");

    console.log(output);
    this.logger.info("Real Polymarket crypto market scanned.", {
      market: market.question,
      asset: market.assetSymbol,
      marketType: market.marketType,
      timeframe: market.timeframe,
      target: market.targetPrice,
      currentAssetPrice: runtimeData.currentAssetPrice,
      upPrice: runtimeData.upPrice,
      downPrice: runtimeData.downPrice,
      secondsToClose: runtimeData.secondsToClose,
      recommendation: signal.recommendation,
      reason: signal.reason,
      risk: riskAssessment,
      simulation: simulationText
    });
  }
}

function findOutcome(
  market: NormalizedCryptoMarket,
  names: Array<NormalizedCryptoMarketOutcome["normalizedName"]>
): NormalizedCryptoMarketOutcome | null {
  return market.outcomes.find((outcome) => names.includes(outcome.normalizedName)) ?? null;
}

function summarizeOrderbooks(orderbooks: Array<PolymarketOrderBook | null>): Record<string, unknown> | null {
  const [up, down] = orderbooks;

  if (!up && !down) {
    return null;
  }

  return {
    up: up ? summarizeOrderbook(up) : null,
    down: down ? summarizeOrderbook(down) : null
  };
}

function summarizeOrderbook(orderbook: PolymarketOrderBook): Record<string, unknown> {
  return {
    tokenId: orderbook.tokenId,
    bids: orderbook.bids.slice(0, 3),
    asks: orderbook.asks.slice(0, 3)
  };
}

function getBestBid(summary: Record<string, unknown> | null): number | null {
  return getBestLevel(summary, "bids");
}

function getBestAsk(summary: Record<string, unknown> | null): number | null {
  return getBestLevel(summary, "asks");
}

function getBestLevel(summary: Record<string, unknown> | null, side: "bids" | "asks"): number | null {
  if (!summary) {
    return null;
  }

  const orderbookSummary =
    summary.orderbooks && typeof summary.orderbooks === "object"
      ? (summary.orderbooks as Record<string, unknown>)
      : summary;
  const books = [orderbookSummary.up, orderbookSummary.down].filter((book): book is Record<string, unknown> => Boolean(book));
  const prices = books.flatMap((book) => {
    const levels = book[side];
    if (!Array.isArray(levels)) {
      return [];
    }

    return levels.flatMap((level) => {
      if (!level || typeof level !== "object") {
        return [];
      }

      const price = Number((level as Record<string, unknown>).price);
      return Number.isFinite(price) ? [price] : [];
    });
  });

  if (prices.length === 0) {
    return null;
  }

  return side === "bids" ? Math.max(...prices) : Math.min(...prices);
}

function createStaticSignal(
  strategyName: string,
  reason: string,
  recommendation: SignalResult["recommendation"]
): SignalResult {
  return {
    strategyName,
    predictedOutcome: "YES",
    entryPrice: 0,
    impliedProbability: 0,
    botProbability: 0,
    edge: 0,
    recommendation,
    confidence: "LOW",
    reason,
    features: {
      priceSource: "NONE",
      selectedPrice: 0,
      oppositePrice: 0,
      spread: null,
      liquidity: null,
      volume: null,
      secondsToClose: null,
      momentumScore: 0,
      volatilityPenalty: 0,
      dataCompleteness: 0
    },
    confidenceAdjustment: 0,
    historicalSummary: "Esta senal no ha sido comparada todavia contra casos historicos similares."
  };
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(round6(value));
}

function toNullableDecimal(value: number | null): Prisma.Decimal | null {
  return value === null ? null : toDecimal(value);
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function confidenceToScore(confidence: SignalResult["confidence"]): number {
  if (confidence === "HIGH") {
    return 0.85;
  }

  if (confidence === "MODERATE") {
    return 0.6;
  }

  return 0.35;
}

function extractMarketNumber(rawData: string, keys: string[]): number | null {
  try {
    const parsed = JSON.parse(rawData) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      const numericValue = Number(value);

      if (Number.isFinite(numericValue)) {
        return numericValue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function withCapturedTarget(
  market: NormalizedCryptoMarket,
  targetPrice: number,
  source: string
): NormalizedCryptoMarket {
  return {
    ...market,
    targetPrice,
    isOperable: true,
    nonOperableReason: null,
    rawData: stringifyWithLimit({
      ...parseJsonRecord(market.rawData),
      derivedTargetPrice: {
        value: targetPrice,
        source,
        capturedAt: new Date().toISOString()
      }
    })
  };
}

function inferUpDownWindowStart(market: NormalizedCryptoMarket): Date | null {
  const slugTimestamp = market.slug?.match(/-(\d{10})$/)?.[1];
  if (slugTimestamp) {
    const timestamp = Number(slugTimestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return new Date(timestamp * 1000);
    }
  }

  if (market.endDate && market.timeframe === "5m") {
    return new Date(market.endDate.getTime() - UP_DOWN_5M_WINDOW_MS);
  }

  return null;
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringifyWithLimit(value: unknown, maxLength = 20_000): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxLength) {
      return serialized;
    }

    return `${serialized.slice(0, maxLength)}...[truncated]`;
  } catch {
    return "{}";
  }
}
