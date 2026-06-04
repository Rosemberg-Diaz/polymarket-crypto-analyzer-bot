import { config } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./database/client";
import { BackupService } from "./modules/backup/backup.service";
import { HealthCheckService } from "./modules/health/health-check.service";
import { CryptoMarketScannerJob } from "./modules/jobs/crypto-market-scanner.job";
import { DailyMaintenanceJob } from "./modules/jobs/daily-maintenance.job";
import { ResolveSimulatedTradesJob } from "./modules/jobs/resolve-simulated-trades.job";
import { LearningService } from "./modules/learning/learningService";
import { LoggerService } from "./modules/logger/logger.service";

const UP_DOWN_5M_BOUNDARY_MS = 5 * 60 * 1000;
const UP_DOWN_BOUNDARY_CAPTURE_DELAY_MS = 1_000;

async function bootstrap(): Promise<void> {
  const logger = new LoggerService(config.logLevel);
  const backupService = new BackupService(logger);
  const learningService = new LearningService();
  const dailyMaintenanceJob = new DailyMaintenanceJob(backupService, logger);
  const scannerJob = new CryptoMarketScannerJob(logger);
  const resolveSimulatedTradesJob = new ResolveSimulatedTradesJob(logger);
  const healthCheckService = new HealthCheckService();
  let scanTimer: NodeJS.Timeout | null = null;
  let maintenanceTimer: NodeJS.Timeout | null = null;
  let isShuttingDown = false;
  let isScanRunning = false;
  let isMaintenanceRunning = false;

  async function shutdown(reason: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }

    if (maintenanceTimer) {
      clearTimeout(maintenanceTimer);
      maintenanceTimer = null;
    }

    try {
      logger.info(`Shutting down bot: ${reason}`);
      await disconnectDatabase();
      logger.info("Prisma disconnected. Shutdown complete.");
    } catch (error) {
      logger.error("Error during shutdown.", error);
    }
  }

  async function runScanLoop(): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    if (isScanRunning) {
      logger.warn("Previous scan still running. Skipping this tick.");
    } else {
      isScanRunning = true;
      try {
        await scannerJob.runOnce();
        await resolveSimulatedTradesJob.runOnce();
        const health = await healthCheckService.getStatus();
        logger.info("Health check", health);
      } catch (error) {
        logger.error("Crypto market scanner failed.", error);
      } finally {
        isScanRunning = false;
      }
    }

    if (!isShuttingDown) {
      scanTimer = setTimeout(runScanLoop, getNextScanDelayMs(config.scanIntervalSeconds));
    }
  }

  async function runMaintenanceLoop(): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    if (isMaintenanceRunning) {
      logger.warn("Previous maintenance job still running. Skipping this tick.");
    } else {
      isMaintenanceRunning = true;
      try {
        await dailyMaintenanceJob.runManual();
      } catch (error) {
        logger.error("Daily maintenance loop failed.", error);
      } finally {
        isMaintenanceRunning = false;
      }
    }

    if (!isShuttingDown) {
      maintenanceTimer = setTimeout(runMaintenanceLoop, config.backupIntervalHours * 60 * 60 * 1000);
    }
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => {
      process.exit(0);
    });
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => {
      process.exit(0);
    });
  });

  logger.info("Starting Polymarket Crypto Analyzer Bot");
  logger.info(`Modo actual: ${config.appMode}`);
  logger.info(`Base de datos usada: ${config.databaseUrl}`);
  logger.info(`Intervalo de escaneo: ${config.scanIntervalSeconds} segundos`);
  logger.info(`Activos prioritarios: ${config.priorityAssets.join(", ")}`);
  logger.info(`Trading real desactivado: ${String(!config.enableRealTrading)}`);
  logger.info(`Backups: ${backupService.getStatus()}`);
  logger.info(`ML enabled: ${String(config.mlEnabled)}`);
  logger.info(`Statistical learning minimum similar cases: ${learningService.getMinimumResolvedTrades()}`);

  await connectDatabase();
  await dailyMaintenanceJob.runManual();
  maintenanceTimer = setTimeout(runMaintenanceLoop, config.backupIntervalHours * 60 * 60 * 1000);
  await runScanLoop();
}

bootstrap().catch(async (error: unknown) => {
  console.error("Bot failed to start", error);
  await disconnectDatabase();
  process.exitCode = 1;
});

function getNextScanDelayMs(scanIntervalSeconds: number): number {
  const configuredDelayMs = scanIntervalSeconds * 1000;
  const now = Date.now();
  const nextBoundaryAt =
    Math.ceil(now / UP_DOWN_5M_BOUNDARY_MS) * UP_DOWN_5M_BOUNDARY_MS +
    UP_DOWN_BOUNDARY_CAPTURE_DELAY_MS;
  const boundaryDelayMs = Math.max(0, nextBoundaryAt - now);

  return Math.min(configuredDelayMs, boundaryDelayMs);
}
