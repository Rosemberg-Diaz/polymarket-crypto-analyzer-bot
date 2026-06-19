import * as path from "node:path";

export const APP_NAME = "polymarket-crypto-analyzer-bot";

export const DEFAULTS = {
  databaseUrl: "file:./dev.db",
  appMode: "SIMULATION_ONLY",
  enableRealTrading: true,
  scanIntervalSeconds: 10,
  shortExitIntervalSeconds: 5,
  enableShortExitObservation: false,
  enableHigherTimeframeOutcomeObservation: true,
  higherTimeframeObservationIntervalSeconds: 30,
  enableShortExitRealTrading: false,
  shortExitRealAssets: ["BTC"],
  shortExitRealStakeUsd: 3,
  shortExitRealEntryPriceMin: 0.55,
  shortExitRealEntryPriceMax: 0.6,
  simulatedStakeUsd: 5,
  realStakeUsd: 10,
  maxSpread: 0.05,
  minLiquidity: 100,
  marketCategory: "CRYPTO",
  priorityAssets: ["BTC", "ETH", "SOL"],
  prioritizeShortTermUpDown: true,
  backupEnabled: true,
  backupIntervalHours: 24,
  snapshotRawRetentionDays: 1,
  snapshotFullRetentionDays: 7,
  snapshotStructuredRetentionDays: 90,
  marketRawRetentionDays: 30,
  warnLogRetentionDays: 30,
  errorLogRetentionDays: 90,
  logLevel: "info",
  mlEnabled: false,
  mlShadowEnabled: true,
  mlOutcomeExecutionShadowEnabled: true,
  mlOutcomeExecutionBudgetUsd: 5,
  mlOutcomeExecutionLatencyMs: 300,
  mlOutcomeExecutionMaxSlippage: 0.01,
  enableMlOutcomeRealTrading: false,
  mlOutcomeRealAssets: ["BTC", "ETH", "SOL", "XRP"],
  mlOutcomeRealSegments: [
    "ETH:5m:UP",
    "SOL:5m:UP",
    "SOL:5m:DOWN",
    "XRP:5m:DOWN",
    "BTC:15m:DOWN",
    "ETH:15m:DOWN",
    "ETH:15m:UP",
    "SOL:15m:UP"
  ],
  mlOutcomeRealSegmentCheckpoints: {
    "ETH:5m:UP": [30],
    "SOL:5m:UP": [30],
    "SOL:5m:DOWN": [30],
    "XRP:5m:DOWN": [30],
    "BTC:15m:DOWN": [60, 120, 180],
    "ETH:15m:DOWN": [60, 120],
    "ETH:15m:UP": [60],
    "SOL:15m:UP": [180]
  } as Record<string, number[]>,
  mlOutcomeRealMinConfidenceByRule: {
    "SOL:5m:UP:30": 0.80,
    "BTC:15m:DOWN:60": 0.85,
    "BTC:15m:DOWN:120": 0.90,
    "ETH:15m:DOWN:60": 0.90,
    "SOL:15m:UP:180": 0.85
  } as Record<string, number>,
  mlOutcomeRealStakeUsd: 3,
  mlOutcomeRealStakeUsd15m: 1.5,
  mlOutcomeRealMaxOpenTrades: 2,
  mlOutcomeRealDailyStopLossUsd: 9,
  mlOutcomeRealAbsoluteDailyStopLossUsd: 12,
  mlOutcomeRealStopLossBaselineAt: null as string | null,
  mlMinResolvedTrades: 1000
} as const;

export const MIN_VALUES = {
  scanIntervalSeconds: 1,
  shortExitIntervalSeconds: 1,
  higherTimeframeObservationIntervalSeconds: 10,
  shortExitRealStakeUsd: 0.01,
  shortExitRealEntryPrice: 0.01,
  simulatedStakeUsd: 0.01,
  realStakeUsd: 1,
  maxSpread: 0,
  minLiquidity: 0,
  backupIntervalHours: 1,
  retentionDays: 1,
  mlOutcomeExecutionBudgetUsd: 0.01,
  mlOutcomeExecutionLatencyMs: 0,
  mlOutcomeExecutionMaxSlippage: 0,
  mlOutcomeRealStakeUsd: 1,
  mlOutcomeRealMaxOpenTrades: 1,
  mlOutcomeRealDailyStopLossUsd: 1,
  mlOutcomeRealAbsoluteDailyStopLossUsd: 1,
  mlMinResolvedTrades: 0
} as const;

export const DIRECTORIES = {
  logs: path.resolve(process.cwd(), "logs"),
  backups: path.resolve(process.cwd(), "backups"),
  prisma: path.resolve(process.cwd(), "prisma")
} as const;

export const BACKUP_RETENTION_DAYS = 30;
