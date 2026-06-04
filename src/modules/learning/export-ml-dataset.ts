import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config/env";
import { connectDatabase, disconnectDatabase, prisma } from "../../database/client";

async function main(): Promise<void> {
  await connectDatabase();

  const resolvedTrades = await prisma.simulatedTrade.findMany({
    where: {
      status: "RESOLVED",
      resolvedAt: {
        not: null
      }
    },
    include: {
      prediction: true
    },
    orderBy: {
      resolvedAt: "asc"
    }
  });

  if (resolvedTrades.length < config.mlMinResolvedTrades) {
    console.log("No hay suficientes datos para ML. Mínimo recomendado: 1000 operaciones resueltas.");
    return;
  }

  const rows = [
    ["features", "isWin", "profit", "roi", "resolvedAt"],
    ...resolvedTrades.map((trade) => [
      trade.prediction.features ?? "{}",
      String(trade.isWin ?? ""),
      trade.profit?.toString() ?? "",
      trade.roi?.toString() ?? "",
      trade.resolvedAt?.toISOString() ?? ""
    ])
  ];
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const outputPath = path.resolve(process.cwd(), "backups", "ml-dataset.csv");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, csv, "utf8");
  console.log(`Dataset ML exportado: ${outputPath}`);
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

main()
  .catch((error: unknown) => {
    console.error("Error exporting ML dataset.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
