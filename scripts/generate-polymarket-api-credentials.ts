import { config } from "dotenv";
import { createWalletClient, http, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { ClobClient, Chain } from "@polymarket/clob-client-v2";
import * as fs from "node:fs";
import * as path from "node:path";

const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const ENV_PATH = path.resolve(process.cwd(), ".env");
const TARGET_VARS = [
  "POLYMARKET_API_KEY",
  "POLYMARKET_SECRET",
  "POLYMARKET_PASSPHRASE",
  "POLYMARKET_FUNDER_ADDRESS",
] as const;

function loadDotenv(): void {
  config({ path: ENV_PATH });
}

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} no definida en .env`);
    process.exit(1);
  }
  return value;
}

function mask(value: string, visibleStart = 6): string {
  if (value.length <= visibleStart + 4) return `${value.slice(0, 2)}...${value.slice(-4)}`;
  return `${value.slice(0, visibleStart)}...${value.slice(-4)}`;
}

async function main(): Promise<void> {
  loadDotenv();

  const walletPrivateKey = getRequiredEnvVar("WALLET_PRIVATE_KEY");
  const funderAddress = getRequiredEnvVar("ADDRESS_WALLET");

  console.log("Conectando a Polymarket CLOB...");

  const account = privateKeyToAccount(walletPrivateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const tempClient = new ClobClient({
    host: CLOB_HOST,
    chain: CHAIN_ID as Chain,
    signer: walletClient,
  });

  const creds = await tempClient.createOrDeriveApiKey();

  const envRaw = fs.readFileSync(ENV_PATH, "utf-8");
  const lines = envRaw.split("\n");

  const newEntries: Record<string, string> = {
    POLYMARKET_API_KEY: creds.key,
    POLYMARKET_SECRET: creds.secret,
    POLYMARKET_PASSPHRASE: creds.passphrase,
    POLYMARKET_FUNDER_ADDRESS: funderAddress,
  };

  const targetSet = new Set(TARGET_VARS);
  const seen = new Set<string>();
  const updated: string[] = [];
  const added: string[] = [];

  const newLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      newLines.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIdx).trim();
    if (targetSet.has(key)) {
      seen.add(key);
      updated.push(key);
      newLines.push(`${key}=${newEntries[key]}`);
    } else {
      newLines.push(line);
    }
  }

  for (const key of TARGET_VARS) {
    if (!seen.has(key)) {
      added.push(key);
      newLines.push(`${key}=${newEntries[key]}`);
    }
  }

  fs.writeFileSync(ENV_PATH, newLines.join("\n") + "\n");

  console.log("Credenciales API generadas correctamente.");
  console.log("Archivo .env actualizado correctamente.");
  console.log("");

  if (updated.length > 0) {
    console.log("Variables actualizadas:");
    for (const v of updated) {
      if (v === "POLYMARKET_API_KEY") console.log(`  - ${v}=${mask(newEntries[v])}`);
      else if (v === "POLYMARKET_FUNDER_ADDRESS") console.log(`  - ${v}=${newEntries[v]}`);
      else console.log(`  - ${v}=********`);
    }
  }

  if (added.length > 0) {
    console.log("Variables agregadas:");
    for (const v of added) {
      if (v === "POLYMARKET_API_KEY") console.log(`  - ${v}=${mask(newEntries[v])}`);
      else if (v === "POLYMARKET_FUNDER_ADDRESS") console.log(`  - ${v}=${newEntries[v]}`);
      else console.log(`  - ${v}=********`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
