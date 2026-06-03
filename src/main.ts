import { config } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./database/client";
import { BackupService } from "./modules/backup/backupService";
import { LearningService } from "./modules/learning/learningService";
import { Logger } from "./modules/logger/logger";
import { MarketDataService } from "./modules/market-data/marketDataService";
import { PolymarketClient } from "./modules/polymarket/polymarketClient";
import { RiskService } from "./modules/risk/riskService";
import { ScannerJob } from "./modules/jobs/scannerJob";
import { SignalService } from "./modules/signals/signalService";
import { SimulationService } from "./modules/simulations/simulationService";

async function bootstrap(): Promise<void> {
  const logger = new Logger(config.logLevel);
  const backupService = new BackupService();
  const learningService = new LearningService();

  logger.info("Starting Polymarket Crypto Analyzer Bot");
  logger.info(`Modo actual: ${config.appMode}`);
  logger.info(`Base de datos usada: ${config.databaseUrl}`);
  logger.info(`Intervalo de escaneo: ${config.scanIntervalSeconds} segundos`);
  logger.info(`Activos prioritarios: ${config.priorityAssets.join(", ")}`);
  logger.info(`Trading real desactivado: ${String(!config.enableRealTrading)}`);
  logger.info(`Backups: ${backupService.getStatus()}`);
  logger.info(`ML enabled: ${learningService.isEnabled()} (${learningService.getMinimumResolvedTrades()} min trades)`);

  await connectDatabase();

  const scannerJob = new ScannerJob(
    new MarketDataService(new PolymarketClient()),
    new SignalService(),
    new RiskService(),
    new SimulationService(),
    logger
  );

  await scannerJob.runOnce();
  logger.info("Bot initialized in SIMULATION_ONLY mode. Waiting for future scheduler integration.");
}

bootstrap()
  .catch((error: unknown) => {
    console.error("Bot failed to start", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
