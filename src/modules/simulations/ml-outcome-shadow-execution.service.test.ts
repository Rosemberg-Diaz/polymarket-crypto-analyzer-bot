import { describe, expect, it } from "vitest";
import { evaluateMlOutcomeFokExecution } from "./ml-outcome-shadow-execution.service";

function book(input: {
  asks: Array<[number, number]>;
  minOrderSize?: number;
}) {
  return {
    tokenId: "token-up",
    bids: [],
    asks: input.asks.map(([price, size]) => ({
      price: String(price),
      size: String(size)
    })),
    minOrderSize: input.minOrderSize ?? 5,
    tickSize: 0.01,
    timestamp: "1781510000000"
  };
}

describe("ML outcome executable shadow FOK evaluation", () => {
  it("accepts a fully executable entry and includes taker fees", () => {
    const result = evaluateMlOutcomeFokExecution({
      orderBook: book({ asks: [[0.5, 50]] }),
      budget: 5,
      decisionPrice: 0.5,
      modelProbability: 0.7,
      maxSlippage: 0.01
    });

    expect(result.status).toBe("PENDING");
    expect(result.fullyFilled).toBe(true);
    expect(result.shares).toBeGreaterThan(5);
    expect(result.fee).toBeGreaterThan(0);
    expect(result.totalCost).toBeCloseTo(5, 4);
  });

  it("rejects a partial fill because FOK requires full execution", () => {
    const result = evaluateMlOutcomeFokExecution({
      orderBook: book({ asks: [[0.5, 2]] }),
      budget: 5,
      decisionPrice: 0.5,
      modelProbability: 0.7,
      maxSlippage: 0.01
    });

    expect(result.status).toBe("SKIPPED_INSUFFICIENT_DEPTH");
    expect(result.fullyFilled).toBe(false);
  });

  it("rejects an order below the market minimum size", () => {
    const result = evaluateMlOutcomeFokExecution({
      orderBook: book({ asks: [[0.9, 50]], minOrderSize: 10 }),
      budget: 5,
      decisionPrice: 0.9,
      modelProbability: 0.95,
      maxSlippage: 0.01
    });

    expect(result.status).toBe("SKIPPED_MIN_ORDER_SIZE");
  });

  it("rejects fills whose worst price exceeds the slippage cap", () => {
    const result = evaluateMlOutcomeFokExecution({
      orderBook: book({ asks: [[0.52, 50]] }),
      budget: 5,
      decisionPrice: 0.5,
      modelProbability: 0.7,
      maxSlippage: 0.01
    });

    expect(result.status).toBe("SKIPPED_SLIPPAGE");
    expect(result.slippage).toBeCloseTo(0.02, 6);
  });

  it("records unavailable orderbooks as skipped instead of throwing", () => {
    const result = evaluateMlOutcomeFokExecution({
      orderBook: null,
      budget: 5,
      decisionPrice: 0.5,
      modelProbability: 0.7,
      maxSlippage: 0.01
    });

    expect(result.status).toBe("SKIPPED_NO_BOOK");
  });

  it("rejects an executable fill when fees erase the model edge", () => {
    const result = evaluateMlOutcomeFokExecution({
      orderBook: book({ asks: [[0.7, 50]] }),
      budget: 5,
      decisionPrice: 0.7,
      modelProbability: 0.7,
      maxSlippage: 0.01
    });

    expect(result.status).toBe("SKIPPED_NON_POSITIVE_EV");
    expect(result.expectedProfit).toBeLessThan(0);
  });
});
