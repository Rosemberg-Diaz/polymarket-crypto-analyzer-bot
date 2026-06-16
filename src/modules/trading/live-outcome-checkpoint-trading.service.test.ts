import { MlOutcomeShadowExecution, Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isLiveOutcomeCheckpointEligible } from "./live-outcome-checkpoint-trading.service";

function execution(
  overrides: Partial<MlOutcomeShadowExecution> = {}
): MlOutcomeShadowExecution {
  return {
    id: "shadow-1",
    predictionId: "prediction-1",
    marketId: "market-1",
    assetSymbol: "BTC",
    timeframe: "5m",
    predictedOutcome: "UP",
    tokenId: "token-up",
    checkpointSeconds: 30,
    actualSecondsToClose: 29,
    requestedBudget: new Prisma.Decimal(5),
    status: "PENDING",
    skipReason: null,
    minOrderSize: new Prisma.Decimal(5),
    tickSize: new Prisma.Decimal(0.01),
    bestAsk: new Prisma.Decimal(0.6),
    worstFillPrice: new Prisma.Decimal(0.6),
    averageEntryPrice: new Prisma.Decimal(0.6),
    shares: new Prisma.Decimal(8.1),
    grossCost: new Prisma.Decimal(5),
    fee: new Prisma.Decimal(0.01),
    totalCost: new Prisma.Decimal(5),
    slippage: new Prisma.Decimal(0),
    modelProbability: new Prisma.Decimal(0.75),
    expectedProfit: new Prisma.Decimal(1),
    expectedRoi: new Prisma.Decimal(0.2),
    fullyFilled: true,
    bookTimestamp: "1781520000000",
    bookFingerprint: "book",
    officialWinner: null,
    resolutionSource: null,
    isWin: null,
    finalValue: null,
    profit: null,
    roi: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe("live outcome checkpoint pilot gate", () => {
  it("allows executable BTC 5m UP 30s shadow entries", () => {
    expect(isLiveOutcomeCheckpointEligible(execution())).toEqual({ allowed: true });
  });

  it("blocks non-30s checkpoints for 5m markets", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({ checkpointSeconds: 60 })
    );
    expect(result.allowed).toBe(false);
  });

  it("allows whitelisted SOL 15m UP markets at 180s, 120s and 60s", () => {
    for (const checkpointSeconds of [180, 120, 60]) {
      const result = isLiveOutcomeCheckpointEligible(
        execution({
          assetSymbol: "SOL",
          timeframe: "15m",
          predictedOutcome: "UP",
          checkpointSeconds
        })
      );
      expect(result).toEqual({ allowed: true });
    }
  });

  it("blocks whitelisted 15m markets at 30s", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({
        assetSymbol: "SOL",
        timeframe: "15m",
        predictedOutcome: "UP",
        checkpointSeconds: 30
      })
    );
    expect(result).toEqual({
      allowed: false,
      reason: "CHECKPOINT_NOT_ALLOWED_FOR_TIMEFRAME:15m:30"
    });
  });

  it("blocks non-whitelisted BTC 5m DOWN markets", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({ assetSymbol: "BTC", timeframe: "5m", predictedOutcome: "DOWN" })
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks assets outside the segment pilot", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({ assetSymbol: "DOGE", timeframe: "5m", predictedOutcome: "UP" })
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks non-positive expected value", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({ expectedProfit: new Prisma.Decimal(0) })
    );
    expect(result.allowed).toBe(false);
  });

  it("allows slippage equal to the cap despite floating point noise", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({ slippage: new Prisma.Decimal("0.010000000000000009") })
    );

    expect(result).toEqual({ allowed: true });
  });
});
