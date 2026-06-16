import dotenv from "dotenv";
import { DEFAULT_PRIORITY_ASSETS, CryptoAsset, SUPPORTED_CRYPTO_ASSETS } from "./assets";
import { DEFAULTS, MIN_VALUES } from "./constants";

dotenv.config();

export type AppMode = "SIMULATION_ONLY" | "LIVE_TRADING";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  databaseUrl: string;
  appMode: AppMode;
  enableRealTrading: boolean;
  scanIntervalSeconds: number;
  shortExitIntervalSeconds: number;
  enableShortExitRealTrading: boolean;
  shortExitRealAssets: CryptoAsset[];
  shortExitRealStakeUsd: number;
  shortExitRealEntryPriceMin: number;
  shortExitRealEntryPriceMax: number;
  simulatedStakeUsd: number;
  realStakeUsd: number;
  maxSpread: number;
  minLiquidity: number;
  marketCategory: "CRYPTO";
  priorityAssets: CryptoAsset[];
  prioritizeShortTermUpDown: boolean;
  backupEnabled: boolean;
  backupIntervalHours: number;
  snapshotRawRetentionDays: number;
  snapshotFullRetentionDays: number;
  snapshotStructuredRetentionDays: number;
  marketRawRetentionDays: number;
  warnLogRetentionDays: number;
  errorLogRetentionDays: number;
  logLevel: LogLevel;
  mlEnabled: boolean;
  mlShadowEnabled: boolean;
  mlOutcomeExecutionShadowEnabled: boolean;
  mlOutcomeExecutionBudgetUsd: number;
  mlOutcomeExecutionLatencyMs: number;
  mlOutcomeExecutionMaxSlippage: number;
  enableMlOutcomeRealTrading: boolean;
  mlOutcomeRealAssets: CryptoAsset[];
  mlOutcomeRealStakeUsd: number;
  mlOutcomeRealMaxOpenTrades: number;
  mlOutcomeRealDailyStopLossUsd: number;
  mlMinResolvedTrades: number;
  polygonPrivateKey: string | null;
  addressWallet: string | null;
  apiKey: string | null;
  forceTestTrade: boolean;
  polymarketApiKey: string | null;
  polymarketSecret: string | null;
  polymarketPassphrase: string | null;
  polymarketFunderAddress: string | null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseNumber(value: string | undefined, fallback: number, minimum: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(parsed, minimum);
}

function parsePriorityAssets(value: string | undefined): CryptoAsset[] {
  if (!value) {
    return DEFAULT_PRIORITY_ASSETS;
  }

  const assets = value
    .split(",")
    .map((asset) => asset.trim().toUpperCase())
    .filter((asset): asset is CryptoAsset =>
      SUPPORTED_CRYPTO_ASSETS.includes(asset as CryptoAsset)
    );

  return assets.length > 0 ? assets : DEFAULT_PRIORITY_ASSETS;
}

function validateAppMode(appMode: string, enableRealTrading: boolean): void {
  if (appMode !== "SIMULATION_ONLY" && appMode !== "LIVE_TRADING") {
    throw new Error("APP_MODE debe ser SIMULATION_ONLY o LIVE_TRADING.");
  }

  if (enableRealTrading && appMode !== "LIVE_TRADING") {
    throw new Error("ENABLE_REAL_TRADING requiere APP_MODE=LIVE_TRADING.");
  }
}

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return DEFAULTS.logLevel;
}

const rawAppMode = process.env.APP_MODE ?? DEFAULTS.appMode;
const rawEnableRealTrading = parseBoolean(process.env.ENABLE_REAL_TRADING, DEFAULTS.enableRealTrading);
const shortExitRealEntryPriceMin = parseNumber(
  process.env.SHORT_EXIT_REAL_ENTRY_PRICE_MIN,
  DEFAULTS.shortExitRealEntryPriceMin,
  MIN_VALUES.shortExitRealEntryPrice
);
const shortExitRealEntryPriceMax = parseNumber(
  process.env.SHORT_EXIT_REAL_ENTRY_PRICE_MAX,
  DEFAULTS.shortExitRealEntryPriceMax,
  MIN_VALUES.shortExitRealEntryPrice
);

validateAppMode(rawAppMode, rawEnableRealTrading);

if (shortExitRealEntryPriceMin >= shortExitRealEntryPriceMax ||
    shortExitRealEntryPriceMax >= 1) {
  throw new Error(
    "SHORT_EXIT_REAL_ENTRY_PRICE_MIN/MAX deben definir un rango valido dentro de (0, 1)."
  );
}

if (
  parseBoolean(
    process.env.ENABLE_SHORT_EXIT_REAL_TRADING,
    DEFAULTS.enableShortExitRealTrading
  ) &&
  (!rawEnableRealTrading || rawAppMode !== "LIVE_TRADING")
) {
  throw new Error(
    "ENABLE_SHORT_EXIT_REAL_TRADING requiere APP_MODE=LIVE_TRADING y ENABLE_REAL_TRADING=true."
  );
}

if (
  parseBoolean(
    process.env.ENABLE_ML_OUTCOME_REAL_TRADING,
    DEFAULTS.enableMlOutcomeRealTrading
  ) &&
  (!rawEnableRealTrading || rawAppMode !== "LIVE_TRADING")
) {
  throw new Error(
    "ENABLE_ML_OUTCOME_REAL_TRADING requiere APP_MODE=LIVE_TRADING y ENABLE_REAL_TRADING=true."
  );
}

const retentionValues = {
  snapshotRawRetentionDays: parseNumber(
    process.env.SNAPSHOT_RAW_RETENTION_DAYS,
    DEFAULTS.snapshotRawRetentionDays,
    MIN_VALUES.retentionDays
  ),
  snapshotFullRetentionDays: parseNumber(
    process.env.SNAPSHOT_FULL_RETENTION_DAYS,
    DEFAULTS.snapshotFullRetentionDays,
    MIN_VALUES.retentionDays
  ),
  snapshotStructuredRetentionDays: parseNumber(
    process.env.SNAPSHOT_STRUCTURED_RETENTION_DAYS,
    DEFAULTS.snapshotStructuredRetentionDays,
    MIN_VALUES.retentionDays
  ),
  marketRawRetentionDays: parseNumber(
    process.env.MARKET_RAW_RETENTION_DAYS,
    DEFAULTS.marketRawRetentionDays,
    MIN_VALUES.retentionDays
  ),
  warnLogRetentionDays: parseNumber(
    process.env.WARN_LOG_RETENTION_DAYS,
    DEFAULTS.warnLogRetentionDays,
    MIN_VALUES.retentionDays
  ),
  errorLogRetentionDays: parseNumber(
    process.env.ERROR_LOG_RETENTION_DAYS,
    DEFAULTS.errorLogRetentionDays,
    MIN_VALUES.retentionDays
  )
};

if (
  retentionValues.snapshotRawRetentionDays >
    retentionValues.snapshotFullRetentionDays ||
  retentionValues.snapshotFullRetentionDays >
    retentionValues.snapshotStructuredRetentionDays
) {
  throw new Error(
    "Snapshot retention must satisfy RAW <= FULL <= STRUCTURED."
  );
}

if (
  retentionValues.warnLogRetentionDays >
  retentionValues.errorLogRetentionDays
) {
  throw new Error(
    "WARN_LOG_RETENTION_DAYS must be <= ERROR_LOG_RETENTION_DAYS."
  );
}

export const config: AppConfig = {
  databaseUrl: process.env.DATABASE_URL ?? DEFAULTS.databaseUrl,
  appMode: rawAppMode as AppMode,
  enableRealTrading: rawEnableRealTrading,
  scanIntervalSeconds: parseNumber(
    process.env.SCAN_INTERVAL_SECONDS,
    DEFAULTS.scanIntervalSeconds,
    MIN_VALUES.scanIntervalSeconds
  ),
  shortExitIntervalSeconds: parseNumber(
    process.env.SHORT_EXIT_INTERVAL_SECONDS,
    DEFAULTS.shortExitIntervalSeconds,
    MIN_VALUES.shortExitIntervalSeconds
  ),
  enableShortExitRealTrading: parseBoolean(
    process.env.ENABLE_SHORT_EXIT_REAL_TRADING,
    DEFAULTS.enableShortExitRealTrading
  ),
  shortExitRealAssets: parsePriorityAssets(
    process.env.SHORT_EXIT_REAL_ASSETS ?? DEFAULTS.shortExitRealAssets.join(",")
  ),
  shortExitRealStakeUsd: Math.min(
    3,
    parseNumber(
      process.env.SHORT_EXIT_REAL_STAKE_USD,
      DEFAULTS.shortExitRealStakeUsd,
      MIN_VALUES.shortExitRealStakeUsd
    )
  ),
  shortExitRealEntryPriceMin,
  shortExitRealEntryPriceMax,
  simulatedStakeUsd: parseNumber(
    process.env.SIMULATED_STAKE_USD,
    DEFAULTS.simulatedStakeUsd,
    MIN_VALUES.simulatedStakeUsd
  ),
  realStakeUsd: parseNumber(
    process.env.REAL_STAKE_USD,
    DEFAULTS.realStakeUsd,
    MIN_VALUES.realStakeUsd
  ),
  maxSpread: parseNumber(process.env.MAX_SPREAD, DEFAULTS.maxSpread, MIN_VALUES.maxSpread),
  minLiquidity: parseNumber(process.env.MIN_LIQUIDITY, DEFAULTS.minLiquidity, MIN_VALUES.minLiquidity),
  marketCategory: DEFAULTS.marketCategory,
  priorityAssets: parsePriorityAssets(process.env.PRIORITY_ASSETS),
  prioritizeShortTermUpDown: parseBoolean(
    process.env.PRIORITIZE_SHORT_TERM_UP_DOWN,
    DEFAULTS.prioritizeShortTermUpDown
  ),
  backupEnabled: parseBoolean(process.env.BACKUP_ENABLED, DEFAULTS.backupEnabled),
  backupIntervalHours: parseNumber(
    process.env.BACKUP_INTERVAL_HOURS,
    DEFAULTS.backupIntervalHours,
    MIN_VALUES.backupIntervalHours
  ),
  ...retentionValues,
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
  mlEnabled: parseBoolean(process.env.ML_ENABLED, DEFAULTS.mlEnabled),
  mlShadowEnabled: parseBoolean(
    process.env.ML_SHADOW_ENABLED,
    DEFAULTS.mlShadowEnabled
  ),
  mlOutcomeExecutionShadowEnabled: parseBoolean(
    process.env.ML_OUTCOME_EXECUTION_SHADOW_ENABLED,
    DEFAULTS.mlOutcomeExecutionShadowEnabled
  ),
  mlOutcomeExecutionBudgetUsd: parseNumber(
    process.env.ML_OUTCOME_EXECUTION_BUDGET_USD,
    DEFAULTS.mlOutcomeExecutionBudgetUsd,
    MIN_VALUES.mlOutcomeExecutionBudgetUsd
  ),
  mlOutcomeExecutionLatencyMs: parseNumber(
    process.env.ML_OUTCOME_EXECUTION_LATENCY_MS,
    DEFAULTS.mlOutcomeExecutionLatencyMs,
    MIN_VALUES.mlOutcomeExecutionLatencyMs
  ),
  mlOutcomeExecutionMaxSlippage: parseNumber(
    process.env.ML_OUTCOME_EXECUTION_MAX_SLIPPAGE,
    DEFAULTS.mlOutcomeExecutionMaxSlippage,
    MIN_VALUES.mlOutcomeExecutionMaxSlippage
  ),
  enableMlOutcomeRealTrading: parseBoolean(
    process.env.ENABLE_ML_OUTCOME_REAL_TRADING,
    DEFAULTS.enableMlOutcomeRealTrading
  ),
  mlOutcomeRealAssets: parsePriorityAssets(
    process.env.ML_OUTCOME_REAL_ASSETS ??
      DEFAULTS.mlOutcomeRealAssets.join(",")
  ),
  mlOutcomeRealStakeUsd: Math.min(
    3,
    parseNumber(
      process.env.ML_OUTCOME_REAL_STAKE_USD,
      DEFAULTS.mlOutcomeRealStakeUsd,
      MIN_VALUES.mlOutcomeRealStakeUsd
    )
  ),
  mlOutcomeRealMaxOpenTrades: parseNumber(
    process.env.ML_OUTCOME_REAL_MAX_OPEN_TRADES,
    DEFAULTS.mlOutcomeRealMaxOpenTrades,
    MIN_VALUES.mlOutcomeRealMaxOpenTrades
  ),
  mlOutcomeRealDailyStopLossUsd: parseNumber(
    process.env.ML_OUTCOME_REAL_DAILY_STOP_LOSS_USD,
    DEFAULTS.mlOutcomeRealDailyStopLossUsd,
    MIN_VALUES.mlOutcomeRealDailyStopLossUsd
  ),
  mlMinResolvedTrades: parseNumber(
    process.env.ML_MIN_RESOLVED_TRADES,
    DEFAULTS.mlMinResolvedTrades,
    MIN_VALUES.mlMinResolvedTrades
  ),
  polygonPrivateKey: process.env.WALLET_PRIVATE_KEY ?? process.env.POLYGON_PRIVATE_KEY ?? null,
  addressWallet: process.env.ADDRESS_WALLET ?? null,
  apiKey: process.env.API_KEY ?? null,
  forceTestTrade: parseBoolean(process.env.FORCE_TEST_TRADE, false),
  polymarketApiKey: process.env.POLYMARKET_API_KEY ?? null,
  polymarketSecret: process.env.POLYMARKET_SECRET ?? null,
  polymarketPassphrase: process.env.POLYMARKET_PASSPHRASE ?? null,
  polymarketFunderAddress: process.env.POLYMARKET_FUNDER_ADDRESS ?? null,
};
