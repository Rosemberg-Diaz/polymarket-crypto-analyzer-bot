import { describe, expect, it } from "vitest";
import { calculateMlOutcomeSettlement } from "./resolve-ml-outcome-shadow-executions.job";

describe("ML outcome executable shadow settlement", () => {
  it("settles a winning position at one dollar per share", () => {
    const result = calculateMlOutcomeSettlement({
      predictedOutcome: "UP",
      officialWinner: "YES",
      shares: 8,
      totalCost: 5
    });

    expect(result).toEqual({
      isWin: true,
      finalValue: 8,
      profit: 3,
      roi: 0.6
    });
  });

  it("loses only the executed entry cost when the prediction is wrong", () => {
    const result = calculateMlOutcomeSettlement({
      predictedOutcome: "DOWN",
      officialWinner: "UP",
      shares: 8,
      totalCost: 5
    });

    expect(result).toEqual({
      isWin: false,
      finalValue: 0,
      profit: -5,
      roi: -1
    });
  });
});
