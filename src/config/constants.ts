import path from "node:path";

export const APP_NAME = "polymarket-crypto-analyzer-bot";

export const DEFAULTS = {
  databaseUrl: "file:./dev.db",
  appMode: "SIMULATION_ONLY",
  enableRealTrading: false,
  scanIntervalSeconds: 10,
  simulatedStakeUsd: 5,
  realStakeUsd: 10,
  maxSpread: 0.05,
  minLiquidity: 100,
  marketCategory: "CRYPTO",
  priorityAssets: ["BTC", "ETH", "SOL"],
  prioritizeShortTermUpDown: true,
  backupEnabled: true,
  backupIntervalHours: 24,
  logLevel: "info",
  mlEnabled: false,
  mlMinResolvedTrades: 1000
} as const;

export const MIN_VALUES = {
  scanIntervalSeconds: 1,
  simulatedStakeUsd: 0.01,
  realStakeUsd: 1,
  maxSpread: 0,
  minLiquidity: 0,
  backupIntervalHours: 1,
  mlMinResolvedTrades: 0
} as const;

export const DIRECTORIES = {
  logs: path.resolve(process.cwd(), "logs"),
  backups: path.resolve(process.cwd(), "backups"),
  prisma: path.resolve(process.cwd(), "prisma")
} as const;

export const BACKUP_RETENTION_DAYS = 30;
