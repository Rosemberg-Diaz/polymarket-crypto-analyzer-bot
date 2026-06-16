import { Prisma } from "@prisma/client";
import { connectDatabase, disconnectDatabase, prisma } from "../src/database/client";

interface ShadowRow {
  label: string;
  trades: bigint;
  profit: Prisma.Decimal | null;
  wins: bigint;
  losses: bigint;
}

async function main(): Promise<void> {
  await connectDatabase();
  const rows = await prisma.$queryRaw<ShadowRow[]>`
    SELECT
      o."mlRiskLabel" AS "label",
      COUNT(*) AS "trades",
      SUM(r."profit") AS "profit",
      SUM(CASE WHEN r."profit" > 0 THEN 1 ELSE 0 END) AS "wins",
      SUM(CASE WHEN r."profit" <= 0 THEN 1 ELSE 0 END) AS "losses"
    FROM "ShortTermExitObservation" o
    JOIN "RealisticShortExitExecution" r ON r."observationId" = o."id"
    WHERE o."mlRiskLabel" IS NOT NULL
      AND r."status" = 'RESOLVED'
    GROUP BY o."mlRiskLabel"
    ORDER BY o."mlRiskLabel"
  `;

  console.table(rows.map((row) => ({
    label: row.label,
    trades: Number(row.trades),
    wins: Number(row.wins),
    losses: Number(row.losses),
    profit: Number(row.profit ?? 0)
  })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
