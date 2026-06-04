import { Prisma, SimulatedTrade } from "@prisma/client";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { RiskService } from "../risk/risk.service";
import { StrategySignal } from "../signals/signal";
import {
  SimulatedDecision,
  SimulatedTradeCalculationInput,
  SimulatedTradeCalculationResult
} from "./simulation.types";

export class SimulationService {
  constructor(private readonly riskService = new RiskService()) {}

  calculateTradeResult(input: SimulatedTradeCalculationInput): SimulatedTradeCalculationResult {
    this.validateCalculationInput(input.stake, input.entryPrice);

    const shares = input.stake / input.entryPrice;
    const finalValue = input.didWin ? shares : 0;
    const profit = input.didWin ? finalValue - input.stake : -input.stake;
    const roi = profit / input.stake;

    return {
      stake: round6(input.stake),
      entryPrice: round6(input.entryPrice),
      shares: round6(shares),
      finalValue: round6(finalValue),
      profit: round6(profit),
      roi: round6(roi),
      isWin: input.didWin
    };
  }

  async createPendingSimulation(
    predictionId: string,
    marketId: string,
    stake: number,
    entryPrice: number
  ): Promise<SimulatedTrade> {
    this.validateCalculationInput(stake, entryPrice);
    await this.ensureRiskApproved(predictionId, marketId, entryPrice);
    const shares = round6(stake / entryPrice);

    return prisma.simulatedTrade.create({
      data: {
        predictionId,
        marketId,
        stake: toDecimal(stake),
        entryPrice: toDecimal(entryPrice),
        shares: toDecimal(shares),
        status: "PENDING"
      }
    });
  }

  async resolveSimulation(tradeId: string, didWin: boolean, result: string): Promise<SimulatedTrade> {
    const trade = await prisma.simulatedTrade.findUnique({
      where: { id: tradeId }
    });

    if (!trade) {
      throw new Error(`Simulated trade not found: ${tradeId}`);
    }

    const calculation = this.calculateTradeResult({
      stake: Number(trade.stake),
      entryPrice: Number(trade.entryPrice),
      didWin
    });

    return prisma.simulatedTrade.update({
      where: { id: tradeId },
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
  }

  createDecision(signal: StrategySignal): SimulatedDecision {
    const yesPrice = signal.market.yesPrice ?? 0.5;
    const noPrice = signal.market.noPrice ?? 0.5;
    const side = yesPrice <= noPrice ? "YES" : "NO";

    return {
      marketTitle: signal.market.title,
      side,
      stakeUsd: config.simulatedStakeUsd,
      entryPrice: side === "YES" ? yesPrice : noPrice,
      confidence: signal.confidence
    };
  }

  private validateCalculationInput(stake: number, entryPrice: number): void {
    if (!Number.isFinite(stake) || stake <= 0) {
      throw new Error("stake must be greater than 0.");
    }

    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
      throw new Error("entryPrice must be greater than 0 and less than 1.");
    }
  }

  private async ensureRiskApproved(predictionId: string, marketId: string, entryPrice: number): Promise<void> {
    const prediction = await prisma.botPrediction.findUnique({
      where: { id: predictionId },
      include: {
        market: true,
        snapshot: true
      }
    });

    if (!prediction) {
      throw new Error(`Prediction not found for risk evaluation: ${predictionId}`);
    }

    const assessment = await this.riskService.evaluateSimulationRequest({
      marketId,
      marketCategory: prediction.market.category,
      assetSymbol: prediction.assetSymbol,
      marketType: prediction.marketType,
      entryPrice,
      spread: prediction.snapshot.spread === null ? null : Number(prediction.snapshot.spread),
      liquidity: prediction.snapshot.liquidity === null ? null : Number(prediction.snapshot.liquidity),
      secondsToClose: prediction.snapshot.secondsToClose,
      targetPrice: prediction.snapshot.targetPrice === null ? null : Number(prediction.snapshot.targetPrice),
      currentAssetPrice:
        prediction.snapshot.currentAssetPrice === null ? null : Number(prediction.snapshot.currentAssetPrice),
      predictionIdToExclude: predictionId,
      recommendation: prediction.recommendation,
      predictedOutcome: prediction.predictedOutcome
    });

    if (!assessment.allowed) {
      throw new Error(`Risk blocked simulated trade: ${assessment.reason} (${assessment.riskLevel})`);
    }
  }
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(round6(value));
}
