import { config } from "../../config/env";

console.log("Polymarket Crypto Analyzer Bot - Simulation Report");
console.log(`Mode: ${config.appMode}`);
console.log(`Real trading enabled: ${config.enableRealTrading}`);
console.log(`Priority assets: ${config.priorityAssets.join(", ")}`);
console.log("No real-money trading, wallet, private key, sports, politics, or elections are included.");
