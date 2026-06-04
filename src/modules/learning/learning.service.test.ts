import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../database/client";
import { LearningService } from "./learning.service";

vi.mock("../../database/client", () => ({
  prisma: {
    simulatedTrade: {
      findMany: vi.fn()
    }
  }
}));

const service = new LearningService();

const baseFeatures = {
  strategyName: "crypto-up-down-short-term-v1",
  marketType: "UP_DOWN_SHORT_TERM",
  assetSymbol: "BTC",
  predictedOutcome: "UP",
  entryPrice: 0.5,
  secondsToClose: 60,
  distanceToTarget: 10,
  spread: 0.02,
  liquidity: 500,
  timeframe: "5m"
};

function makeTrade(isWin: boolean, profit: number, roi: number) {
  return {
    isWin,
    profit,
    roi,
    entryPrice: 0.5,
    prediction: {
      snapshot: {
        secondsToClose: 60,
        distanceToTarget: 10,
        spread: 0.02,
        liquidity: 500
      },
      market: {
        timeframe: "5m"
      }
    }
  };
}

describe("LearningService", () => {
  beforeEach(() => {
    vi.mocked(prisma.simulatedTrade.findMany).mockResolvedValue([]);
  });

  it("does not adjust with fewer than 20 similar cases", async () => {
    vi.mocked(prisma.simulatedTrade.findMany).mockResolvedValue(
      Array.from({ length: 10 }, () => makeTrade(true, 1, 0.1)) as never
    );

    const result = await service.findSimilarHistoricalPerformance(baseFeatures);
    expect(result.totalSimilarCases).toBe(10);
    expect(result.confidenceAdjustment).toBe(0);
    expect(result.historicalSummary).toContain("no hay suficientes casos");
  });

  it("raises confidence when winRate is above 60% and profit is positive", async () => {
    vi.mocked(prisma.simulatedTrade.findMany).mockResolvedValue(
      [
        ...Array.from({ length: 13 }, () => makeTrade(true, 1, 0.1)),
        ...Array.from({ length: 7 }, () => makeTrade(false, -0.2, -0.02))
      ] as never
    );

    const result = await service.findSimilarHistoricalPerformance(baseFeatures);
    expect(result.winRate).toBeGreaterThan(0.6);
    expect(result.totalProfit).toBeGreaterThan(0);
    expect(result.confidenceAdjustment).toBeGreaterThan(0);
  });

  it("lowers confidence when winRate is below 48% or profit is negative", async () => {
    vi.mocked(prisma.simulatedTrade.findMany).mockResolvedValue(
      [
        ...Array.from({ length: 8 }, () => makeTrade(true, 0.1, 0.01)),
        ...Array.from({ length: 12 }, () => makeTrade(false, -1, -0.1))
      ] as never
    );

    const result = await service.findSimilarHistoricalPerformance(baseFeatures);
    expect(result.winRate).toBeLessThan(0.48);
    expect(result.confidenceAdjustment).toBeLessThan(0);
  });
});
