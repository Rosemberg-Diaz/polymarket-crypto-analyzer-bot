import dotenv from "dotenv";
import { DEFAULT_PRIORITY_ASSETS, CryptoAsset, SUPPORTED_CRYPTO_ASSETS } from "./assets";
import { DEFAULTS, MIN_VALUES } from "./constants";

dotenv.config();

export type AppMode = "SIMULATION_ONLY";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  databaseUrl: string;
  appMode: AppMode;
  enableRealTrading: false;
  scanIntervalSeconds: number;
  simulatedStakeUsd: number;
  maxSpread: number;
  minLiquidity: number;
  marketCategory: "CRYPTO";
  priorityAssets: CryptoAsset[];
  prioritizeShortTermUpDown: boolean;
  backupEnabled: boolean;
  backupIntervalHours: number;
  logLevel: LogLevel;
  mlEnabled: boolean;
  mlMinResolvedTrades: number;
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

function requireSimulationOnly(appMode: string, enableRealTrading: boolean): void {
  if (appMode !== "SIMULATION_ONLY") {
    throw new Error("APP_MODE debe ser SIMULATION_ONLY en esta version inicial.");
  }

  if (enableRealTrading) {
    throw new Error("ENABLE_REAL_TRADING debe ser false. Trading real no esta permitido.");
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

requireSimulationOnly(rawAppMode, rawEnableRealTrading);

export const config: AppConfig = {
  databaseUrl: process.env.DATABASE_URL ?? DEFAULTS.databaseUrl,
  appMode: DEFAULTS.appMode,
  enableRealTrading: DEFAULTS.enableRealTrading,
  scanIntervalSeconds: parseNumber(
    process.env.SCAN_INTERVAL_SECONDS,
    DEFAULTS.scanIntervalSeconds,
    MIN_VALUES.scanIntervalSeconds
  ),
  simulatedStakeUsd: parseNumber(
    process.env.SIMULATED_STAKE_USD,
    DEFAULTS.simulatedStakeUsd,
    MIN_VALUES.simulatedStakeUsd
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
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
  mlEnabled: parseBoolean(process.env.ML_ENABLED, DEFAULTS.mlEnabled),
  mlMinResolvedTrades: parseNumber(
    process.env.ML_MIN_RESOLVED_TRADES,
    DEFAULTS.mlMinResolvedTrades,
    MIN_VALUES.mlMinResolvedTrades
  )
};
