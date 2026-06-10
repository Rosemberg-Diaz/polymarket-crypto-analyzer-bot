import { config } from "../src/config/env";
import { PolymarketTradingService } from "../src/modules/trading/polymarket-trading.service";

function mask(value: string, visibleStart = 6): string {
  if (value.length <= visibleStart + 4) return `${value.slice(0, 2)}...${value.slice(-4)}`;
  return `${value.slice(0, visibleStart)}...${value.slice(-4)}`;
}

function truncate(value: string, maxLen = 20): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...`;
}

async function main(): Promise<void> {
  console.log("=== Diagnóstico de Balance Polymarket CLOB ===\n");

  const checks = {
    WALLET_PRIVATE_KEY: !!config.polygonPrivateKey,
    ADDRESS_WALLET: !!config.addressWallet,
    POLYMARKET_API_KEY: !!config.polymarketApiKey,
    POLYMARKET_SECRET: !!config.polymarketSecret,
    POLYMARKET_PASSPHRASE: !!config.polymarketPassphrase,
    POLYMARKET_FUNDER_ADDRESS: !!config.polymarketFunderAddress,
  };

  console.log("Variables de entorno:");
  for (const [key, present] of Object.entries(checks)) {
    console.log(`  ${key}: ${present ? "✓ presente" : "✗ ausente"}`);
  }
  console.log("");

  const missing = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0 && missing.some((k) => k !== "POLYMARKET_FUNDER_ADDRESS")) {
    console.error(`Error: faltan variables requeridas: ${missing.join(", ")}`);
    process.exit(1);
  }

  const funderAddress = config.polymarketFunderAddress ?? config.addressWallet;

  console.log(`ADDRESS_WALLET:        ${config.addressWallet}`);
  console.log(`POLYMARKET_FUNDER_ADDRESS: ${funderAddress}`);
  console.log(`POLYMARKET_API_KEY:    ${config.polymarketApiKey ? mask(config.polymarketApiKey) : "N/A"}`);
  console.log(`POLYMARKET_SECRET:     ${config.polymarketSecret ? "********" : "N/A"}`);
  console.log(`POLYMARKET_PASSPHRASE: ${config.polymarketPassphrase ? "********" : "N/A"}`);
  console.log("");

  console.log("Inicializando cliente CLOB con SignatureTypeV2.POLY_1271 (3)...");
  const service = new PolymarketTradingService(
    config.polygonPrivateKey!,
    config.addressWallet!,
    undefined,
    config.polymarketApiKey ?? undefined,
    config.polymarketSecret ?? undefined,
    config.polymarketPassphrase ?? undefined,
    funderAddress
  );

  const ok = await service.initialize();
  if (!ok) {
    console.error("Error: no se pudo inicializar el trading service.");
    process.exit(1);
  }
  console.log("✓ Cliente CLOB inicializado correctamente.\n");

  console.log("Sincronizando caché de balance/allowance (GET /balance-allowance/update)...");
  const synced = await service.syncBalanceAllowance();
  console.log(synced ? "✓ Caché sincronizada." : "✗ Fallo al sincronizar caché.");
  console.log("");

  console.log("Consultando balance/allowance real (GET /balance-allowance)...");
  const balanceInfo = await service.getUsdcBalance(false);
  if (!balanceInfo) {
    console.error("Error: no se pudo obtener el balance.");
    process.exit(1);
  }

  console.log("");
  console.log("=== Resultados ===");
  console.log(`Balance disponible (collateral): $${balanceInfo.balanceUsd.toFixed(2)} USDC`);
  console.log(`Allowance CLOB:                  $${balanceInfo.allowanceUsd.toFixed(2)} USDC`);
  console.log("");

  if (balanceInfo.raw && typeof balanceInfo.raw === "object") {
    console.log("Respuesta cruda del endpoint (ocultando secretos):");
    const sanitized = JSON.parse(JSON.stringify(balanceInfo.raw));
    if (sanitized.balance !== undefined) sanitized.balance = `$${(Number(sanitized.balance) / 1e6).toFixed(2)}`;
    if (sanitized.allowances?.["0x"] !== undefined) {
      sanitized.allowances = {
        "0x": `$${(Number(sanitized.allowances["0x"]) / 1e6).toFixed(2)}`
      };
    }
    console.log(`  ${truncate(JSON.stringify(sanitized), 300)}`);
    console.log("");
  }

  const dummyStake = Number(process.env.REAL_STAKE_USD) || 1;
  if (balanceInfo.balanceUsd >= dummyStake) {
    console.log(`✓ Balance suficiente ($${balanceInfo.balanceUsd.toFixed(2)} >= $${dummyStake}) para BUY orders de $${dummyStake}.`);
    console.log("  El bot PUEDE hacer trading real.");
  } else {
    console.log(`✗ Balance insuficiente ($${balanceInfo.balanceUsd.toFixed(2)} < $${dummyStake}) para BUY orders de $${dummyStake}.`);
    console.log("  El bot NO puede hacer trading real hasta fondear la wallet.");
    console.log("");
    console.log("Posibles causas:");
    console.log("  - La wallet no tiene USDC depositado en Polymarket CLOB");
    console.log("  - El funderAddress no coincide con la wallet que tiene los fondos");
    console.log("  - Los fondos están en el exchange pero no en el balance del CLOB");
    console.log("  - La private key no corresponde a la wallet con fondos");
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
