import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../database/client";
import { ObservationEvaluationService } from "./observation-evaluation.service";

vi.mock("../../database/client", () => ({
  prisma: {
    observationEvaluation: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

describe("ObservationEvaluationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a separate pending shadow evaluation", async () => {
    vi.mocked(prisma.observationEvaluation.upsert).mockResolvedValue({ id: "obs-1" } as never);
    const service = new ObservationEvaluationService();

    await service.createPendingObservation("prediction-1", "market-1", "OBSERVE_MODERATE_STANDARD", 5, 0.5);

    expect(prisma.observationEvaluation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          predictionId: "prediction-1"
        },
        create: expect.objectContaining({
          observationType: "OBSERVE_MODERATE_STANDARD",
          status: "PENDING"
        })
      })
    );
  });

  it("supports LIGHT observations independently from MODERATE observations", async () => {
    vi.mocked(prisma.observationEvaluation.upsert).mockResolvedValue({ id: "obs-light" } as never);
    const service = new ObservationEvaluationService();

    await service.createPendingObservation(
      "prediction-light",
      "market-1",
      "OBSERVE_SMALL_LIGHT",
      5,
      0.65
    );

    expect(prisma.observationEvaluation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          predictionId: "prediction-light"
        },
        create: expect.objectContaining({
          observationType: "OBSERVE_SMALL_LIGHT",
          status: "PENDING"
        })
      })
    );
  });

  it("resolves hypothetical profit without creating a SimulatedTrade", async () => {
    vi.mocked(prisma.observationEvaluation.findUnique).mockResolvedValue({
      id: "obs-1",
      hypotheticalStake: 5,
      entryPrice: 0.5
    } as never);
    vi.mocked(prisma.observationEvaluation.update).mockResolvedValue({ id: "obs-1" } as never);
    const service = new ObservationEvaluationService();

    await service.resolveObservation("obs-1", true, "UP:GAMMA_OUTCOME_PRICES", "GAMMA_OUTCOME_PRICES");

    expect(prisma.observationEvaluation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "RESOLVED",
          wouldWin: true,
          hypotheticalProfit: expect.objectContaining({})
        })
      })
    );
  });
});
