import { describe, expect, it } from "vitest";
import {
  predictLogisticProbability,
  trainLogisticRegression
} from "./logistic-regression.service";

describe("logistic regression", () => {
  it("learns a separable local risk pattern", () => {
    const vectors = [
      [0.1, 0.9],
      [0.2, 0.8],
      [0.3, 0.7],
      [0.7, 0.3],
      [0.8, 0.2],
      [0.9, 0.1]
    ];
    const model = trainLogisticRegression(
      vectors,
      [0, 0, 0, 1, 1, 1],
      { epochs: 1_500 }
    );

    expect(predictLogisticProbability([0.85, 0.15], model)).toBeGreaterThan(0.8);
    expect(predictLogisticProbability([0.15, 0.85], model)).toBeLessThan(0.2);
  });

  it("rejects empty training data", () => {
    expect(() => trainLogisticRegression([], [])).toThrow(
      "non-empty and aligned"
    );
  });
});
