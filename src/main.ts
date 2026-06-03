import { config } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./database/client";
import { BackupService } from "./modules/backup/backup.service";
import { CryptoMarketScannerJob } from "./modules/jobs/crypto-market-scanner.job";
import { DailyMaintenanceJob } from "./modules/jobs/daily-maintenance.job";
import { LearningService } from "./modules/learning/learningService";
import { LoggerService } from "./modules/logger/logger.service";

async function bootstrap(): Promise<void> {
  const logger = new LoggerService(config.logLevel);
  const backupService = new BackupService(logger);
  const learningService = new LearningService();
  const dailyMaintenanceJob = new DailyMaintenanceJob(backupService, logger);
  const scannerJob = new CryptoMarketScannerJob(logger);
  let scanTimer: NodeJS.Timeout | null = null;
  let isShuttingDown = false;
  let isScanRunning = false;

  async function shutdown(reason: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }

    logger.info(`Shutting down bot: ${reason}`);
    await disconnectDatabase();
    logger.info("Prisma disconnected. Shutdown complete.");
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
      } catch (error) {
        logger.error("Crypto market scanner failed.", error);
      } finally {
        isScanRunning = false;
      }
    }

    if (!isShuttingDown) {
      scanTimer = setTimeout(runScanLoop, config.scanIntervalSeconds * 1000);
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
  logger.info(`ML enabled: ${learningService.isEnabled()} (${learningService.getMinimumResolvedTrades()} min trades)`);

  await dailyMaintenanceJob.runManual();
  await connectDatabase();
  await runScanLoop();
}

bootstrap().catch(async (error: unknown) => {
  console.error("Bot failed to start", error);
  await disconnectDatabase();
  process.exitCode = 1;
});
