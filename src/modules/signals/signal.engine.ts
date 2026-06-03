import {
  CryptoAsset,
  CryptoMarketType,
  SUPPORTED_CRYPTO_ASSETS,
  SUPPORTED_CRYPTO_MARKET_TYPES
} from "../../config/assets";
import { CryptoUpDownShortTermStrategy } from "./strategies/crypto-up-down-short-term.strategy";
import { SignalInput, SignalResult } from "./signal.types";

export class SignalEngine {
  private readonly upDownShortTermStrategy = new CryptoUpDownShortTermStrategy();

  generateSignal(input: SignalInput): SignalResult {
    const cryptoValidation = this.validateCryptoInput(input);
    if (!cryptoValidation.isValid) {
      return createAvoidSignal("signal-engine-validation", cryptoValidation.reason);
    }

    if (input.marketType === "UP_DOWN_SHORT_TERM") {
      return this.upDownShortTermStrategy.evaluate(input);
    }

    return createAvoidSignal(
      "signal-engine-router",
      `Market type ${input.marketType} is crypto but has no deterministic strategy enabled yet.`
    );
  }

  private validateCryptoInput(input: SignalInput): { isValid: true } | { isValid: false; reason: string } {
    if (!input.marketId || !input.marketQuestion) {
      return { isValid: false, reason: "Market id and question are required to generate a signal." };
    }

    if (!SUPPORTED_CRYPTO_ASSETS.includes(input.assetSymbol as CryptoAsset)) {
      return {
        isValid: false,
        reason: `Market asset ${input.assetSymbol || "unknown"} is not a supported crypto asset.`
      };
    }

    if (!SUPPORTED_CRYPTO_MARKET_TYPES.includes(input.marketType as CryptoMarketType)) {
      return {
        isValid: false,
        reason: `Market type ${input.marketType || "unknown"} is not a supported crypto market type.`
      };
    }

    return { isValid: true };
  }
}

function createAvoidSignal(strategyName: string, reason: string): SignalResult {
  return {
    strategyName,
    predictedOutcome: "YES",
    entryPrice: 0,
    impliedProbability: 0,
    botProbability: 0,
    edge: 0,
    recommendation: "AVOID",
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
    }
  };
}
