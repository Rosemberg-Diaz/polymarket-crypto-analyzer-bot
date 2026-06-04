import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../../config/env";
import { DIRECTORIES } from "../../../config/constants";
import { prisma } from "../../../database/client";
import { HealthCheckService } from "../../health/health-check.service";
import { ApiRoute } from "../api.types";

const healthCheckService = new HealthCheckService();

export const healthRoutes: ApiRoute[] = [
  {
    method: "GET",
    path: "/health",
    handler: async () => {
      const health = await healthCheckService.getStatus();
      const [backupCount, databaseSizeBytes] = await Promise.all([
        countBackups(),
        getDatabaseSizeBytes()
      ]);

      return {
        appMode: config.appMode,
        enableRealTrading: config.enableRealTrading,
        scanIntervalSeconds: config.scanIntervalSeconds,
        lastSnapshotAt: health.lastSnapshotAt,
        lastPredictionAt: health.lastPredictionAt,
        lastErrorAt: health.lastErrorAt,
        lastErrorMessage: health.lastErrorMessage,
        totalPendingTrades: health.pendingTrades,
        totalResolvedTrades: health.resolvedTrades,
        databaseStatus: health.databaseStatus,
        uptime: Math.floor(process.uptime()),
        backupCount,
        databaseSizeBytes
      };
    }
  }
];

async function countBackups(): Promise<number> {
  try {
    const entries = await fs.readdir(DIRECTORIES.backups, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".db")).length;
  } catch {
    return 0;
  }
}

async function getDatabaseSizeBytes(): Promise<number> {
  try {
    const databasePath = config.databaseUrl.startsWith("file:")
      ? config.databaseUrl.replace(/^file:/, "")
      : "dev.db";
    const resolvedPath = path.isAbsolute(databasePath)
      ? databasePath
      : path.resolve(DIRECTORIES.prisma, databasePath);
    const stat = await fs.stat(resolvedPath);
    return stat.size;
  } catch {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return 0;
    }

    return 0;
  }
}
