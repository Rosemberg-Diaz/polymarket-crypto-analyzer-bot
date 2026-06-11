import { beforeEach, describe, expect, it, vi } from "vitest";

const { realOrderCreate, realOrderUpdate } = vi.hoisted(() => ({
  realOrderCreate: vi.fn(),
  realOrderUpdate: vi.fn()
}));

vi.mock("../../database/client", () => ({
  prisma: {
    realOrder: {
      create: realOrderCreate,
      update: realOrderUpdate
    }
  }
}));

import { RealOrderService } from "./real-order.service";

describe("RealOrderService", () => {
  const service = new RealOrderService();

  beforeEach(() => {
    realOrderCreate.mockReset();
    realOrderUpdate.mockReset();
  });

  it("records an order attempt before sending it to CLOB", async () => {
    realOrderCreate.mockResolvedValue({ id: "order-attempt-1" });

    await service.createAttempt({
      predictionId: "prediction-1",
      simulatedTradeId: "simulation-1",
      marketId: "market-1",
      assetSymbol: "BTC",
      marketType: "UP_DOWN_SHORT_TERM",
      predictedOutcome: "UP",
      entryRule: "ENTER_SMALL_STANDARD",
      stake: 5,
      requestedPrice: 0.5
    });

    expect(realOrderCreate).toHaveBeenCalledOnce();

    const data = realOrderCreate.mock.calls[0][0].data;
    expect(data.status).toBe("ATTEMPTING");
    expect(data.stake.toNumber()).toBe(5);
    expect(data.requestedPrice.toNumber()).toBe(0.5);
    expect(data.requestedShares.toNumber()).toBe(10);
    expect(data.prediction.connect.id).toBe("prediction-1");
    expect(data.simulatedTrade.connect.id).toBe("simulation-1");
    expect(data.market.connect.id).toBe("market-1");
  });

  it("marks an accepted CLOB order as submitted", async () => {
    realOrderUpdate.mockResolvedValue({ id: "real-order-1", status: "SUBMITTED" });

    await service.markSubmitted("real-order-1", "clob-order-123");

    const update = realOrderUpdate.mock.calls[0][0];
    expect(update.where.id).toBe("real-order-1");
    expect(update.data.status).toBe("SUBMITTED");
    expect(update.data.externalOrderId).toBe("clob-order-123");
    expect(update.data.submittedAt).toBeInstanceOf(Date);
  });

  it("records a failed order without losing the error", async () => {
    realOrderUpdate.mockResolvedValue({ id: "real-order-1", status: "FAILED" });

    await service.markFailed("real-order-1", "Insufficient USDC balance");

    const update = realOrderUpdate.mock.calls[0][0];
    expect(update.where.id).toBe("real-order-1");
    expect(update.data.status).toBe("FAILED");
    expect(update.data.errorMessage).toBe("Insufficient USDC balance");
    expect(JSON.parse(update.data.responseData)).toEqual({
      success: false,
      orderId: null,
      error: "Insufficient USDC balance"
    });
  });
});
