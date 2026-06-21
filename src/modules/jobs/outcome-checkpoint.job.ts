import { Prisma } from "@prisma/client";
import { CryptoAsset, SUPPORTED_CRYPTO_ASSETS } from "../../config/assets";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { OutcomeModelService } from "../learning/outcome-model.service";
import {
  CryptoPriceService,
  CryptoSpotPrice
} from "../market-data/crypto-price.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { MlOutcomeShadowExecutionService } from "../simulations/ml-outcome-shadow-execution.service";
import { ObservationEvaluationService } from "../simulations/observation-evaluation.service";
import { LiveOutcomeCheckpointTradingService } from "../trading/live-outcome-checkpoint-trading.service";
import { PolymarketTradingService } from "../trading/polymarket-trading.service";
import { getDueOutcomePredictionCheckpoints } from "./crypto-market-scanner.job";

export const OUTCOME_CHECKPOINT_STRATEGY = "OUTCOME_CHECKPOINT_V1";
const REAL_ORDER_CHAINLINK_MAX_AGE_MS = 90_000;
export const LATE_FIVE_MINUTE_CHECKPOINTS = [15, 10] as const;
export const LATE_FIVE_MINUTE_SHADOW_BUDGET_USD = 1.5;

export class OutcomeCheckpointJob {
  private readonly client = new PolymarketClient();
  private readonly observationService = new ObservationEvaluationService();
  private readonly outcomeModelService: OutcomeModelService;
  private readonly cryptoPriceService: CryptoPriceService;
  private readonly shadowExecutionService: MlOutcomeShadowExecutionService;
  private readonly liveTradingService: LiveOutcomeCheckpointTradingService;
  private readonly tradingService: PolymarketTradingService | null;
  private readonly staleTickWarnings = new Set<string>();

  constructor(private readonly logger: LoggerService) {
    this.outcomeModelService = new OutcomeModelService(logger);
    this.cryptoPriceService = new CryptoPriceService(logger);
    this.shadowExecutionService = new MlOutcomeShadowExecutionService(logger);
    if (
      config.enableMlOutcomeRealTrading &&
      config.enableRealTrading &&
      config.polygonPrivateKey &&
      config.addressWallet
    ) {
      this.tradingService = new PolymarketTradingService(
        config.polygonPrivateKey,
        config.addressWallet,
        logger,
        config.polymarketApiKey ?? undefined,
        config.polymarketSecret ?? undefined,
        config.polymarketPassphrase ?? undefined,
        config.polymarketFunderAddress ?? undefined
      );
      void this.tradingService.initialize().then((ready) => {
        if (ready) {
          logger.info("Live outcome checkpoint pilot trading service is ready.", {
            assets: config.mlOutcomeRealAssets,
            segments: config.mlOutcomeRealSegments,
            stakeUsd: config.mlOutcomeRealStakeUsd,
            checkpointSeconds: 30,
            timeframes: ["5m", "15m"],
            maxOpenTrades: config.mlOutcomeRealMaxOpenTrades,
            dailyStopLossUsd: config.mlOutcomeRealDailyStopLossUsd
          });
        }
      });
    } else {
      this.tradingService = null;
      if (config.enableMlOutcomeRealTrading) {
        logger.error(
          "Live outcome checkpoint pilot requested but credentials or global live mode are missing."
        );
      }
    }
    this.liveTradingService = new LiveOutcomeCheckpointTradingService(
      logger,
      this.tradingService
    );
  }

  async runOnce(): Promise<void> {
    const now = new Date();
    const markets = await prisma.market.findMany({
      where: {
        category: "CRYPTO",
        marketType: "UP_DOWN_SHORT_TERM",
        timeframe: { in: ["5m", "15m"] },
        active: true,
        closed: false,
        endDate: {
          gt: now,
          lte: new Date(now.getTime() + 225_000)
        }
      },
      include: {
        outcomes: true,
        snapshots: {
          where: {
            targetPrice: { not: null },
            currentAssetPrice: { not: null }
          },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { endDate: "asc" },
      take: 16
    });

    const candidates = markets.flatMap((market) => {
      if (!market.endDate) {
        return [];
      }

      const secondsToClose = Math.max(
        0,
        Math.floor((market.endDate.getTime() - Date.now()) / 1_000)
      );
      const checkpoints = getDueOutcomePredictionCheckpoints(secondsToClose)
        .filter(
          (checkpoint) =>
            market.timeframe === "5m" ||
            !isLateFiveMinuteCheckpoint(checkpoint)
        );
      const latestSnapshot = market.snapshots[0];
      const targetPrice = latestSnapshot?.targetPrice;
      const currentAssetPrice = latestSnapshot?.currentAssetPrice;
      const assetSymbol = toCryptoAsset(market.assetSymbol);

      return checkpoints.length > 0 &&
        targetPrice &&
        currentAssetPrice &&
        assetSymbol
        ? [{
            market,
            checkpointSeconds: checkpoints[0],
            secondsToClose,
            targetPrice: Number(targetPrice),
            currentAssetPrice: Number(currentAssetPrice),
            assetSymbol
          }]
        : [];
    });
    if (candidates.length === 0) {
      return;
    }

    await Promise.all(
      candidates.map(
        async (candidate) => {
          try {
            await this.capture(candidate);
          } catch (error) {
            this.logger.error("Outcome checkpoint failed for one market.", error, {
              marketId: candidate.market.id,
              slug: candidate.market.slug,
              checkpointSeconds: candidate.checkpointSeconds
            });
          }
        }
      )
    );
  }

  private async capture(
    candidate: {
      market: {
        id: string;
        slug: string | null;
        assetSymbol: string;
        marketType: string;
        timeframe: string | null;
        outcomes: Array<{
          normalizedName: string;
          externalTokenId: string | null;
          currentPrice: Prisma.Decimal | null;
        }>;
        snapshots: Array<{
          targetPrice: Prisma.Decimal | null;
          rawData: string | null;
        }>;
      };
      checkpointSeconds: number;
      secondsToClose: number;
      targetPrice: number;
      currentAssetPrice: number;
      assetSymbol: CryptoAsset;
    }
  ): Promise<void> {
    const existing = await prisma.botPrediction.findMany({
      where: {
        marketId: candidate.market.id,
        strategyName: OUTCOME_CHECKPOINT_STRATEGY
      },
      select: { features: true }
    });
    if (
      existing.some(
        (prediction) =>
          readCheckpointSeconds(prediction.features) ===
          candidate.checkpointSeconds
      )
    ) {
      return;
    }

    const upOutcome = candidate.market.outcomes.find((item) =>
      ["UP", "YES"].includes(item.normalizedName)
    );
    const downOutcome = candidate.market.outcomes.find((item) =>
      ["DOWN", "NO"].includes(item.normalizedName)
    );
    if (!upOutcome?.externalTokenId || !downOutcome?.externalTokenId) {
      return;
    }

    const [upPriceResponse, downPriceResponse] = await Promise.all([
      this.client.getPrice(upOutcome.externalTokenId, "BUY"),
      this.client.getPrice(downOutcome.externalTokenId, "BUY")
    ]);
    const upPrice =
      upPriceResponse.price ??
      (upOutcome.currentPrice === null ? null : Number(upOutcome.currentPrice));
    const downPrice =
      downPriceResponse.price ??
      (downOutcome.currentPrice === null ? null : Number(downOutcome.currentPrice));

    const freshChainlinkPrice = await this.getFreshChainlinkPrice(
      candidate.market.id,
      candidate.assetSymbol
    );
    if (!freshChainlinkPrice) {
      const warningKey =
        `${candidate.market.id}:${candidate.checkpointSeconds}`;
      if (!this.staleTickWarnings.has(warningKey)) {
        this.staleTickWarnings.add(warningKey);
        this.logger.warn("Outcome checkpoint waiting for fresh Chainlink tick.", {
          marketId: candidate.market.id,
          slug: candidate.market.slug,
          assetSymbol: candidate.assetSymbol,
          checkpointSeconds: candidate.checkpointSeconds,
          maxAgeMs: REAL_ORDER_CHAINLINK_MAX_AGE_MS
        });
      }
      return;
    }
    this.staleTickWarnings.delete(
      `${candidate.market.id}:${candidate.checkpointSeconds}`
    );

    const currentAssetPrice = freshChainlinkPrice.priceUsd;
    if (currentAssetPrice === null || currentAssetPrice <= 0) {
      return;
    }
    const predictedOutcome =
      currentAssetPrice > candidate.targetPrice ? "UP" : "DOWN";
    const entryPrice = predictedOutcome === "UP" ? upPrice : downPrice;
    if (entryPrice === null || entryPrice <= 0 || entryPrice >= 1) {
      return;
    }
    const distanceToTarget = currentAssetPrice - candidate.targetPrice;
    const distanceToTargetPercent =
      distanceToTarget / candidate.targetPrice;
    const targetMetadata = readTargetMetadata(
      candidate.market.snapshots[0]?.rawData
    );
    const normalizedPriceTotal =
      upPrice !== null && downPrice !== null ? upPrice + downPrice : 0;
    const impliedProbabilityUp = normalizedPriceTotal > 0
      ? upPrice! / normalizedPriceTotal
      : predictedOutcome === "UP"
        ? entryPrice
        : 1 - entryPrice;
    const mlScore = this.outcomeModelService.score({
      assetSymbol: candidate.market.assetSymbol,
      timeframe: candidate.market.timeframe === "15m" ? "15m" : "5m",
      targetPrice: candidate.targetPrice,
      currentAssetPrice,
      distanceToTargetPercent,
      secondsToClose: candidate.secondsToClose,
      impliedProbabilityUp,
      checkpointSeconds: candidate.checkpointSeconds
    });

    const lateCheckpoint = isLateFiveMinuteCheckpoint(
      candidate.checkpointSeconds
    );
    // Late checkpoints intentionally capture every eligible case so their
    // independent rules can be evaluated without inheriting the 30s gate.
    if (!lateCheckpoint) {
      const trendValidation = await this.validateTrend(
        candidate.market.id,
        candidate.targetPrice,
        currentAssetPrice,
        mlScore?.predictedOutcome ?? null,
        candidate.secondsToClose
      );
      if (!trendValidation.allowed) {
        this.logger.info("ML outcome trade filtered by trend validation.", {
          marketId: candidate.market.id,
          assetSymbol: candidate.market.assetSymbol,
          predictedOutcome: mlScore?.predictedOutcome,
          reason: trendValidation.reason
        });
        return;
      }
    }

    const mlOutcomeEntryPrice = mlScore?.predictedOutcome === "UP"
      ? upPrice
      : mlScore?.predictedOutcome === "DOWN"
        ? downPrice
        : null;
    const features = {
      assetSymbol: candidate.market.assetSymbol,
      marketType: candidate.market.marketType,
      timeframe: candidate.market.timeframe ?? "unknown",
      predictedOutcome,
      entryPrice,
      upPrice,
      downPrice,
      targetPrice: candidate.targetPrice,
      targetPriceSource: targetMetadata.source,
      targetPriceTrustedForLearning: targetMetadata.trusted,
      currentAssetPrice,
      currentAssetPriceSource: freshChainlinkPrice.source,
      currentAssetPriceTickAt: freshChainlinkPrice.fetchedAt.toISOString(),
      currentAssetPriceReceivedAt:
        freshChainlinkPrice.receivedAt?.toISOString() ?? null,
      currentAssetPriceAgeMs:
        Date.now() - freshChainlinkPrice.fetchedAt.getTime(),
      distanceToTarget,
      distanceToTargetPercent,
      secondsToClose: candidate.secondsToClose,
      strategyName: OUTCOME_CHECKPOINT_STRATEGY,
      recommendation: "WAIT",
      confidence: "OBSERVATION",
      botProbability: entryPrice,
      impliedProbability: entryPrice,
      edge: 0,
      entryRule: getOutcomeCheckpointEntryRule(candidate.checkpointSeconds),
      finalEntryRule: getOutcomeCheckpointEntryRule(candidate.checkpointSeconds),
      observationType: lateCheckpoint
        ? "LATE_OUTCOME_CHECKPOINT"
        : "OUTCOME_CHECKPOINT",
      checkpointSeconds: candidate.checkpointSeconds,
      captureJob: "LIGHTWEIGHT_5S"
    };

    const snapshot = await prisma.marketSnapshot.create({
      data: {
        marketId: candidate.market.id,
        targetPrice: decimal(candidate.targetPrice),
        currentAssetPrice: decimal(currentAssetPrice),
        distanceToTarget: decimal(distanceToTarget),
        distanceToTargetPercent: decimal(distanceToTargetPercent),
        secondsToClose: candidate.secondsToClose,
        rawData: JSON.stringify({
          observationType: lateCheckpoint
            ? "LATE_OUTCOME_CHECKPOINT"
            : "OUTCOME_CHECKPOINT",
          checkpointSeconds: candidate.checkpointSeconds,
          captureJob: "LIGHTWEIGHT_5S",
          targetPriceSource: targetMetadata.source,
          targetPriceTrustedForLearning: targetMetadata.trusted,
          currentAssetPriceSource: freshChainlinkPrice.source,
          currentAssetPriceTickAt: freshChainlinkPrice.fetchedAt.toISOString(),
          currentAssetPriceReceivedAt:
            freshChainlinkPrice.receivedAt?.toISOString() ?? null
        })
      }
    });
    const prediction = await prisma.botPrediction.create({
      data: {
        marketId: candidate.market.id,
        snapshotId: snapshot.id,
        strategyName: OUTCOME_CHECKPOINT_STRATEGY,
        assetSymbol: candidate.market.assetSymbol,
        marketType: candidate.market.marketType,
        predictedOutcome,
        entryPrice: decimal(entryPrice),
        impliedProbability: decimal(entryPrice),
        botProbability: decimal(entryPrice),
        edge: decimal(0),
        confidence: decimal(0.5),
        recommendation: "WAIT",
        reason:
          `${lateCheckpoint ? "Late checkpoint" : "Checkpoint"} ` +
          `${candidate.checkpointSeconds}s: ` +
          `prediccion observacional ${predictedOutcome}.`,
        features: JSON.stringify(features),
        historicalSummary:
          "Checkpoint temporal independiente; no crea orden real.",
        mlOutcomePrediction: mlScore?.predictedOutcome,
        mlProbabilityUp: mlScore
          ? decimal(mlScore.probabilityUp)
          : null,
        mlProbabilityDown: mlScore
          ? decimal(mlScore.probabilityDown)
          : null,
        mlOutcomeEntryPrice:
          mlOutcomeEntryPrice !== null &&
          mlOutcomeEntryPrice > 0 &&
          mlOutcomeEntryPrice < 1
            ? decimal(mlOutcomeEntryPrice)
            : null,
        mlOutcomeModelVersion: mlScore?.modelVersion,
        mlOutcomeFeatures: mlScore
          ? JSON.stringify(mlScore.features)
          : null,
        mlOutcomeScoredAt: mlScore ? new Date() : null
      }
    });
    await this.observationService.createPendingObservation(
      prediction.id,
      candidate.market.id,
      lateCheckpoint
        ? `LATE_OUTCOME_CHECKPOINT_${candidate.checkpointSeconds}S`
        : `OUTCOME_CHECKPOINT_${candidate.checkpointSeconds}S`,
      lateCheckpoint
        ? LATE_FIVE_MINUTE_SHADOW_BUDGET_USD
        : config.simulatedStakeUsd,
      entryPrice
    );

    if (
      config.mlOutcomeExecutionShadowEnabled &&
      mlScore &&
      mlOutcomeEntryPrice !== null &&
      mlOutcomeEntryPrice > 0 &&
      mlOutcomeEntryPrice < 1
    ) {
      const tokenId = mlScore.predictedOutcome === "UP"
        ? upOutcome.externalTokenId
        : downOutcome.externalTokenId;
      // Skip latency sleep for real trading - only simulate in shadow mode
      const isRealTrading = config.enableRealTrading && config.enableMlOutcomeRealTrading;
      if (!isRealTrading) {
        await sleep(config.mlOutcomeExecutionLatencyMs);
      }
      const delayedOrderBook = await this.client.getOrderBook(tokenId);
      const shadowExecution = await this.shadowExecutionService.createForPrediction({
        predictionId: prediction.id,
        marketId: candidate.market.id,
        assetSymbol: candidate.market.assetSymbol,
        timeframe: candidate.market.timeframe === "15m" ? "15m" : "5m",
        predictedOutcome: mlScore.predictedOutcome,
        tokenId,
        checkpointSeconds: candidate.checkpointSeconds,
        actualSecondsToClose: candidate.secondsToClose,
        decisionPrice: mlOutcomeEntryPrice,
        modelProbability:
          mlScore.predictedOutcome === "UP"
            ? mlScore.probabilityUp
            : mlScore.probabilityDown,
        orderBook: delayedOrderBook,
        budgetUsd: lateCheckpoint
          ? LATE_FIVE_MINUTE_SHADOW_BUDGET_USD
          : undefined
      });
      if (shadowExecution && !lateCheckpoint) {
        const preflightPrice = await this.getFreshChainlinkPrice(
          candidate.market.id,
          candidate.assetSymbol
        );
        const preflightDirection = preflightPrice?.priceUsd === null ||
          preflightPrice?.priceUsd === undefined
          ? null
          : preflightPrice.priceUsd > candidate.targetPrice ? "UP" : "DOWN";
        if (
          !preflightPrice ||
          preflightDirection !== mlScore.predictedOutcome
        ) {
          this.logger.warn("Live outcome order skipped by Chainlink preflight.", {
            executionId: shadowExecution.id,
            marketId: candidate.market.id,
            assetSymbol: candidate.assetSymbol,
            modelOutcome: mlScore.predictedOutcome,
            preflightDirection,
            tickAt: preflightPrice?.fetchedAt.toISOString() ?? null,
            maxAgeMs: REAL_ORDER_CHAINLINK_MAX_AGE_MS
          });
        } else {
          await this.liveTradingService.tryOpen(shadowExecution);
        }
      }
    }

    this.logger.info("Lightweight outcome checkpoint stored.", {
      market: candidate.market.slug,
      assetSymbol: candidate.market.assetSymbol,
      timeframe: candidate.market.timeframe,
      checkpointSeconds: candidate.checkpointSeconds,
      lateObservationOnly: lateCheckpoint,
      shadowBudgetUsd: lateCheckpoint
        ? LATE_FIVE_MINUTE_SHADOW_BUDGET_USD
        : config.mlOutcomeExecutionBudgetUsd,
      actualSecondsToClose: candidate.secondsToClose,
      predictedOutcome,
      entryPrice,
      mlOutcomePrediction: mlScore?.predictedOutcome,
      mlProbabilityUp: mlScore?.probabilityUp,
      mlOutcomeEntryPrice,
      currentAssetPriceSource: freshChainlinkPrice.source,
      currentAssetPriceTickAt: freshChainlinkPrice.fetchedAt.toISOString()
    });
  }

  private async getFreshChainlinkPrice(
    marketId: string,
    assetSymbol: CryptoAsset
  ): Promise<CryptoSpotPrice | null> {
    const persistentPrice =
      this.cryptoPriceService.getFreshPolymarketChainlinkPrice(
        assetSymbol,
        REAL_ORDER_CHAINLINK_MAX_AGE_MS
      );
    if (persistentPrice) {
      return persistentPrice;
    }

    const snapshots = await prisma.marketSnapshot.findMany({
      where: {
        marketId,
        currentAssetPrice: { not: null },
        createdAt: {
          gte: new Date(Date.now() - REAL_ORDER_CHAINLINK_MAX_AGE_MS)
        }
      },
      select: {
        currentAssetPrice: true,
        rawData: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: 12
    });

    for (const snapshot of snapshots) {
      const price = extractScannerChainlinkPrice(
        {
          currentAssetPrice: Number(snapshot.currentAssetPrice),
          rawData: snapshot.rawData,
          createdAt: snapshot.createdAt
        },
        assetSymbol,
        Date.now(),
        REAL_ORDER_CHAINLINK_MAX_AGE_MS
      );
      if (price) {
        return price;
      }
    }

    return null;
  }

  private async validateTrend(
    marketId: string,
    targetPrice: number,
    currentAssetPrice: number,
    predictedOutcome: string | null,
    secondsToClose: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!predictedOutcome) {
      return { allowed: true };
    }

    // Get recent snapshots to check price trend
    const recentSnapshots = await prisma.marketSnapshot.findMany({
      where: {
        marketId,
        createdAt: {
          gte: new Date(Date.now() - 120_000) // Last 2 minutes
        }
      },
      orderBy: { createdAt: "asc" },
      take: 20
    });

    if (recentSnapshots.length < 3) {
      return { allowed: true };
    }

    // Count how many times price was above/below target
    let aboveCount = 0;
    let belowCount = 0;
    for (const snapshot of recentSnapshots) {
      const price = Number(snapshot.currentAssetPrice);
      if (price > targetPrice) {
        aboveCount++;
      } else if (price < targetPrice) {
        belowCount++;
      }
    }

    const totalSnapshots = recentSnapshots.length;
    const aboveRatio = aboveCount / totalSnapshots;
    const belowRatio = belowCount / totalSnapshots;

    // Soft validation: only filter if price has been consistently against prediction
    // for more than 90% of recent snapshots
    const CONSISTENCY_THRESHOLD = 0.9;

    if (predictedOutcome === "DOWN" && aboveRatio >= CONSISTENCY_THRESHOLD) {
      return {
        allowed: false,
        reason: `Price consistently above target (${(aboveRatio * 100).toFixed(0)}% of last ${totalSnapshots} snapshots). Avoiding counter-trend DOWN trade.`
      };
    }

    if (predictedOutcome === "UP" && belowRatio >= CONSISTENCY_THRESHOLD) {
      return {
        allowed: false,
        reason: `Price consistently below target (${(belowRatio * 100).toFixed(0)}% of last ${totalSnapshots} snapshots). Avoiding counter-trend UP trade.`
      };
    }

    return { allowed: true };
  }
}

export function isLateFiveMinuteCheckpoint(
  checkpointSeconds: number
): boolean {
  return (LATE_FIVE_MINUTE_CHECKPOINTS as readonly number[])
    .includes(checkpointSeconds);
}

export function getOutcomeCheckpointEntryRule(
  checkpointSeconds: number
): string {
  return isLateFiveMinuteCheckpoint(checkpointSeconds)
    ? `OBSERVE_LATE_OUTCOME_CHECKPOINT_${checkpointSeconds}S`
    : `OBSERVE_OUTCOME_CHECKPOINT_${checkpointSeconds}S`;
}

export function extractScannerChainlinkPrice(
  snapshot: {
    currentAssetPrice: number;
    rawData: string | null;
    createdAt: Date;
  },
  assetSymbol: CryptoAsset,
  nowMs: number,
  maxAgeMs: number
): CryptoSpotPrice | null {
  if (
    !Number.isFinite(snapshot.currentAssetPrice) ||
    snapshot.currentAssetPrice <= 0
  ) {
    return null;
  }

  const raw = parseJsonRecord(snapshot.rawData);
  const orderbookSummary = asRecord(raw?.orderbookSummary);
  const spotPrice = asRecord(orderbookSummary?.spotPrice);
  if (spotPrice?.source !== "POLYMARKET_CHAINLINK") {
    return null;
  }

  const fetchedAtValue = spotPrice.fetchedAt;
  if (typeof fetchedAtValue !== "string") {
    return null;
  }
  const fetchedAt = new Date(fetchedAtValue);
  const ageMs = nowMs - fetchedAt.getTime();
  if (
    !Number.isFinite(fetchedAt.getTime()) ||
    ageMs < 0 ||
    ageMs > maxAgeMs
  ) {
    return null;
  }

  const rawPrice = Number(spotPrice.priceUsd);
  const priceUsd =
    Number.isFinite(rawPrice) && rawPrice > 0
      ? rawPrice
      : snapshot.currentAssetPrice;

  return {
    assetSymbol,
    priceUsd,
    source: "POLYMARKET_CHAINLINK",
    fetchedAt,
    receivedAt: snapshot.createdAt
  };
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toCryptoAsset(value: string): CryptoAsset | null {
  return SUPPORTED_CRYPTO_ASSETS.includes(value as CryptoAsset)
    ? value as CryptoAsset
    : null;
}

function readCheckpointSeconds(features: string | null): number | null {
  try {
    const value = JSON.parse(features ?? "{}") as Record<string, unknown>;
    return typeof value.checkpointSeconds === "number"
      ? value.checkpointSeconds
      : null;
  } catch {
    return null;
  }
}

function readTargetMetadata(rawData: string | null): {
  source: string | null;
  trusted: boolean;
} {
  try {
    const value = JSON.parse(rawData ?? "{}") as Record<string, unknown>;
    return {
      source:
        typeof value.targetPriceSource === "string"
          ? value.targetPriceSource
          : null,
      trusted: value.targetPriceTrustedForLearning === true
    };
  } catch {
    return { source: null, trusted: false };
  }
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(6));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
