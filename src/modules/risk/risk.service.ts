import { Prisma } from "@prisma/client";
import { CryptoAsset } from "../../config/assets";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { StrategySignal } from "../signals/signal";
import { SignalInput, SignalResult } from "../signals/signal.types";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface RiskAssessment {
  allowed: boolean;
  reason: string;
  riskLevel: RiskLevel;
}

export interface RiskEvaluationInput {
  marketId: string;
  marketCategory: string;
  assetSymbol: string;
  marketType: string;
  entryPrice: number | null;
  spread: number | null;
  liquidity: number | null;
  secondsToClose: number | null;
  targetPrice?: number | null;
  currentAssetPrice?: number | null;
  predictionIdToExclude?: string;
  recommendation?: string;
  predictedOutcome?: string;
}

const RECENT_SIGNAL_WINDOW_MS = 5 * 60 * 1000;

export class RiskService {
  async evaluateSignal(
    input: SignalInput,
    signal: SignalResult,
    marketCategory = "CRYPTO"
  ): Promise<RiskAssessment> {
    return this.evaluate({
      marketId: input.marketId,
      marketCategory,
      assetSymbol: input.assetSymbol,
      marketType: input.marketType,
      entryPrice: signal.entryPrice,
      spread: input.spread,
      liquidity: input.liquidity,
      secondsToClose: input.secondsToClose,
      targetPrice: input.targetPrice,
      currentAssetPrice: input.currentAssetPrice,
      recommendation: signal.recommendation,
      predictedOutcome: signal.predictedOutcome
    });
  }

  async evaluateSimulationRequest(input: RiskEvaluationInput): Promise<RiskAssessment> {
    return this.evaluate(input);
  }

  evaluateStaticSimulationRequest(input: RiskEvaluationInput): RiskAssessment {
    return this.evaluateStaticRules(input);
  }

  approveSimulation(signal: StrategySignal): boolean {
    const assessment = this.evaluateLegacySignal(signal);
    return assessment.allowed;
  }

  evaluateLegacySignal(signal: StrategySignal): RiskAssessment {
    const entryPrice = signal.market.yesPrice ?? signal.market.noPrice ?? null;
    const assessment = this.evaluateStaticRules({
      marketId: signal.market.externalId,
      marketCategory: "CRYPTO",
      assetSymbol: signal.market.asset,
      marketType: signal.market.marketType,
      entryPrice,
      spread: signal.market.spread,
      liquidity: signal.market.liquidityUsd,
      secondsToClose: signal.market.closesAt
        ? Math.max(0, Math.floor((signal.market.closesAt.getTime() - Date.now()) / 1000))
        : null
    });

    if (!assessment.allowed) {
      return assessment;
    }

    return {
      allowed: true,
      reason: "Riesgo aceptable para simulacion local.",
      riskLevel: this.inferAllowedRiskLevel(signal.market.spread, signal.market.liquidityUsd)
    };
  }

  private async evaluate(input: RiskEvaluationInput): Promise<RiskAssessment> {
    const staticAssessment = this.evaluateStaticRules(input);
    if (!staticAssessment.allowed) {
      return staticAssessment;
    }

    if (await this.hasPendingTrade(input.marketId)) {
      return {
        allowed: false,
        reason: "Ya existe trade simulado pendiente para el mismo mercado.",
        riskLevel: "MEDIUM"
      };
    }

    if (await this.hasRecentActionableSignal(input)) {
      return {
        allowed: false,
        reason: "Ya existe senal operativa reciente para el mismo mercado.",
        riskLevel: "MEDIUM"
      };
    }

    return {
      allowed: true,
      reason: "Riesgo aceptable para simulacion o futura ejecucion controlada.",
      riskLevel: this.inferAllowedRiskLevel(input.spread, input.liquidity)
    };
  }

  private evaluateStaticRules(input: RiskEvaluationInput): RiskAssessment {
    if (input.marketCategory !== "CRYPTO") {
      return {
        allowed: false,
        reason: "El mercado no es CRYPTO.",
        riskLevel: "HIGH"
      };
    }

    if (input.marketType === "CRYPTO_OTHER") {
      return {
        allowed: false,
        reason: "MarketType CRYPTO_OTHER bloqueado porque no hay estrategia clara.",
        riskLevel: "HIGH"
      };
    }

    if (!config.priorityAssets.includes(input.assetSymbol as CryptoAsset)) {
      return {
        allowed: false,
        reason: `Activo ${input.assetSymbol || "desconocido"} no esta en PRIORITY_ASSETS.`,
        riskLevel: "MEDIUM"
      };
    }

    if (this.hasMissingEssentialData(input)) {
      return {
        allowed: false,
        reason: "Faltan datos esenciales para evaluar el riesgo.",
        riskLevel: "HIGH"
      };
    }

    if (input.spread !== null && input.spread > config.maxSpread) {
      return {
        allowed: false,
        reason: "Spread mayor que MAX_SPREAD.",
        riskLevel: "HIGH"
      };
    }

    if (input.liquidity !== null && input.liquidity < config.minLiquidity) {
      return {
        allowed: false,
        reason: "Liquidez menor que MIN_LIQUIDITY.",
        riskLevel: "HIGH"
      };
    }

    if (input.entryPrice !== null && (input.entryPrice <= 0.05 || input.entryPrice >= 0.95)) {
      return {
        allowed: false,
        reason: "EntryPrice fuera del rango permitido: <= 0.05 o >= 0.95.",
        riskLevel: "HIGH"
      };
    }

    if (input.secondsToClose !== null && input.secondsToClose < 20) {
      return {
        allowed: false,
        reason: "Mercado demasiado cerca del cierre.",
        riskLevel: "HIGH"
      };
    }

    return {
      allowed: true,
      reason: "Reglas estaticas de riesgo aprobadas.",
      riskLevel: "LOW"
    };
  }

  private hasMissingEssentialData(input: RiskEvaluationInput): boolean {
    return (
      !input.marketId ||
      !input.assetSymbol ||
      !input.marketType ||
      input.entryPrice === null ||
      input.spread === null ||
      input.liquidity === null ||
      input.secondsToClose === null
    );
  }

  private async hasRecentActionableSignal(input: RiskEvaluationInput): Promise<boolean> {
    if (!isActionableRecommendation(input.recommendation)) {
      return false;
    }

    const recentSince = new Date(Date.now() - RECENT_SIGNAL_WINDOW_MS);
    const where: Prisma.BotPredictionWhereInput = {
      marketId: input.marketId,
      createdAt: {
        gte: recentSince
      },
      recommendation: {
        in: ["ENTER_SMALL", "ENTER_MODERATE"]
      }
    };

    if (input.predictionIdToExclude) {
      where.id = {
        not: input.predictionIdToExclude
      };
    }

    if (input.predictedOutcome) {
      where.predictedOutcome = input.predictedOutcome;
    }

    const recentSignal = await prisma.botPrediction.findFirst({
      where,
      select: {
        id: true
      }
    });

    return recentSignal !== null;
  }

  private async hasPendingTrade(marketId: string): Promise<boolean> {
    const pendingTrade = await prisma.simulatedTrade.findFirst({
      where: {
        marketId,
        status: "PENDING"
      },
      select: {
        id: true
      }
    });

    return pendingTrade !== null;
  }

  private inferAllowedRiskLevel(spread: number | null, liquidity: number | null): RiskLevel {
    const spreadRatio = spread === null || config.maxSpread === 0 ? 0 : spread / config.maxSpread;
    const liquidityRatio = liquidity === null || config.minLiquidity === 0 ? 2 : liquidity / config.minLiquidity;

    if (spreadRatio >= 0.8 || liquidityRatio <= 1.25) {
      return "MEDIUM";
    }

    return "LOW";
  }
}

function isActionableRecommendation(recommendation?: string): boolean {
  return recommendation === "ENTER_SMALL" || recommendation === "ENTER_MODERATE";
}
