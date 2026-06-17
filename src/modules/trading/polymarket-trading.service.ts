import { createWalletClient, http, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2
} from "@polymarket/clob-client-v2";
import { LoggerService } from "../logger/logger.service";
import { NormalizedCryptoMarket } from "../crypto/crypto-market.types";
import { SignalResult } from "../signals/signal.types";

const CLOB_API_URL = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const REAL_ORDER_MIN_SIMILAR_CASES = 5;
const REAL_ORDER_MIN_HISTORICAL_WIN_RATE = 0.6;
const REAL_ORDER_MIN_HISTORICAL_PROFIT = 0;
const REAL_ORDER_MAX_SECONDS_TO_CLOSE = 210;
const REAL_ORDER_CHEAP_DOWN_ENTRY_PRICE = 0.6;
const REAL_ORDER_CHEAP_DOWN_MIN_SECONDS_TO_CLOSE = 180;

export interface PlacedOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

export interface MarketOrderExecutionResult extends PlacedOrderResult {
  status?: string;
  filledShares?: number;
  cashAmount?: number;
  averagePrice?: number;
  raw?: unknown;
}

export class PolymarketTradingService {
  private clobClient: ClobClient | null = null;
  private initialized = false;

  constructor(
    private readonly privateKey: string,
    private readonly walletAddress: string,
    private readonly logger?: LoggerService,
    private readonly apiKey?: string,
    private readonly apiSecret?: string,
    private readonly apiPassphrase?: string,
    private readonly funderAddress?: string
  ) {}

  isReady(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<boolean> {
    try {
      const account = privateKeyToAccount(this.privateKey as Hex);
      const walletClient = createWalletClient({
        account,
        chain: polygon,
        transport: http()
      });

      const effectiveFunder = this.funderAddress ?? this.walletAddress;

      if (this.apiKey && this.apiSecret && this.apiPassphrase) {
        this.clobClient = new ClobClient({
          host: CLOB_API_URL,
          chain: CHAIN_ID as Chain,
          signer: walletClient,
          creds: {
            key: this.apiKey,
            secret: this.apiSecret,
            passphrase: this.apiPassphrase
          },
          signatureType: SignatureTypeV2.POLY_1271,
          funderAddress: effectiveFunder
        });
      } else {
        const tempClient = new ClobClient({
          host: CLOB_API_URL,
          chain: CHAIN_ID as Chain,
          signer: walletClient
        });

        const creds = await tempClient.createOrDeriveApiKey();

        this.clobClient = new ClobClient({
          host: CLOB_API_URL,
          chain: CHAIN_ID as Chain,
          signer: walletClient,
          creds,
          signatureType: SignatureTypeV2.POLY_1271,
          funderAddress: effectiveFunder
        });
      }

      this.initialized = true;

      this.logger?.info("Polymarket trading service initialized successfully.", {
        signatureType: SignatureTypeV2.POLY_1271,
        funderAddress: effectiveFunder
      });

      return true;
    } catch (error) {
      this.logger?.error("Failed to initialize Polymarket trading service.", {
        error: error instanceof Error ? error.message : String(error)
      });

      return false;
    }
  }

  async syncBalanceAllowance(): Promise<boolean> {
    if (!this.clobClient) {
      this.logger?.warn("Trading service not initialized.");
      return false;
    }

    try {
      await this.clobClient.updateBalanceAllowance({
        asset_type: AssetType.COLLATERAL
      });

      this.logger?.info("Balance/allowance cache synced.");
      return true;
    } catch (error) {
      this.logger?.error("Failed to sync balance/allowance.", {
        error: error instanceof Error ? error.message : String(error)
      });

      return false;
    }
  }

  async getUsdcBalance(syncFirst = true): Promise<{
    balanceUsd: number;
    allowanceUsd: number;
    raw: unknown;
  } | null> {
    if (!this.clobClient) {
      this.logger?.warn("Trading service not initialized.");
      return null;
    }

    if (syncFirst) {
      await this.syncBalanceAllowance();
    }

    try {
      const balance = await this.clobClient.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL
      });

      const balanceNum = Number(balance?.balance ?? 0);
      const allowanceNum = Number(balance?.allowances?.["0x"] ?? 0);

      return {
        balanceUsd: balanceNum / 1e6,
        allowanceUsd: allowanceNum / 1e6,
        raw: balance
      };
    } catch (error) {
      this.logger?.error("Failed to get USDC balance.", {
        error: error instanceof Error ? error.message : String(error)
      });

      return null;
    }
  }

  async placeOrder(
    market: NormalizedCryptoMarket,
    stakeUsd: number,
    entryPrice: number,
    predictedOutcome: "UP" | "DOWN",
    signal?: SignalResult
  ): Promise<PlacedOrderResult> {
    if (!this.clobClient) {
      return { success: false, error: "Trading service not initialized." };
    }

    if (!entryPrice || entryPrice <= 0 || entryPrice >= 1) {
      return { success: false, error: `Invalid entry price: ${entryPrice}` };
    }

    if (!Number.isFinite(stakeUsd) || stakeUsd <= 0) {
      return { success: false, error: `Invalid stake USD: ${stakeUsd}` };
    }

    const realOrderGate = validateRealOrderGate({
      signal,
      entryPrice,
      predictedOutcome
    });

    if (!realOrderGate.allowed) {
      this.logger?.warn("Real order blocked by final trading gate.", {
        market: market.question,
        outcome: predictedOutcome,
        stakeUsd,
        entryPrice,
        blockedReason: realOrderGate.blockedReason,
        reason: realOrderGate.reason
      });

      return {
        success: false,
        error: `Real order blocked: ${realOrderGate.blockedReason}. ${realOrderGate.reason}`
      };
    }

    try {
      const balanceInfo = await this.getUsdcBalance(true);

      if (!balanceInfo) {
        return { success: false, error: "Failed to fetch balance." };
      }

      if (balanceInfo.balanceUsd < stakeUsd) {
        return {
          success: false,
          error: `Insufficient USDC balance: ${balanceInfo.balanceUsd.toFixed(2)} < ${stakeUsd}`
        };
      }

      if (balanceInfo.allowanceUsd < stakeUsd) {
        this.logger?.info("Updating CLOB allowance...");

        await this.clobClient.updateBalanceAllowance({
          asset_type: AssetType.COLLATERAL
        });

        this.logger?.info("CLOB allowance updated.");
      }

      const tokenId = this.getTokenId(market, predictedOutcome);

      if (!tokenId) {
        return { success: false, error: "Token ID not found for outcome." };
      }

      const size = stakeUsd / entryPrice;

      const response = await this.clobClient.createAndPostOrder(
        {
          tokenID: tokenId,
          price: entryPrice,
          size,
          side: Side.BUY
        },
        {},
        OrderType.GTC
      );

      const orderId = response?.id ?? response?.orderId ?? response?.orderID ?? null;

      if (orderId) {
        this.logger?.info("Real order placed successfully.", {
          orderId,
          market: market.question,
          outcome: predictedOutcome,
          stakeUsd,
          entryPrice,
          size,
          similarCases: readNumberFeature(signal, "similarCases"),
          historicalWinRate: readNumberFeature(signal, "historicalWinRate"),
          historicalProfit: readNumberFeature(signal, "historicalProfit"),
          blockedByHistoricalGate: readBooleanFeature(signal, "blockedByHistoricalGate")
        });

        return { success: true, orderId };
      }

      return { success: false, error: "Order placement returned no ID." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger?.error("Failed to place real order.", {
        market: market.question,
        outcome: predictedOutcome,
        stakeUsd,
        entryPrice,
        error: message
      });

      return { success: false, error: message };
    }
  }

  async placeMarketBuy(
    tokenId: string,
    budgetUsd: number,
    maximumPrice: number
  ): Promise<MarketOrderExecutionResult> {
    if (!this.clobClient) {
      return { success: false, error: "Trading service not initialized." };
    }

    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 3) {
      return { success: false, error: `Invalid live short-exit budget: ${budgetUsd}` };
    }

    if (!isValidPrice(maximumPrice)) {
      return { success: false, error: `Invalid maximum buy price: ${maximumPrice}` };
    }

    const balanceInfo = await this.getUsdcBalance(true);
    if (!balanceInfo || balanceInfo.balanceUsd < budgetUsd) {
      return {
        success: false,
        error: `Insufficient USDC balance for $${budgetUsd.toFixed(2)} market buy.`
      };
    }

    try {
      const response = await this.clobClient.createAndPostMarketOrder(
        {
          tokenID: tokenId,
          amount: budgetUsd,
          price: maximumPrice,
          side: Side.BUY,
          orderType: OrderType.FAK,
          userUSDCBalance: budgetUsd
        },
        {},
        OrderType.FAK
      );
      return await this.normalizeMarketOrderResponse(response, "BUY");
    } catch (error) {
      return failedExecution(error);
    }
  }

  async getOrderbook(tokenId: string): Promise<{ asks: { price: string; size: string }[]; bids: { price: string; size: string }[] } | null> {
    if (!this.clobClient) return null;
    try {
      return await this.clobClient.getOrderBook(tokenId);
    } catch {
      return null;
    }
  }

  async placeFokMarketBuy(
    tokenId: string,
    budgetUsd: number,
    maximumPrice: number
  ): Promise<MarketOrderExecutionResult> {
    if (!this.clobClient) {
      return { success: false, error: "Trading service not initialized." };
    }

    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 3) {
      return { success: false, error: `Invalid live outcome budget: ${budgetUsd}` };
    }

    if (!isValidPrice(maximumPrice)) {
      return { success: false, error: `Invalid maximum FOK buy price: ${maximumPrice}` };
    }

    const balanceInfo = await this.getUsdcBalance(true);
    if (!balanceInfo || balanceInfo.balanceUsd < budgetUsd) {
      return {
        success: false,
        error: `Insufficient USDC balance for $${budgetUsd.toFixed(2)} FOK buy.`
      };
    }

    try {
      const response = await this.clobClient.createAndPostMarketOrder(
        {
          tokenID: tokenId,
          amount: budgetUsd,
          price: maximumPrice,
          side: Side.BUY,
          orderType: OrderType.FOK,
          userUSDCBalance: budgetUsd
        },
        {},
        OrderType.FOK
      );
      return await this.normalizeMarketOrderResponse(response, "BUY");
    } catch (error) {
      return failedExecution(error);
    }
  }

  async placeMarketSell(
    tokenId: string,
    shares: number,
    minimumPrice: number
  ): Promise<MarketOrderExecutionResult> {
    if (!this.clobClient) {
      return { success: false, error: "Trading service not initialized." };
    }

    if (!Number.isFinite(shares) || shares <= 0) {
      return { success: false, error: `Invalid shares to sell: ${shares}` };
    }

    if (!isValidPrice(minimumPrice)) {
      return { success: false, error: `Invalid minimum sell price: ${minimumPrice}` };
    }

    try {
      await this.clobClient.updateBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: tokenId
      });

      const response = await this.clobClient.createAndPostMarketOrder(
        {
          tokenID: tokenId,
          amount: shares,
          price: minimumPrice,
          side: Side.SELL,
          orderType: OrderType.FAK
        },
        {},
        OrderType.FAK
      );

      return await this.normalizeMarketOrderResponse(response, "SELL");
    } catch (error) {
      return failedExecution(error);
    }
  }

  private async normalizeMarketOrderResponse(
    response: Record<string, unknown> | null | undefined,
    side: "BUY" | "SELL"
  ): Promise<MarketOrderExecutionResult> {
    const orderId = readString(response, ["id", "orderId", "orderID"]);
    const status = readString(response, ["status"]);
    let makingAmount = readFiniteNumber(response?.makingAmount);
    let takingAmount = readFiniteNumber(response?.takingAmount);

    if (orderId && (makingAmount === null || takingAmount === null)) {
      try {
        const order = await this.clobClient!.getOrder(orderId);
        const matchedShares = readFiniteNumber(order.size_matched);
        const price = readFiniteNumber(order.price);
        if (matchedShares !== null && price !== null) {
          if (side === "BUY") {
            makingAmount = matchedShares * price;
            takingAmount = matchedShares;
          } else {
            makingAmount = matchedShares;
            takingAmount = matchedShares * price;
          }
        }
      } catch {
        // FAK orders may disappear from the open-order endpoint immediately.
      }
    }

    const filledShares = side === "BUY" ? takingAmount : makingAmount;
    const cashAmount = side === "BUY" ? makingAmount : takingAmount;
    const successFlag = response?.success;
    const error = readString(response, ["error", "errorMsg"]);
    const success =
      successFlag !== false &&
      filledShares !== null &&
      cashAmount !== null &&
      filledShares > 0 &&
      cashAmount > 0;

    return {
      success,
      orderId: orderId ?? undefined,
      status: status ?? undefined,
      filledShares: filledShares ?? undefined,
      cashAmount: cashAmount ?? undefined,
      averagePrice:
        filledShares && cashAmount ? cashAmount / filledShares : undefined,
      error: success ? undefined : error ?? "Market order returned no confirmed fill.",
      raw: response
    };
  }

  private getTokenId(market: NormalizedCryptoMarket, outcome: "UP" | "DOWN"): string | null {
    const outcomeData = market.outcomes?.find((o) => o.normalizedName === outcome);
    return outcomeData?.externalTokenId ?? null;
  }
}

function isValidPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 1;
}

function readString(
  value: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return null;
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function failedExecution(error: unknown): MarketOrderExecutionResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

function validateRealOrderGate(params: {
  signal?: SignalResult;
  entryPrice: number;
  predictedOutcome: "UP" | "DOWN";
}): { allowed: true } | { allowed: false; blockedReason: string; reason: string } {
  const { signal, entryPrice, predictedOutcome } = params;

  if (!signal) {
    return {
      allowed: false,
      blockedReason: "MISSING_SIGNAL_FOR_REAL_ORDER",
      reason:
        "No se recibio la senal completa en placeOrder. " +
        "Para operar real, placeOrder debe recibir el SignalResult generado por SignalEngine."
    };
  }

  if (signal.recommendation !== "ENTER_SMALL" && signal.recommendation !== "ENTER_MODERATE") {
    return {
      allowed: false,
      blockedReason: "SIGNAL_NOT_ENTRY",
      reason: `La senal final no es de entrada. recommendation=${signal.recommendation}.`
    };
  }

  const blockedByHistoricalGate = readBooleanFeature(signal, "blockedByHistoricalGate");

  if (blockedByHistoricalGate === true) {
    return {
      allowed: false,
      blockedReason: "BLOCKED_BY_HISTORICAL_GATE",
      reason: "La senal ya venia bloqueada por la compuerta historica."
    };
  }

  const similarCases = readNumberFeature(signal, "similarCases");
  const historicalWinRate = readNumberFeature(signal, "historicalWinRate");
  const historicalProfit = readNumberFeature(signal, "historicalProfit");
  const secondsToClose = readNumberFeature(signal, "secondsToClose");

  if (similarCases === null || similarCases < REAL_ORDER_MIN_SIMILAR_CASES) {
    return {
      allowed: false,
      blockedReason: "INSUFFICIENT_SIMILAR_CASES",
      reason:
        `similarCases=${similarCases ?? "null"}. ` +
        `Minimo requerido: ${REAL_ORDER_MIN_SIMILAR_CASES}.`
    };
  }

  if (historicalWinRate === null || historicalWinRate < REAL_ORDER_MIN_HISTORICAL_WIN_RATE) {
    return {
      allowed: false,
      blockedReason: "LOW_HISTORICAL_WIN_RATE",
      reason:
        `historicalWinRate=${historicalWinRate ?? "null"}. ` +
        `Minimo requerido: ${REAL_ORDER_MIN_HISTORICAL_WIN_RATE}.`
    };
  }

  if (historicalProfit === null || historicalProfit <= REAL_ORDER_MIN_HISTORICAL_PROFIT) {
    return {
      allowed: false,
      blockedReason: "NON_POSITIVE_HISTORICAL_PROFIT",
      reason:
        `historicalProfit=${historicalProfit ?? "null"}. ` +
        `Debe ser mayor a ${REAL_ORDER_MIN_HISTORICAL_PROFIT}.`
    };
  }

  if (secondsToClose === null) {
    return {
      allowed: false,
      blockedReason: "MISSING_SECONDS_TO_CLOSE",
      reason: "No se encontro secondsToClose en signal.features."
    };
  }

  if (secondsToClose > REAL_ORDER_MAX_SECONDS_TO_CLOSE) {
    return {
      allowed: false,
      blockedReason: "TOO_EARLY_FOR_REAL_ORDER",
      reason:
        `secondsToClose=${secondsToClose}. ` +
        `Maximo permitido: ${REAL_ORDER_MAX_SECONDS_TO_CLOSE}.`
    };
  }

  if (
    predictedOutcome === "DOWN" &&
    entryPrice < REAL_ORDER_CHEAP_DOWN_ENTRY_PRICE &&
    secondsToClose > REAL_ORDER_CHEAP_DOWN_MIN_SECONDS_TO_CLOSE
  ) {
    return {
      allowed: false,
      blockedReason: "CHEAP_DOWN_EARLY_RISK",
      reason:
        `DOWN barato y temprano: entryPrice=${entryPrice}, secondsToClose=${secondsToClose}. ` +
        "Este patron queda bloqueado para orden real."
    };
  }

  return { allowed: true };
}

function readNumberFeature(signal: SignalResult | undefined, key: string): number | null {
  const value = signal?.features?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function readBooleanFeature(signal: SignalResult | undefined, key: string): boolean | null {
  const value = signal?.features?.[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }

    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return null;
}
