import { describe, expect, it } from "vitest";
import { calculateOfficialSettlement } from "./resolve-realistic-short-exit-executions.job";

describe("ResolveRealisticShortExitExecutionsJob settlement", () => {
  it("values a winning remainder at one dollar per share", () => {
    const result = calculateOfficialSettlement({
      predictedOutcome: "UP",
      officialWinner: "UP",
      remainingShares: 0.75,
      sellGrossProceeds: 0.4,
      sellFees: 0.01,
      entryCost: 1
    });

    expect(result.settlementValue).toBe(0.75);
    expect(result.finalValue).toBeCloseTo(1.14, 8);
    expect(result.profit).toBeCloseTo(0.14, 8);
  });

  it("values a losing remainder at zero while preserving partial sale proceeds", () => {
    const result = calculateOfficialSettlement({
      predictedOutcome: "DOWN",
      officialWinner: "UP",
      remainingShares: 0.75,
      sellGrossProceeds: 0.4,
      sellFees: 0.01,
      entryCost: 1
    });

    expect(result.settlementValue).toBe(0);
    expect(result.finalValue).toBeCloseTo(0.39, 8);
    expect(result.profit).toBeCloseTo(-0.61, 8);
  });
});
