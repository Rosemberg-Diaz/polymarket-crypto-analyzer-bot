import { Prisma } from "@prisma/client";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { calculateCryptoTakerFee } from "../backtesting/short-term-exit-backtest.service";
import { LoggerService } from "../logger/logger.service";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import { executeSellDepth } from "../simulations/realistic-short-exit-execution.service";
import {
  MarketOrderExecutionResult,
  PolymarketTradingService
} from "./polymarket-trading.service";

const TAKE_PROFIT_ROI = 0.02;
const START_LIQUIDATION_SECONDS = 60;
const STOP_LIQUIDATION_SECONDS = 20;
const TAKER_FEE_RATE = 0.07;
const EPSILON = 0.000001;
const DUST_SHARE_THRESHOLD = 0.01;
const MAX_ENTRY_SLIPPAGE = 0.02;

export interface LiveShortExitEntryInput {
  observationId: string;
  marketId: string;
  assetSymbol: string;
  outcome: "UP" | "DOWN";
  timeframe: string;
  strategyVersion: string;
  entryAsk: number;
  entrySpread: number;
  entryTrigger: string;
  tokenId: string;
}

export class LiveShortExitTradingService {
  constructor(
    private readonly tradingService: PolymarketTradingService,
    private readonly logger: LoggerService
  ) {}

  isEnabled(): boolean {
    return config.appMode === "LIVE_TRADING" &&
      config.enableRealTrading &&
      config.enableShortExitRealTrading &&
      this.tradingService.isReady();
  }

  async tryOpen(input: LiveShortExitEntryInput): Promise<void> {
    if (
      !this.isEnabled() ||
      !input.tokenId ||
      !isLiveShortExitEntryEligible(
        input.assetSymbol,
        input.timeframe,
        input.entryAsk,
        input.entrySpread,
        input.entryTrigger
      )
    ) {
      return;
    }

    const existing = await prisma.liveShortExitTrade.findUnique({
      where: { observationId: input.observationId },
      include: {
        orders: {
          where: { side: "BUY" }
        }
      }
    });
    if (
      existing &&
      (
        existing.status !== "ENTRY_FAILED" ||
        Number(existing.sharesBought) > EPSILON ||
        existing.orders.length >= 2
      )
    ) {
      return;
    }

    const trade = existing
      ? await prisma.liveShortExitTrade.update({
          where: { id: existing.id },
          data: {
            status: "ENTRY_ATTEMPTING",
            entryPrice: decimal(input.entryAsk),
            errorMessage: null
          }
        })
      : await prisma.liveShortExitTrade.create({
          data: {
            observationId: input.observationId,
            marketId: input.marketId,
            assetSymbol: input.assetSymbol,
            outcome: input.outcome,
            tokenId: input.tokenId,
            strategyVersion: input.strategyVersion,
            budget: decimal(config.shortExitRealStakeUsd),
            entryPrice: decimal(input.entryAsk)
          }
        });
    const order = await prisma.liveShortExitOrder.create({
      data: {
        tradeId: trade.id,
        side: "BUY",
        status: "ATTEMPTING",
        requestedAmount: decimal(config.shortExitRealStakeUsd),
        requestedPrice: decimal(input.entryAsk)
      }
    });

    const result = await this.tradingService.placeMarketBuy(
      input.tokenId,
      config.shortExitRealStakeUsd,
      Math.min(
        config.shortExitRealEntryPriceMax,
        input.entryAsk + MAX_ENTRY_SLIPPAGE
      )
    );
    await this.recordEntryResult(trade.id, order.id, result);
  }

  async tryExit(input: {
    observationId: string;
    secondsToClose: number;
    orderBook: PolymarketOrderBook | null;
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const trade = await prisma.liveShortExitTrade.findUnique({
      where: { observationId: input.observationId }
    });
    if (!trade || !["ACTIVE", "LIQUIDATING"].includes(trade.status)) {
      return;
    }

    if (input.secondsToClose <= STOP_LIQUIDATION_SECONDS) {
      await prisma.liveShortExitTrade.update({
        where: { id: trade.id },
        data: {
          status: "HOLD_TO_RESOLUTION",
          exitTrigger: trade.exitTrigger ?? "NO_EXECUTABLE_EXIT_BEFORE_CLOSE",
          errorMessage: "La posicion restante requiere resolucion/redencion posterior."
        }
      });
      return;
    }

    if (!input.orderBook) {
      return;
    }

    const remainingShares = Number(trade.remainingShares);
    if (remainingShares <= DUST_SHARE_THRESHOLD) {
      await prisma.liveShortExitTrade.update({
        where: { id: trade.id },
        data: {
          status: "HOLD_TO_RESOLUTION",
          exitTrigger: trade.exitTrigger ?? "RESIDUAL_DUST",
          errorMessage:
            `Residual de ${remainingShares} acciones por debajo del minimo ejecutable.`
        }
      });
      return;
    }

    const preview = executeSellDepth(input.orderBook.bids, remainingShares);
    if (preview.shares <= EPSILON) {
      return;
    }

    const currentProceeds = Number(trade.sellProceeds);
    const projectedProfit =
      currentProceeds + preview.netValue - Number(trade.entryCost);
    const projectedRoi = projectedProfit / Number(trade.entryCost);
    const takeProfit =
      preview.fullyFilled && projectedRoi >= TAKE_PROFIT_ROI;
    const liquidate =
      trade.status === "LIQUIDATING" ||
      takeProfit ||
      input.secondsToClose <= START_LIQUIDATION_SECONDS;
    if (!liquidate) {
      return;
    }

    const minimumPrice = preview.fills.at(-1)?.price;
    if (!minimumPrice) {
      return;
    }

    const order = await prisma.liveShortExitOrder.create({
      data: {
        tradeId: trade.id,
        side: "SELL",
        status: "ATTEMPTING",
        requestedAmount: decimal(preview.shares),
        requestedPrice: decimal(minimumPrice)
      }
    });
    const result = await this.tradingService.placeMarketSell(
      trade.tokenId,
      preview.shares,
      minimumPrice
    );
    await this.recordExitResult(
      trade.id,
      order.id,
      result,
      takeProfit ? "TAKE_PROFIT_DEPTH" : "LAST_MINUTE_FAK"
    );
  }

  private async recordEntryResult(
    tradeId: string,
    orderId: string,
    result: MarketOrderExecutionResult
  ): Promise<void> {
    if (!result.success || !result.filledShares || !result.cashAmount) {
      const error = result.error ?? "La compra FAK no produjo un fill confirmado.";
      await prisma.$transaction([
        prisma.liveShortExitOrder.update({
          where: { id: orderId },
          data: orderFailureData(result, error)
        }),
        prisma.liveShortExitTrade.update({
          where: { id: tradeId },
          data: { status: "ENTRY_FAILED", errorMessage: error }
        })
      ]);
      this.logger.warn("Live short-exit BUY failed.", { tradeId, error });
      return;
    }

    const averagePrice = result.averagePrice ??
      result.cashAmount / result.filledShares;
    const estimatedFee = calculateCryptoTakerFee(
      result.filledShares,
      averagePrice,
      TAKER_FEE_RATE
    );
    const entryCost = result.cashAmount + estimatedFee;
    await prisma.$transaction([
      prisma.liveShortExitOrder.update({
        where: { id: orderId },
        data: orderSuccessData(result)
      }),
      prisma.liveShortExitTrade.update({
        where: { id: tradeId },
        data: {
          status: "ACTIVE",
          entryCost: decimal(entryCost),
          sharesBought: decimal(result.filledShares),
          remainingShares: decimal(result.filledShares),
          estimatedFees: decimal(estimatedFee),
          openedAt: new Date(),
          errorMessage: null
        }
      })
    ]);
    this.logger.info("Live short-exit BUY filled.", {
      tradeId,
      orderId: result.orderId,
      shares: result.filledShares,
      cashAmount: result.cashAmount,
      entryCost,
      averagePrice
    });
  }

  private async recordExitResult(
    tradeId: string,
    orderId: string,
    result: MarketOrderExecutionResult,
    exitTrigger: string
  ): Promise<void> {
    const trade = await prisma.liveShortExitTrade.findUniqueOrThrow({
      where: { id: tradeId }
    });
    if (!result.success || !result.filledShares || !result.cashAmount) {
      const error = result.error ?? "La venta FAK no produjo un fill confirmado.";
      await prisma.$transaction([
        prisma.liveShortExitOrder.update({
          where: { id: orderId },
          data: orderFailureData(result, error)
        }),
        prisma.liveShortExitTrade.update({
          where: { id: tradeId },
          data: {
            status: "LIQUIDATING",
            exitTrigger,
            errorMessage: error
          }
        })
      ]);
      this.logger.warn("Live short-exit SELL did not fill.", { tradeId, error });
      return;
    }

    const averagePrice = result.averagePrice ??
      result.cashAmount / result.filledShares;
    const sellFee = calculateCryptoTakerFee(
      result.filledShares,
      averagePrice,
      TAKER_FEE_RATE
    );
    const sharesSold = Number(trade.sharesSold) + result.filledShares;
    const remainingShares = Math.max(0, Number(trade.sharesBought) - sharesSold);
    const netSellProceeds = result.cashAmount - sellFee;
    const sellProceeds = Number(trade.sellProceeds) + netSellProceeds;
    const estimatedFees = Number(trade.estimatedFees) + sellFee;
    const closed = remainingShares <= EPSILON;
    const residualDust = !closed && remainingShares <= DUST_SHARE_THRESHOLD;
    const profit = sellProceeds - Number(trade.entryCost);
    const roi = profit / Number(trade.entryCost);

    await prisma.$transaction([
      prisma.liveShortExitOrder.update({
        where: { id: orderId },
        data: orderSuccessData(result)
      }),
      prisma.liveShortExitTrade.update({
        where: { id: tradeId },
        data: {
          status: closed ? "CLOSED" : residualDust ? "HOLD_TO_RESOLUTION" : "LIQUIDATING",
          sharesSold: decimal(sharesSold),
          remainingShares: decimal(remainingShares),
          sellProceeds: decimal(sellProceeds),
          estimatedFees: decimal(estimatedFees),
          exitTrigger,
          errorMessage: residualDust
            ? `Residual de ${remainingShares} acciones por debajo del minimo ejecutable.`
            : null,
          ...(closed
            ? {
                profit: decimal(profit),
                roi: decimal(roi),
                closedAt: new Date()
              }
            : {})
        }
      })
    ]);
    this.logger.info("Live short-exit SELL filled.", {
      tradeId,
      orderId: result.orderId,
      filledShares: result.filledShares,
      remainingShares,
      sellProceeds,
      profit: closed ? profit : null,
      roi: closed ? roi : null,
      exitTrigger
    });
  }
}

export function isLiveShortExitEntryEligible(
  assetSymbol: string,
  timeframe: string,
  entryAsk: number,
  entrySpread: number,
  entryTrigger: string
): boolean {
  return timeframe === "5m" &&
    assetSymbol === "BTC" &&
    config.shortExitRealAssets.some((asset) => asset === assetSymbol) &&
    entryAsk >= 0.55 &&
    entryAsk <= 0.60 &&
    entrySpread <= 0.015 &&
    entryTrigger === "RISING_BID_TIGHT_SPREAD";
}

function orderSuccessData(result: MarketOrderExecutionResult) {
  return {
    externalOrderId: result.orderId ?? null,
    status: "FILLED",
    filledShares: decimal(result.filledShares ?? 0),
    cashAmount: decimal(result.cashAmount ?? 0),
    averagePrice:
      result.averagePrice === undefined ? null : decimal(result.averagePrice),
    responseData: safeJson(result.raw),
    errorMessage: null
  };
}

function orderFailureData(result: MarketOrderExecutionResult, error: string) {
  return {
    externalOrderId: result.orderId ?? null,
    status: "FAILED",
    responseData: safeJson(result.raw),
    errorMessage: error
  };
}

function safeJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  const serialized = JSON.stringify(value);
  return serialized.length <= 20_000 ? serialized : serialized.slice(0, 20_000);
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
