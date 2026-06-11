import { Prisma, RealOrder } from "@prisma/client";
import { prisma } from "../../database/client";

export interface RecordRealOrderInput {
  predictionId: string;
  simulatedTradeId: string;
  marketId: string;
  assetSymbol: string;
  marketType: string;
  predictedOutcome: string;
  entryRule: string;
  stake: number;
  requestedPrice: number;
}

export class RealOrderService {
  async createAttempt(input: RecordRealOrderInput): Promise<RealOrder> {
    const requestedShares = input.stake / input.requestedPrice;

    return prisma.realOrder.create({
      data: {
        prediction: {
          connect: {
            id: input.predictionId
          }
        },
        simulatedTrade: {
          connect: {
            id: input.simulatedTradeId
          }
        },
        market: {
          connect: {
            id: input.marketId
          }
        },
        assetSymbol: input.assetSymbol,
        marketType: input.marketType,
        predictedOutcome: input.predictedOutcome,
        entryRule: input.entryRule,
        stake: new Prisma.Decimal(input.stake),
        requestedPrice: new Prisma.Decimal(input.requestedPrice),
        requestedShares: new Prisma.Decimal(requestedShares),
        status: "ATTEMPTING"
      }
    });
  }

  async markSubmitted(id: string, externalOrderId: string): Promise<RealOrder> {
    return prisma.realOrder.update({
      where: {
        id
      },
      data: {
        externalOrderId,
        status: "SUBMITTED",
        errorMessage: null,
        responseData: JSON.stringify({
          success: true,
          orderId: externalOrderId,
          error: null
        }),
        submittedAt: new Date()
      }
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<RealOrder> {
    return prisma.realOrder.update({
      where: {
        id
      },
      data: {
        status: "FAILED",
        errorMessage,
        responseData: JSON.stringify({
          success: false,
          orderId: null,
          error: errorMessage
        })
      }
    });
  }
}
