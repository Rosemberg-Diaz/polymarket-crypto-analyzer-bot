import { config } from "../../config/env";
import { prisma } from "../../database/client";

export interface HealthCheckStatus {
  mode: string;
  databaseStatus: "OK" | "ERROR";
  lastSnapshotAt: string | null;
  lastPredictionAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  pendingTrades: number;
  resolvedTrades: number;
}

export class HealthCheckService {
  async getStatus(): Promise<HealthCheckStatus> {
    const [lastSnapshot, lastPrediction, lastError, pendingTrades, resolvedTrades, databaseStatus] =
      await Promise.all([
        prisma.marketSnapshot.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true }
        }),
        prisma.botPrediction.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true }
        }),
        prisma.botRunLog.findFirst({
          where: { level: "error" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, message: true }
        }),
        prisma.simulatedTrade.count({ where: { status: "PENDING" } }),
        prisma.simulatedTrade.count({ where: { status: "RESOLVED" } }),
        this.checkDatabase()
      ]);

    return {
      mode: config.appMode,
      databaseStatus,
      lastSnapshotAt: lastSnapshot?.createdAt.toISOString() ?? null,
      lastPredictionAt: lastPrediction?.createdAt.toISOString() ?? null,
      lastErrorAt: lastError?.createdAt.toISOString() ?? null,
      lastErrorMessage: lastError?.message ?? null,
      pendingTrades,
      resolvedTrades
    };
  }

  private async checkDatabase(): Promise<"OK" | "ERROR"> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return "OK";
    } catch {
      return "ERROR";
    }
  }
}
