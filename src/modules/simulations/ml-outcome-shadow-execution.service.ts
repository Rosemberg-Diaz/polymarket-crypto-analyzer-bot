import { MlOutcomeShadowExecution, Prisma } from "@prisma/client";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import {
  PolymarketOrderBook,
  PolymarketOrderBookLevel
} from "../polymarket/polymarket.types";
import {
  DepthExecution,
  executeBuyDepth,
  fingerprintBook
} from "./realistic-short-exit-execution.service";

const EPSILON = 0.000001;

export type MlOutcomeShadowExecutionStatus =
  | "PENDING"
  | "RESOLVED"
  | "SKIPPED_NO_BOOK"
  | "SKIPPED_NO_ASKS"
  | "SKIPPED_INSUFFICIENT_DEPTH"
  | "SKIPPED_MIN_ORDER_SIZE"
  | "SKIPPED_SLIPPAGE"
  | "SKIPPED_NON_POSITIVE_EV";

export interface MlOutcomeExecutionEvaluation {
  status: MlOutcomeShadowExecutionStatus;
  skipReason: string | null;
  minOrderSize: number | null;
  tickSize: number | null;
  bestAsk: number | null;
  worstFillPrice: number | null;
  averageEntryPrice: number | null;
  shares: number | null;
  grossCost: number | null;
  fee: number | null;
  totalCost: number | null;
  slippage: number | null;
  modelProbability: number | null;
  expectedProfit: number | null;
  expectedRoi: number | null;
  fullyFilled: boolean;
  bookTimestamp: string | null;
  bookFingerprint: string | null;
}

export class MlOutcomeShadowExecutionService {
  constructor(private readonly logger: LoggerService) {}

  async createForPrediction(input: {
    predictionId: string;
    marketId: string;
    assetSymbol: string;
    timeframe: string;
    predictedOutcome: string;
    tokenId: string;
    checkpointSeconds: number;
    actualSecondsToClose: number;
    decisionPrice: number;
    modelProbability: number;
    orderBook: PolymarketOrderBook | null;
  }): Promise<MlOutcomeShadowExecution | null> {
    const existing = await prisma.mlOutcomeShadowExecution.findUnique({
      where: {
        marketId_checkpointSeconds: {
          marketId: input.marketId,
          checkpointSeconds: input.checkpointSeconds
        }
      },
      select: { id: true }
    });
    if (existing) {
      return null;
    }

    const evaluation = evaluateMlOutcomeFokExecution({
      orderBook: input.orderBook,
      budget: config.mlOutcomeExecutionBudgetUsd,
      decisionPrice: input.decisionPrice,
      modelProbability: input.modelProbability,
      maxSlippage: config.mlOutcomeExecutionMaxSlippage
    });

    const execution = await prisma.mlOutcomeShadowExecution.create({
      data: {
        predictionId: input.predictionId,
        marketId: input.marketId,
        assetSymbol: input.assetSymbol,
        timeframe: input.timeframe,
        predictedOutcome: input.predictedOutcome,
        tokenId: input.tokenId,
        checkpointSeconds: input.checkpointSeconds,
        actualSecondsToClose: input.actualSecondsToClose,
        requestedBudget: decimal(config.mlOutcomeExecutionBudgetUsd),
        status: evaluation.status,
        skipReason: evaluation.skipReason,
        minOrderSize: optionalDecimal(evaluation.minOrderSize),
        tickSize: optionalDecimal(evaluation.tickSize),
        bestAsk: optionalDecimal(evaluation.bestAsk),
        worstFillPrice: optionalDecimal(evaluation.worstFillPrice),
        averageEntryPrice: optionalDecimal(evaluation.averageEntryPrice),
        shares: optionalDecimal(evaluation.shares),
        grossCost: optionalDecimal(evaluation.grossCost),
        fee: optionalDecimal(evaluation.fee),
        totalCost: optionalDecimal(evaluation.totalCost),
        slippage: optionalDecimal(evaluation.slippage),
        modelProbability: optionalDecimal(evaluation.modelProbability),
        expectedProfit: optionalDecimal(evaluation.expectedProfit),
        expectedRoi: optionalDecimal(evaluation.expectedRoi),
        fullyFilled: evaluation.fullyFilled,
        latencyMs: config.mlOutcomeExecutionLatencyMs,
        bookTimestamp: evaluation.bookTimestamp,
        bookFingerprint: evaluation.bookFingerprint
      }
    });

    const context = {
      marketId: input.marketId,
      assetSymbol: input.assetSymbol,
      timeframe: input.timeframe,
      predictedOutcome: input.predictedOutcome,
      status: evaluation.status,
      skipReason: evaluation.skipReason,
      budget: config.mlOutcomeExecutionBudgetUsd,
      decisionPrice: input.decisionPrice,
      averageEntryPrice: evaluation.averageEntryPrice,
      shares: evaluation.shares,
      fee: evaluation.fee,
      slippage: evaluation.slippage,
      modelProbability: evaluation.modelProbability,
      expectedProfit: evaluation.expectedProfit,
      expectedRoi: evaluation.expectedRoi,
      latencyMs: config.mlOutcomeExecutionLatencyMs
    };
    if (evaluation.status === "PENDING") {
      this.logger.info("ML outcome executable shadow entry accepted.", context);
    } else {
      this.logger.info("ML outcome executable shadow entry skipped.", context);
    }

    return execution;
  }
}

export function evaluateMlOutcomeFokExecution(input: {
  orderBook: PolymarketOrderBook | null;
  budget: number;
  decisionPrice: number;
  modelProbability: number;
  maxSlippage: number;
}): MlOutcomeExecutionEvaluation {
  if (!input.orderBook) {
    return skipped(
      "SKIPPED_NO_BOOK",
      "Orderbook unavailable after simulated latency.",
      undefined,
      input.modelProbability
    );
  }

  const asks = normalizeAsks(input.orderBook.asks);
  if (asks.length === 0) {
    return skipped(
      "SKIPPED_NO_ASKS",
      "Orderbook has no executable asks.",
      input.orderBook,
      input.modelProbability
    );
  }

  const purchase = executeBuyDepth(input.orderBook.asks, input.budget);
  const bestAsk = asks[0].price;
  const worstFillPrice = getWorstFillPrice(purchase);
  const slippage = worstFillPrice === null
    ? null
    : worstFillPrice - input.decisionPrice;
  const common = executionFields(
    input.orderBook,
    purchase,
    bestAsk,
    slippage,
    input.modelProbability
  );

  if (!purchase.fullyFilled) {
    return {
      ...common,
      status: "SKIPPED_INSUFFICIENT_DEPTH",
      skipReason: "Available asks cannot fill the complete FOK budget."
    };
  }

  const minOrderSize = input.orderBook.minOrderSize ?? null;
  if (
    minOrderSize !== null &&
    minOrderSize > 0 &&
    purchase.shares + EPSILON < minOrderSize
  ) {
    return {
      ...common,
      status: "SKIPPED_MIN_ORDER_SIZE",
      skipReason:
        `Filled shares ${purchase.shares.toFixed(6)} are below ` +
        `market minimum ${minOrderSize.toFixed(6)}.`
    };
  }

  if (
    slippage === null ||
    slippage > input.maxSlippage + EPSILON
  ) {
    return {
      ...common,
      status: "SKIPPED_SLIPPAGE",
      skipReason:
        `Worst fill exceeds decision price by ${formatPrice(slippage)}; ` +
        `maximum allowed is ${input.maxSlippage.toFixed(4)}.`
    };
  }

  if ((common.expectedProfit ?? Number.NEGATIVE_INFINITY) <= 0) {
    return {
      ...common,
      status: "SKIPPED_NON_POSITIVE_EV",
      skipReason:
        `Expected net profit is ${formatMoney(common.expectedProfit)} ` +
        `after entry fees.`
    };
  }

  return {
    ...common,
    status: "PENDING",
    skipReason: null
  };
}

function executionFields(
  orderBook: PolymarketOrderBook,
  purchase: DepthExecution,
  bestAsk: number,
  slippage: number | null,
  modelProbability: number
): MlOutcomeExecutionEvaluation {
  const expectedFinalValue = modelProbability * purchase.shares;
  const expectedProfit = expectedFinalValue - purchase.netValue;
  return {
    status: "PENDING",
    skipReason: null,
    minOrderSize: orderBook.minOrderSize ?? null,
    tickSize: orderBook.tickSize ?? null,
    bestAsk,
    worstFillPrice: getWorstFillPrice(purchase),
    averageEntryPrice: purchase.averagePrice || null,
    shares: purchase.shares || null,
    grossCost: purchase.grossValue || null,
    fee: purchase.fees || null,
    totalCost: purchase.netValue || null,
    slippage,
    modelProbability,
    expectedProfit,
    expectedRoi:
      purchase.netValue > 0 ? expectedProfit / purchase.netValue : null,
    fullyFilled: purchase.fullyFilled,
    bookTimestamp: orderBook.timestamp ?? null,
    bookFingerprint: fingerprintBook(orderBook, "BUY")
  };
}

function skipped(
  status: Exclude<MlOutcomeShadowExecutionStatus, "PENDING" | "RESOLVED">,
  reason: string,
  orderBook?: PolymarketOrderBook,
  modelProbability: number | null = null
): MlOutcomeExecutionEvaluation {
  return {
    status,
    skipReason: reason,
    minOrderSize: orderBook?.minOrderSize ?? null,
    tickSize: orderBook?.tickSize ?? null,
    bestAsk: null,
    worstFillPrice: null,
    averageEntryPrice: null,
    shares: null,
    grossCost: null,
    fee: null,
    totalCost: null,
    slippage: null,
    modelProbability,
    expectedProfit: null,
    expectedRoi: null,
    fullyFilled: false,
    bookTimestamp: orderBook?.timestamp ?? null,
    bookFingerprint: orderBook ? fingerprintBook(orderBook, "BUY") : null
  };
}

function normalizeAsks(levels: PolymarketOrderBookLevel[]) {
  return levels.flatMap((level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    return Number.isFinite(price) &&
      price > 0 &&
      price < 1 &&
      Number.isFinite(size) &&
      size > 0
      ? [{ price, size }]
      : [];
  }).sort((left, right) => left.price - right.price);
}

function getWorstFillPrice(purchase: DepthExecution): number | null {
  return purchase.fills.length > 0
    ? Math.max(...purchase.fills.map((fill) => fill.price))
    : null;
}

function formatPrice(value: number | null): string {
  return value === null ? "unknown" : value.toFixed(4);
}

function formatMoney(value: number | null): string {
  return value === null ? "unknown" : `$${value.toFixed(4)}`;
}

function optionalDecimal(value: number | null): Prisma.Decimal | null {
  return value === null || !Number.isFinite(value) ? null : decimal(value);
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
