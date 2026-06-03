import dotenv from "dotenv";
import { DEFAULT_PRIORITY_ASSETS, CryptoAsset, SUPPORTED_CRYPTO_ASSETS } from "./assets";

dotenv.config();

export type AppMode = "SIMULATION_ONLY";

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
  logLevel: string;
  mlEnabled: boolean;
  mlMinResolvedTrades: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const rawAppMode = process.env.APP_MODE ?? "SIMULATION_ONLY";
const rawEnableRealTrading = parseBoolean(process.env.ENABLE_REAL_TRADING, false);

requireSimulationOnly(rawAppMode, rawEnableRealTrading);

export const config: AppConfig = {
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  appMode: "SIMULATION_ONLY",
  enableRealTrading: false,
  scanIntervalSeconds: parseNumber(process.env.SCAN_INTERVAL_SECONDS, 10),
  simulatedStakeUsd: parseNumber(process.env.SIMULATED_STAKE_USD, 5),
  maxSpread: parseNumber(process.env.MAX_SPREAD, 0.05),
  minLiquidity: parseNumber(process.env.MIN_LIQUIDITY, 100),
  marketCategory: "CRYPTO",
  priorityAssets: parsePriorityAssets(process.env.PRIORITY_ASSETS),
  prioritizeShortTermUpDown: parseBoolean(process.env.PRIORITIZE_SHORT_TERM_UP_DOWN, true),
  backupEnabled: parseBoolean(process.env.BACKUP_ENABLED, true),
  backupIntervalHours: parseNumber(process.env.BACKUP_INTERVAL_HOURS, 24),
  logLevel: process.env.LOG_LEVEL ?? "info",
  mlEnabled: parseBoolean(process.env.ML_ENABLED, false),
  mlMinResolvedTrades: parseNumber(process.env.ML_MIN_RESOLVED_TRADES, 1000)
};
