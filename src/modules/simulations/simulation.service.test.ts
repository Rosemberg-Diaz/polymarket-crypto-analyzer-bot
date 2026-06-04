import { describe, expect, it } from "vitest";
import { SimulationService } from "./simulation.service";

describe("SimulationService", () => {
  const service = new SimulationService();

  it("calculates a winning trade at entryPrice 0.50 with stake 10", () => {
    const result = service.calculateTradeResult({
      stake: 10,
      entryPrice: 0.5,
      didWin: true
    });

    expect(result).toEqual({
      stake: 10,
      entryPrice: 0.5,
      shares: 20,
      finalValue: 20,
      profit: 10,
      roi: 1,
      isWin: true
    });
  });

  it("calculates a losing trade", () => {
    const result = service.calculateTradeResult({
      stake: 10,
      entryPrice: 0.5,
      didWin: false
    });

    expect(result.finalValue).toBe(0);
    expect(result.profit).toBe(-10);
    expect(result.roi).toBe(-1);
    expect(result.isWin).toBe(false);
  });

  it("rejects invalid entryPrice", () => {
    expect(() =>
      service.calculateTradeResult({
        stake: 10,
        entryPrice: 1,
        didWin: true
      })
    ).toThrow("entryPrice");
  });

  it("rejects invalid stake", () => {
    expect(() =>
      service.calculateTradeResult({
        stake: 0,
        entryPrice: 0.5,
        didWin: true
      })
    ).toThrow("stake");
  });
});
