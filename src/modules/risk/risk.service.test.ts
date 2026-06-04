import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../database/client";
import { RiskService } from "./risk.service";

vi.mock("../../database/client", () => ({
  prisma: {
    botPrediction: {
      findFirst: vi.fn()
    }
  }
}));

const service = new RiskService();

function makeRiskInput(overrides = {}) {
  return {
    marketId: "m1",
    marketCategory: "CRYPTO",
    assetSymbol: "BTC",
    marketType: "UP_DOWN_SHORT_TERM",
    entryPrice: 0.5,
    spread: 0.02,
    liquidity: 500,
    secondsToClose: 60,
    ...overrides
  };
}

describe("RiskService", () => {
  beforeEach(() => {
    vi.mocked(prisma.botPrediction.findFirst).mockResolvedValue(null);
  });

  it("blocks non crypto markets", async () => {
    const result = await service.evaluateSimulationRequest(makeRiskInput({ marketCategory: "SPORTS" }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no es CRYPTO");
  });

  it("blocks duplicate recent signals", async () => {
    vi.mocked(prisma.botPrediction.findFirst).mockResolvedValue({ id: "p1" } as never);
    const result = await service.evaluateSimulationRequest(makeRiskInput());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("senal reciente");
  });

  it("blocks secondsToClose below 20", async () => {
    const result = await service.evaluateSimulationRequest(makeRiskInput({ secondsToClose: 10 }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cerca del cierre");
  });

  it("blocks assets outside priority assets", async () => {
    const result = await service.evaluateSimulationRequest(makeRiskInput({ assetSymbol: "XRP" }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("PRIORITY_ASSETS");
  });
});
