import { Prisma } from "@prisma/client";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { RiskService } from "../risk/risk.service";
import { SignalEngine } from "../signals/signal.engine";
import { SignalInput, SignalResult } from "../signals/signal.types";
import { SimulationService } from "../simulations/simulation.service";

interface MockCryptoMarket {
  externalMarketId: string;
  slug: string;
  question: string;
  assetSymbol: "BTC" | "ETH" | "SOL";
  timeframe: "5m" | "15m";
  targetPrice: number;
  currentAssetPrice: number;
  upPrice: number;
  downPrice: number;
  spread: number;
  liquidity: number;
  volume: number;
  secondsToClose: number;
  momentumLast30s: number;
  momentumLast60s: number;
  volatilityLast60s: number;
}

const DUPLICATE_SIGNAL_WINDOW_MS = 30 * 1000;

export class CryptoMarketScannerJob {
  private readonly signalEngine = new SignalEngine();
  private readonly riskService = new RiskService();
  private readonly simulationService = new SimulationService(this.riskService);
  private readonly lastSignalByMarket = new Map<string, number>();

  constructor(private readonly logger: LoggerService) {}

  async runOnce(): Promise<void> {
    this.logger.info("Crypto mock scanner started.");

    for (const mockMarket of this.getMockMarkets()) {
      await this.processMockMarket(mockMarket);
    }

    this.logger.info("Crypto mock scanner finished.");
  }

  private async processMockMarket(mockMarket: MockCryptoMarket): Promise<void> {
    if (this.isDuplicateWithinWindow(mockMarket.externalMarketId)) {
      this.printMarketResult(mockMarket, null, "Skipped duplicate signal within 30 seconds.", null);
      return;
    }

    const market = await prisma.market.upsert({
      where: {
        externalMarketId: mockMarket.externalMarketId
      },
      update: {
        slug: mockMarket.slug,
        question: mockMarket.question,
        category: "CRYPTO",
        assetSymbol: mockMarket.assetSymbol,
        baseAsset: mockMarket.assetSymbol,
        quoteAsset: "USD",
        marketType: "UP_DOWN_SHORT_TERM",
        timeframe: mockMarket.timeframe,
        active: true,
        closed: false,
        endDate: new Date(Date.now() + mockMarket.secondsToClose * 1000),
        rawData: JSON.stringify(mockMarket)
      },
      create: {
        externalMarketId: mockMarket.externalMarketId,
        slug: mockMarket.slug,
        question: mockMarket.question,
        category: "CRYPTO",
        assetSymbol: mockMarket.assetSymbol,
        baseAsset: mockMarket.assetSymbol,
        quoteAsset: "USD",
        marketType: "UP_DOWN_SHORT_TERM",
        timeframe: mockMarket.timeframe,
        active: true,
        closed: false,
        startDate: new Date(),
        endDate: new Date(Date.now() + mockMarket.secondsToClose * 1000),
        resolutionSource: "MOCK_LOCAL_SCANNER",
        rawData: JSON.stringify(mockMarket)
      }
    });

    const snapshot = await prisma.marketSnapshot.create({
      data: {
        marketId: market.id,
        upPrice: toDecimal(mockMarket.upPrice),
        downPrice: toDecimal(mockMarket.downPrice),
        yesPrice: toDecimal(mockMarket.upPrice),
        noPrice: toDecimal(mockMarket.downPrice),
        bid: toDecimal(Math.min(mockMarket.upPrice, mockMarket.downPrice)),
        ask: toDecimal(Math.max(mockMarket.upPrice, mockMarket.downPrice)),
        spread: toDecimal(mockMarket.spread),
        liquidity: toDecimal(mockMarket.liquidity),
        volume: toDecimal(mockMarket.volume),
        targetPrice: toDecimal(mockMarket.targetPrice),
        currentAssetPrice: toDecimal(mockMarket.currentAssetPrice),
        distanceToTarget: toDecimal(mockMarket.currentAssetPrice - mockMarket.targetPrice),
        distanceToTargetPercent: toDecimal(
          (mockMarket.currentAssetPrice - mockMarket.targetPrice) / mockMarket.targetPrice
        ),
        secondsToClose: mockMarket.secondsToClose,
        momentumLast30s: toDecimal(mockMarket.momentumLast30s),
        momentumLast60s: toDecimal(mockMarket.momentumLast60s),
        momentumLast120s: toDecimal(mockMarket.momentumLast60s),
        volatilityLast60s: toDecimal(mockMarket.volatilityLast60s),
        volatilityLast120s: toDecimal(mockMarket.volatilityLast60s),
        rawData: JSON.stringify(mockMarket)
      }
    });

    const signalInput = this.toSignalInput(market.id, mockMarket);
    const signal = this.signalEngine.generateSignal(signalInput);
    const riskAssessment = await this.riskService.evaluateSignal(signalInput, signal, market.category);
    let simulationText = "No simulation created.";

    if (signal.recommendation !== "AVOID" && riskAssessment.allowed) {
      const prediction = await prisma.botPrediction.create({
        data: {
          marketId: market.id,
          snapshotId: snapshot.id,
          strategyName: signal.strategyName,
          assetSymbol: mockMarket.assetSymbol,
          marketType: "UP_DOWN_SHORT_TERM",
          predictedOutcome: signal.predictedOutcome,
          entryPrice: toDecimal(signal.entryPrice),
          impliedProbability: toDecimal(signal.impliedProbability),
          botProbability: toDecimal(signal.botProbability),
          edge: toDecimal(signal.edge),
          confidence: toDecimal(confidenceToScore(signal.confidence)),
          recommendation: signal.recommendation,
          reason: signal.reason,
          features: JSON.stringify({ ...signal.features, confidenceLabel: signal.confidence }),
          historicalSummary: "Mock scanner run. No machine learning used."
        }
      });

      this.lastSignalByMarket.set(mockMarket.externalMarketId, Date.now());

      if (signal.recommendation === "ENTER_SMALL" || signal.recommendation === "ENTER_MODERATE") {
        const trade = await this.simulationService.createPendingSimulation(
          prediction.id,
          market.id,
          config.simulatedStakeUsd,
          signal.entryPrice
        );
        simulationText = `Pending simulated trade ${trade.id}, stake $${config.simulatedStakeUsd}, shares ${trade.shares.toString()}.`;
      } else {
        simulationText = "Prediction stored, recommendation is WAIT.";
      }
    } else if (!riskAssessment.allowed) {
      simulationText = `Risk blocked: ${riskAssessment.reason} (${riskAssessment.riskLevel}).`;
    }

    this.printMarketResult(mockMarket, signal, riskAssessment.reason, simulationText);
  }

  private toSignalInput(marketId: string, mockMarket: MockCryptoMarket): SignalInput {
    return {
      marketId,
      marketSlug: mockMarket.slug,
      marketQuestion: mockMarket.question,
      marketType: "UP_DOWN_SHORT_TERM",
      assetSymbol: mockMarket.assetSymbol,
      timeframe: mockMarket.timeframe,
      targetPrice: mockMarket.targetPrice,
      currentAssetPrice: mockMarket.currentAssetPrice,
      upPrice: mockMarket.upPrice,
      downPrice: mockMarket.downPrice,
      yesPrice: mockMarket.upPrice,
      noPrice: mockMarket.downPrice,
      spread: mockMarket.spread,
      liquidity: mockMarket.liquidity,
      volume: mockMarket.volume,
      secondsToClose: mockMarket.secondsToClose,
      momentumLast30s: mockMarket.momentumLast30s,
      momentumLast60s: mockMarket.momentumLast60s,
      momentumLast120s: mockMarket.momentumLast60s,
      volatilityLast60s: mockMarket.volatilityLast60s,
      volatilityLast120s: mockMarket.volatilityLast60s
    };
  }

  private isDuplicateWithinWindow(externalMarketId: string): boolean {
    const lastSignalAt = this.lastSignalByMarket.get(externalMarketId);

    return lastSignalAt !== undefined && Date.now() - lastSignalAt < DUPLICATE_SIGNAL_WINDOW_MS;
  }

  private printMarketResult(
    mockMarket: MockCryptoMarket,
    signal: SignalResult | null,
    reason: string,
    simulationText: string | null
  ): void {
    const recommendation = signal?.recommendation ?? "SKIPPED";
    const output = [
      `Mercado: ${mockMarket.question}`,
      `Activo: ${mockMarket.assetSymbol}`,
      `Target: ${mockMarket.targetPrice}`,
      `Precio actual: ${mockMarket.currentAssetPrice}`,
      `Up price: ${mockMarket.upPrice}`,
      `Down price: ${mockMarket.downPrice}`,
      `Tiempo restante: ${mockMarket.secondsToClose}s`,
      `Recomendacion: ${recommendation}`,
      `Razon: ${signal?.reason ?? reason}`,
      `Simulacion potencial: ${simulationText ?? "No evaluada."}`
    ].join(" | ");

    console.log(output);
    this.logger.info("Mock market scanned.", {
      market: mockMarket.question,
      asset: mockMarket.assetSymbol,
      target: mockMarket.targetPrice,
      currentAssetPrice: mockMarket.currentAssetPrice,
      upPrice: mockMarket.upPrice,
      downPrice: mockMarket.downPrice,
      secondsToClose: mockMarket.secondsToClose,
      recommendation,
      reason: signal?.reason ?? reason,
      simulation: simulationText
    });
  }

  private getMockMarkets(): MockCryptoMarket[] {
    return [
      {
        externalMarketId: "mock-btc-up-down-5m",
        slug: "mock-btc-up-down-5m",
        question: "BTC Up or Down in 5 minutes?",
        assetSymbol: "BTC",
        timeframe: "5m",
        targetPrice: 68000,
        currentAssetPrice: 68550,
        upPrice: 0.55,
        downPrice: 0.45,
        spread: 0.02,
        liquidity: 750,
        volume: 6200,
        secondsToClose: 75,
        momentumLast30s: 0.024,
        momentumLast60s: 0.018,
        volatilityLast60s: 0.01
      },
      {
        externalMarketId: "mock-eth-up-down-5m",
        slug: "mock-eth-up-down-5m",
        question: "ETH Up or Down in 5 minutes?",
        assetSymbol: "ETH",
        timeframe: "5m",
        targetPrice: 3500,
        currentAssetPrice: 3525,
        upPrice: 0.56,
        downPrice: 0.44,
        spread: 0.025,
        liquidity: 520,
        volume: 3900,
        secondsToClose: 95,
        momentumLast30s: 0.018,
        momentumLast60s: 0.014,
        volatilityLast60s: 0.012
      },
      {
        externalMarketId: "mock-sol-up-down-15m",
        slug: "mock-sol-up-down-15m",
        question: "SOL Up or Down in 15 minutes?",
        assetSymbol: "SOL",
        timeframe: "15m",
        targetPrice: 150,
        currentAssetPrice: 148.8,
        upPrice: 0.46,
        downPrice: 0.54,
        spread: 0.02,
        liquidity: 410,
        volume: 2800,
        secondsToClose: 180,
        momentumLast30s: -0.021,
        momentumLast60s: -0.016,
        volatilityLast60s: 0.011
      }
    ];
  }
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(round6(value));
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
