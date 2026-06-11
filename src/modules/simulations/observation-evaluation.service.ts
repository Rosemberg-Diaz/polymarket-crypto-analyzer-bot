import { ObservationEvaluation, Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { SimulationService } from "./simulation.service";

export class ObservationEvaluationService {
  constructor(private readonly simulationService = new SimulationService()) {}

  async createPendingObservation(
    predictionId: string,
    marketId: string,
    observationType: string,
    hypotheticalStake: number,
    entryPrice: number
  ): Promise<ObservationEvaluation> {
    const calculation = this.simulationService.calculateTradeResult({
      stake: hypotheticalStake,
      entryPrice,
      didWin: false
    });

    return prisma.observationEvaluation.upsert({
      where: {
        predictionId
      },
      update: {},
      create: {
        predictionId,
        marketId,
        observationType,
        hypotheticalStake: toDecimal(hypotheticalStake),
        entryPrice: toDecimal(entryPrice),
        shares: toDecimal(calculation.shares),
        status: "PENDING"
      }
    });
  }

  async resolveObservation(
    observationId: string,
    didWin: boolean,
    result: string,
    resolutionSource: string
  ): Promise<ObservationEvaluation> {
    const observation = await prisma.observationEvaluation.findUnique({
      where: { id: observationId }
    });

    if (!observation) {
      throw new Error(`Observation evaluation not found: ${observationId}`);
    }

    const calculation = this.simulationService.calculateTradeResult({
      stake: Number(observation.hypotheticalStake),
      entryPrice: Number(observation.entryPrice),
      didWin
    });

    return prisma.observationEvaluation.update({
      where: { id: observationId },
      data: {
        status: "RESOLVED",
        result,
        wouldWin: calculation.isWin,
        finalValue: toDecimal(calculation.finalValue),
        hypotheticalProfit: toDecimal(calculation.profit),
        hypotheticalRoi: toDecimal(calculation.roi),
        resolutionSource,
        resolvedAt: new Date()
      }
    });
  }
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(6));
}
