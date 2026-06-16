import { config } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./database/client";
import { BackupService } from "./modules/backup/backup.service";
import { HealthCheckService } from "./modules/health/health-check.service";
import { CryptoMarketScannerJob } from "./modules/jobs/crypto-market-scanner.job";
import { DailyMaintenanceJob } from "./modules/jobs/daily-maintenance.job";
import { DailyExitObserverJob } from "./modules/jobs/daily-exit-observer.job";
import { OutcomeCheckpointJob } from "./modules/jobs/outcome-checkpoint.job";
import { ResolveObservationEvaluationsJob } from "./modules/jobs/resolve-observation-evaluations.job";
import { ResolveMlOutcomeShadowExecutionsJob } from "./modules/jobs/resolve-ml-outcome-shadow-executions.job";
import { ResolveLiveOutcomeCheckpointTradesJob } from "./modules/jobs/resolve-live-outcome-checkpoint-trades.job";
import { ResolveRealisticShortExitExecutionsJob } from "./modules/jobs/resolve-realistic-short-exit-executions.job";
import { ResolveSimulatedTradesJob } from "./modules/jobs/resolve-simulated-trades.job";
import { ShortTermExitObserverJob } from "./modules/jobs/short-term-exit-observer.job";
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
  const resolveObservationEvaluationsJob = new ResolveObservationEvaluationsJob(logger);
  const resolveMlOutcomeShadowExecutionsJob =
    new ResolveMlOutcomeShadowExecutionsJob(logger);
  const resolveLiveOutcomeCheckpointTradesJob =
    new ResolveLiveOutcomeCheckpointTradesJob(logger);
  const resolveRealisticShortExitExecutionsJob =
    new ResolveRealisticShortExitExecutionsJob(logger);
  const shortTermExitObserverJob = new ShortTermExitObserverJob(logger);
  const dailyExitObserverJob = new DailyExitObserverJob(logger);
  const outcomeCheckpointJob = new OutcomeCheckpointJob(logger);
  const healthCheckService = new HealthCheckService();
  let scanTimer: NodeJS.Timeout | null = null;
  let shortExitTimer: NodeJS.Timeout | null = null;
  let maintenanceTimer: NodeJS.Timeout | null = null;
  let outcomeCheckpointTimer: NodeJS.Timeout | null = null;
  let isShuttingDown = false;
  let isScanRunning = false;
  let isShortExitRunning = false;
  let isMaintenanceRunning = false;
  let isOutcomeCheckpointRunning = false;

  async function shutdown(reason: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }

    if (shortExitTimer) {
      clearTimeout(shortExitTimer);
      shortExitTimer = null;
    }

    if (maintenanceTimer) {
      clearTimeout(maintenanceTimer);
      maintenanceTimer = null;
    }

    if (outcomeCheckpointTimer) {
      clearTimeout(outcomeCheckpointTimer);
      outcomeCheckpointTimer = null;
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

    if (isMaintenanceRunning) {
      logger.info("Scan tick paused while database maintenance is running.");
    } else if (isScanRunning) {
      logger.warn("Previous scan still running. Skipping this tick.");
    } else {
      isScanRunning = true;
      try {
        await scannerJob.runOnce();
        await resolveSimulatedTradesJob.runOnce();
        await resolveObservationEvaluationsJob.runOnce();
        await resolveMlOutcomeShadowExecutionsJob.runOnce();
        await resolveLiveOutcomeCheckpointTradesJob.runOnce();
        await resolveRealisticShortExitExecutionsJob.runOnce();
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

  async function runShortExitLoop(): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    if (isMaintenanceRunning) {
      logger.info("Fast observation tick paused while database maintenance is running.");
    } else if (isShortExitRunning) {
      logger.warn("Previous fast short-term exit tick still running. Skipping this tick.");
    } else {
      isShortExitRunning = true;
      try {
        try {
          await shortTermExitObserverJob.runOnce();
        } catch (error) {
          logger.error("Fast short-term exit observer failed.", error);
        }

        try {
          await dailyExitObserverJob.runOnce();
        } catch (error) {
          logger.error("Daily multi-cycle observer failed.", error);
        }
      } finally {
        isShortExitRunning = false;
      }
    }

    if (!isShuttingDown) {
      shortExitTimer = setTimeout(
        runShortExitLoop,
        config.shortExitIntervalSeconds * 1_000
      );
    }
  }

  async function runOutcomeCheckpointLoop(): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    if (isMaintenanceRunning) {
      logger.info("Outcome checkpoint paused while database maintenance is running.");
    } else if (isOutcomeCheckpointRunning) {
      logger.warn("Previous lightweight outcome checkpoint tick still running. Skipping this tick.");
    } else {
      isOutcomeCheckpointRunning = true;
      try {
        await outcomeCheckpointJob.runOnce();
      } catch (error) {
        logger.error("Lightweight outcome checkpoint job failed.", error);
      } finally {
        isOutcomeCheckpointRunning = false;
      }
    }

    if (!isShuttingDown) {
      outcomeCheckpointTimer = setTimeout(
        runOutcomeCheckpointLoop,
        5_000
      );
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
  logger.info(
    `Intervalo de observacion compra/venta CLOB: ${config.shortExitIntervalSeconds} segundos`
  );
  logger.info("Compra/venta diaria multi-ciclo", {
    mode: "OBSERVATION_ONLY",
    strategies: [
      "DAILY_MULTI_CYCLE_NO_STOP_V1",
      "DAILY_TREND_FILTERED_V2"
    ],
    takeProfitNetRoi: 0.03,
    noNewBuysLastMinutes: 20,
    stopLoss: "DISABLED"
  });
  logger.info("Observaciones de prediccion UP/DOWN", {
    strategy: "OUTCOME_CHECKPOINT_V1",
    checkpointsSeconds: [180, 120, 60, 30],
    intervalSeconds: 5,
    job: "LIGHTWEIGHT_CURRENT_MARKETS_ONLY",
    mode: "OBSERVATION_ONLY"
  });
  logger.info("Variantes filtradas de compra/venta", {
    fiveMinuteStrategy: "EARLY_WINDOW_XRP_SOL_5M_V1",
    fiveMinuteAssets: ["XRP", "SOL"],
    fiveMinuteEntryWindowSecondsToClose: [280, 300],
    fiveMinuteMaxSpread: 0.02,
    fiveMinuteBidConfirmation: "TWO_CONSECUTIVE_RISES",
    fifteenMinuteStrategy: "EARLY_WINDOW_STRICT_ALL_CRYPTO_15M_V1",
    fifteenMinuteAssets: ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"],
    entryWindowSecondsToClose: [840, 900],
    entryPriceRange: [0.5, 0.7],
    maxSpread: 0.02,
    takeProfitNetRoi: 0.02,
    maxEntriesPerMarket: 1,
    mode: "OBSERVATION_ONLY"
  });
  logger.info("Observacion de microestructura", {
    strategy: "ORDER_FLOW_CONFIRMATION_V1",
    timeframes: ["5m", "15m"],
    sampleIntervalSeconds: config.shortExitIntervalSeconds,
    minimumSamples: 3,
    minimumObservationSeconds: 10,
    features: [
      "bid_trend",
      "spread",
      "depth_imbalance_l5",
      "microprice"
    ],
    mode: "OBSERVATION_ONLY",
    realTrading: false
  });
  logger.info("Compra/venta real de corto plazo", {
    enabled: config.enableShortExitRealTrading,
    assets: config.shortExitRealAssets,
    stakeUsd: config.shortExitRealStakeUsd,
    entryPriceRange: [
      config.shortExitRealEntryPriceMin,
      config.shortExitRealEntryPriceMax
    ]
  });
  logger.info(`Activos prioritarios: ${config.priorityAssets.join(", ")}`);
  logger.info(`Trading real desactivado: ${String(!config.enableRealTrading)}`);
  logger.info(`Backups: ${backupService.getStatus()}`);
  logger.info(`ML enabled: ${String(config.mlEnabled)}`);
  logger.info("ML entry-risk shadow scoring", {
    enabled: config.mlShadowEnabled,
    operationalDecisionImpact: false,
    modelVersion: "ENTRY_RISK_LOGREG_V1"
  });
  logger.info("ML UP/DOWN outcome shadow scoring", {
    enabled: config.mlShadowEnabled,
    timeframes: ["5m", "15m"],
    operationalDecisionImpact: false,
    modelVersion: "OUTCOME_UP_DOWN_LOGREG_V1"
  });
  logger.info("ML UP/DOWN executable shadow pilot", {
    enabled: config.mlOutcomeExecutionShadowEnabled,
    assets: "ALL_SUPPORTED",
    timeframes: ["5m", "15m"],
    checkpointSeconds: [180, 120, 60, 30],
    budgetUsd: config.mlOutcomeExecutionBudgetUsd,
    simulatedLatencyMs: config.mlOutcomeExecutionLatencyMs,
    maxSlippage: config.mlOutcomeExecutionMaxSlippage,
    positiveExpectedValueRequired: true,
    orderType: "FOK_SIMULATION",
    feesIncluded: true,
    operationalDecisionImpact: false,
    realTrading: false
  });
  logger.info("ML UP/DOWN live outcome checkpoint pilot", {
    enabled: config.enableMlOutcomeRealTrading,
    assets: config.mlOutcomeRealAssets,
    timeframe: "5m",
    checkpointSeconds: 30,
    stakeUsd: config.mlOutcomeRealStakeUsd,
    maxOpenTrades: config.mlOutcomeRealMaxOpenTrades,
    dailyStopLossUsd: config.mlOutcomeRealDailyStopLossUsd,
    orderType: "FOK",
    requiresShadowExecutable: true,
    maxSlippage: config.mlOutcomeExecutionMaxSlippage
  });
  logger.info(`Statistical learning minimum similar cases: ${learningService.getMinimumResolvedTrades()}`);

  await connectDatabase();
  await dailyMaintenanceJob.runManual();
  maintenanceTimer = setTimeout(runMaintenanceLoop, config.backupIntervalHours * 60 * 60 * 1000);
  void runScanLoop();
  void runShortExitLoop();
  void runOutcomeCheckpointLoop();
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
