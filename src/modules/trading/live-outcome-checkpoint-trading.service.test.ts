import { MlOutcomeShadowExecution, Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateDynamicFokBudget,
  getMlOutcomeRealMinConfidence,
  isLiveOutcomeCheckpointEligible,
  shouldRetryFokAtMinimum,
  wouldExceedDailyStopLoss
} from "./live-outcome-checkpoint-trading.service";

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
  it("blocks all 5m segments (deactivated)", () => {
    expect(isLiveOutcomeCheckpointEligible(execution()).allowed).toBe(false);
  });

  it("blocks ETH 5m UP and ETH 5m DOWN (5m deactivated)", () => {
    expect(
      isLiveOutcomeCheckpointEligible(
        execution({
          assetSymbol: "ETH",
          timeframe: "5m",
          predictedOutcome: "UP",
          checkpointSeconds: 30
        })
      ).allowed
    ).toBe(false);

    expect(
      isLiveOutcomeCheckpointEligible(
        execution({
          assetSymbol: "ETH",
          timeframe: "5m",
          predictedOutcome: "DOWN",
          checkpointSeconds: 30
        })
      ).allowed
    ).toBe(false);
  });

  it("blocks non-30s checkpoints for 5m markets", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({ checkpointSeconds: 60 })
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks all 5m UP/DOWN markets (5m deactivated)", () => {
    for (const segment of [
      { assetSymbol: "ETH", predictedOutcome: "UP" },
      { assetSymbol: "SOL", predictedOutcome: "UP" },
      { assetSymbol: "SOL", predictedOutcome: "DOWN" }
    ] as const) {
      const result = isLiveOutcomeCheckpointEligible(
        execution({
          assetSymbol: segment.assetSymbol,
          timeframe: "5m",
          predictedOutcome: segment.predictedOutcome,
          checkpointSeconds: 30
        })
      );
      expect(result.allowed).toBe(false);
    }
  });

  it("blocks XRP 5m DOWN (5m deactivated)", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({
        assetSymbol: "XRP",
        timeframe: "5m",
        predictedOutcome: "DOWN",
        checkpointSeconds: 30
      })
    );

    expect(result.allowed).toBe(false);
  });

  it("blocks 5m markets at checkpoints other than 30s", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({
        assetSymbol: "ETH",
        timeframe: "5m",
        predictedOutcome: "UP",
        checkpointSeconds: 120
      })
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks non-whitelisted BTC 5m DOWN markets", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({ assetSymbol: "BTC", timeframe: "5m", predictedOutcome: "DOWN" })
    );
    expect(result.allowed).toBe(false);
  });

  it("allows only profitable 15m segment checkpoints from the real-pilot review", () => {
    const testCases = [
      { assetSymbol: "BTC", predictedOutcome: "DOWN", checkpointSeconds: 180 },
      { assetSymbol: "BTC", predictedOutcome: "UP", checkpointSeconds: 120 },
      { assetSymbol: "ETH", predictedOutcome: "DOWN", checkpointSeconds: 120 },
      { assetSymbol: "ETH", predictedOutcome: "UP", checkpointSeconds: 60 },
      { assetSymbol: "XRP", predictedOutcome: "DOWN", checkpointSeconds: 120 }
    ];
    for (const tc of testCases) {
      const result = isLiveOutcomeCheckpointEligible(
        execution({
          assetSymbol: tc.assetSymbol,
          timeframe: "15m",
          predictedOutcome: tc.predictedOutcome,
          checkpointSeconds: tc.checkpointSeconds
        })
      );
      expect(result).toEqual({ allowed: true });
    }
  });

  it("blocks 15m segments at non-allowed checkpoints", () => {
    const blockedCases = [
      { assetSymbol: "BTC", predictedOutcome: "DOWN", checkpointSeconds: 120 },
      { assetSymbol: "BTC", predictedOutcome: "DOWN", checkpointSeconds: 60 },
      { assetSymbol: "BTC", predictedOutcome: "UP", checkpointSeconds: 180 },
      { assetSymbol: "BTC", predictedOutcome: "UP", checkpointSeconds: 60 },
      { assetSymbol: "ETH", predictedOutcome: "DOWN", checkpointSeconds: 60 },
      { assetSymbol: "ETH", predictedOutcome: "DOWN", checkpointSeconds: 180 },
      { assetSymbol: "ETH", predictedOutcome: "UP", checkpointSeconds: 120 },
      { assetSymbol: "ETH", predictedOutcome: "UP", checkpointSeconds: 180 },
      { assetSymbol: "SOL", predictedOutcome: "UP", checkpointSeconds: 120 },
      { assetSymbol: "SOL", predictedOutcome: "UP", checkpointSeconds: 180 },
      { assetSymbol: "SOL", predictedOutcome: "UP", checkpointSeconds: 60 },
      { assetSymbol: "XRP", predictedOutcome: "DOWN", checkpointSeconds: 180 },
      { assetSymbol: "XRP", predictedOutcome: "DOWN", checkpointSeconds: 60 }
    ];
    for (const tc of blockedCases) {
      const result = isLiveOutcomeCheckpointEligible(
        execution({
          assetSymbol: tc.assetSymbol,
          timeframe: "15m",
          predictedOutcome: tc.predictedOutcome,
          checkpointSeconds: tc.checkpointSeconds
        })
      );
      expect(result.allowed).toBe(false);
    }
  });

  it("blocks assets outside the segment pilot", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({ assetSymbol: "DOGE", timeframe: "15m", predictedOutcome: "UP" })
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks non-positive expected value for 15m", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({
        assetSymbol: "BTC",
        timeframe: "15m",
        predictedOutcome: "DOWN",
        checkpointSeconds: 180,
        expectedProfit: new Prisma.Decimal(0)
      })
    );
    expect(result.allowed).toBe(false);
  });

  it("allows slippage equal to the cap despite floating point noise", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({
        assetSymbol: "ETH",
        timeframe: "15m",
        predictedOutcome: "DOWN",
        checkpointSeconds: 120,
        slippage: new Prisma.Decimal("0.010000000000000009")
      })
    );

    expect(result).toEqual({ allowed: true });
  });

  it("keeps 5m entries at 0.80 or higher in observation only", () => {
    for (const price of ["0.80", "0.84"]) {
      const result = isLiveOutcomeCheckpointEligible(
        execution({
          assetSymbol: "SOL",
          timeframe: "5m",
          predictedOutcome: "UP",
          worstFillPrice: new Prisma.Decimal(price)
        })
      );

      expect(result.allowed).toBe(false);
    }
  });

  it("allows a 5m entry below 0.80", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({
        assetSymbol: "ETH",
        timeframe: "5m",
        predictedOutcome: "UP",
        worstFillPrice: new Prisma.Decimal("0.79")
      })
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks ETH 5m UP (5m deactivated, no special exemption)", () => {
    const result = isLiveOutcomeCheckpointEligible(
      execution({
        assetSymbol: "ETH",
        timeframe: "5m",
        predictedOutcome: "UP",
        worstFillPrice: new Prisma.Decimal("0.84")
      })
    );
    expect(result.allowed).toBe(false);
    expect(getMlOutcomeRealMinConfidence(execution({
      assetSymbol: "ETH",
      timeframe: "5m",
      predictedOutcome: "UP",
      checkpointSeconds: 30
    }))).toBe(0.70);
  });
});

describe("live outcome checkpoint daily stop", () => {
  it("blocks a new order when its full stake could cross the daily stop", () => {
    expect(wouldExceedDailyStopLoss(-5.38, 0, 3, 9)).toBe(false);
    expect(wouldExceedDailyStopLoss(-5.38, 3, 3, 9)).toBe(true);
    expect(wouldExceedDailyStopLoss(-8.38, 0, 3, 9)).toBe(true);
    expect(wouldExceedDailyStopLoss(-7.60, 0, 1.5, 9)).toBe(true);
  });
});

describe("live outcome checkpoint confidence thresholds", () => {
  it("uses rule-specific thresholds for reviewed live rules", () => {
    expect(getMlOutcomeRealMinConfidence(execution({
      assetSymbol: "BTC",
      timeframe: "15m",
      predictedOutcome: "DOWN",
      checkpointSeconds: 180
    }))).toBe(0.85);
    expect(getMlOutcomeRealMinConfidence(execution({
      assetSymbol: "ETH",
      timeframe: "15m",
      predictedOutcome: "DOWN",
      checkpointSeconds: 120
    }))).toBe(0.90);
    expect(getMlOutcomeRealMinConfidence(execution({
      assetSymbol: "XRP",
      timeframe: "15m",
      predictedOutcome: "DOWN",
      checkpointSeconds: 120
    }))).toBe(0.85);
  });

  it("keeps the default thresholds for rules without overrides", () => {
    expect(getMlOutcomeRealMinConfidence(execution({
      assetSymbol: "ETH",
      timeframe: "5m",
      predictedOutcome: "DOWN"
    }))).toBe(0.70);
    expect(getMlOutcomeRealMinConfidence(execution({
      assetSymbol: "ETH",
      timeframe: "15m",
      predictedOutcome: "UP",
      checkpointSeconds: 60
    }))).toBe(0.85);
  });
});

describe("live outcome checkpoint dynamic FOK budget", () => {
  it("uses only asks at or below the submitted maximum price", () => {
    const budget = calculateDynamicFokBudget(
      [
        { price: "0.60", size: "2" },
        { price: "0.64", size: "100" }
      ],
      0.60,
      3
    );

    expect(budget).toBe(1.23);
  });

  it("floors the budget to cents so it never exceeds visible depth", () => {
    const budget = calculateDynamicFokBudget(
      [{ price: "0.53", size: "3" }],
      0.53,
      3
    );

    expect(budget).toBe(1.64);
  });

  it("caps the dynamic budget at the configured stake", () => {
    const budget = calculateDynamicFokBudget(
      [{ price: "0.80", size: "100" }],
      0.80,
      1.5
    );

    expect(budget).toBe(1.5);
  });
});

describe("live outcome checkpoint immediate minimum retry", () => {
  it("retries a larger FOK when it could not be fully filled", () => {
    expect(shouldRetryFokAtMinimum(3, {
      success: false,
      error: "order couldn't be fully filled. FOK orders are fully filled or killed."
    })).toBe(true);
  });

  it("does not retry technical failures or an existing $1.5 attempt", () => {
    expect(shouldRetryFokAtMinimum(3, {
      success: false,
      error: "order manager not ready, please retry"
    })).toBe(false);
    expect(shouldRetryFokAtMinimum(1.5, {
      success: false,
      error: "order couldn't be fully filled."
    })).toBe(false);
    expect(shouldRetryFokAtMinimum(2.88, {
      success: false,
      error: "order couldn't be fully filled."
    })).toBe(false);
  });
});
