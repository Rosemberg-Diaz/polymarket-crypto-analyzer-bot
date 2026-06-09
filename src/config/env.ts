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
  simulatedStakeUsd: number;
  realStakeUsd: number;
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
  polygonPrivateKey: string | null;
  addressWallet: string | null;
  apiKey: string | null;
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

validateAppMode(rawAppMode, rawEnableRealTrading);

export const config: AppConfig = {
  databaseUrl: process.env.DATABASE_URL ?? DEFAULTS.databaseUrl,
  appMode: rawAppMode as AppMode,
  enableRealTrading: rawEnableRealTrading,
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
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
  mlEnabled: parseBoolean(process.env.ML_ENABLED, DEFAULTS.mlEnabled),
  mlMinResolvedTrades: parseNumber(
    process.env.ML_MIN_RESOLVED_TRADES,
    DEFAULTS.mlMinResolvedTrades,
    MIN_VALUES.mlMinResolvedTrades
  ),
  polygonPrivateKey: process.env.POLYGON_PRIVATE_KEY ?? null,
  addressWallet: process.env.ADDRESS_WALLET ?? null,
  apiKey: process.env.API_KEY ?? null
};
