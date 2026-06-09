import { createWalletClient, http, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  Side
} from "@polymarket/clob-client-v2";
import { LoggerService } from "../logger/logger.service";
import { NormalizedCryptoMarket } from "../crypto/crypto-market.types";

const CLOB_API_URL = "https://clob.polymarket.com";
const CHAIN_ID = 137;

export interface PlacedOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

export class PolymarketTradingService {
  private clobClient: ClobClient | null = null;
  private initialized = false;

  constructor(
    private readonly privateKey: string,
    private readonly walletAddress: string,
    private readonly logger?: LoggerService
  ) {}

  async initialize(): Promise<boolean> {
    try {
      const account = privateKeyToAccount(this.privateKey as Hex);
      const walletClient = createWalletClient({
        account,
        chain: polygon,
        transport: http()
      });

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
        signatureType: 1,
        funderAddress: this.walletAddress
      });

      this.initialized = true;
      this.logger?.info("Polymarket trading service initialized successfully.");
      return true;
    } catch (error) {
      this.logger?.error("Failed to initialize Polymarket trading service.", {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async getUsdcBalance(): Promise<number | null> {
    if (!this.clobClient) {
      this.logger?.warn("Trading service not initialized.");
      return null;
    }

    try {
      const balance = await this.clobClient.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL
      });
      const balanceNum = Number(balance?.balance ?? 0);
      return balanceNum > 0 ? balanceNum / 1e6 : 0;
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
    predictedOutcome: "UP" | "DOWN"
  ): Promise<PlacedOrderResult> {
    if (!this.clobClient) {
      return { success: false, error: "Trading service not initialized." };
    }

    if (!entryPrice || entryPrice <= 0 || entryPrice >= 1) {
      return { success: false, error: `Invalid entry price: ${entryPrice}` };
    }

    try {
      const balance = await this.clobClient.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL
      });
      const usdcBalance = Number(balance?.balance ?? 0) / 1e6;
      if (usdcBalance < stakeUsd) {
        return { success: false, error: `Insufficient USDC balance: ${usdcBalance.toFixed(2)} < ${stakeUsd}` };
      }
      const currentAllowance = Number(balance?.allowances?.["0x"] ?? 0) / 1e6;
      if (currentAllowance < stakeUsd) {
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

      const orderId = response?.id ?? response?.orderId ?? null;
      if (orderId) {
        this.logger?.info("Real order placed successfully.", {
          orderId,
          market: market.question,
          outcome: predictedOutcome,
          stakeUsd,
          entryPrice,
          size
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

  private getTokenId(market: NormalizedCryptoMarket, outcome: "UP" | "DOWN"): string | null {
    const outcomeData = market.outcomes?.find(
      (o) => o.normalizedName === outcome
    );
    return outcomeData?.externalTokenId ?? null;
  }
}
