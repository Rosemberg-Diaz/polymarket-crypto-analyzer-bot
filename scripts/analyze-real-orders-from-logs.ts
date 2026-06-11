import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface LoggedOrder {
  timestamp: Date;
  orderId: string;
  market: string;
  outcome: string;
  stakeUsd: number;
  entryPrice: number;
  similarCases: number | null;
  historicalWinRate: number | null;
  historicalProfit: number | null;
}

async function main(): Promise<void> {
  const orders = readOrders();
  const trades = await prisma.simulatedTrade.findMany({
    include: {
      market: { select: { question: true } },
      prediction: {
        select: {
          predictedOutcome: true,
          features: true
        }
      }
    }
  });

  const matched = orders.map((order) => {
    const candidates = trades
      .filter(
        (trade) =>
          trade.market.question === order.market &&
          trade.prediction.predictedOutcome === order.outcome &&
          Math.abs(Number(trade.entryPrice) - order.entryPrice) < 0.000001
      )
      .sort(
        (left, right) =>
          Math.abs(left.createdAt.getTime() - order.timestamp.getTime()) -
          Math.abs(right.createdAt.getTime() - order.timestamp.getTime())
      );
    const trade = candidates[0] ?? null;

    return {
      ...order,
      day: bogotaDay(order.timestamp),
      historicalGateMetadataPresent: order.similarCases !== null,
      matchedTradeId: trade?.id ?? null,
      tradeStatus: trade?.status ?? null,
      isWin: trade?.isWin ?? null,
      simulatedProfit: trade?.profit === null || trade?.profit === undefined
        ? null
        : Number(trade.profit),
      simulatedRoi: trade?.roi === null || trade?.roi === undefined
        ? null
        : Number(trade.roi),
      result: trade?.result ?? null
    };
  });

  const resolved = matched.filter(
    (row) => row.tradeStatus === "RESOLVED" && row.isWin !== null && row.simulatedProfit !== null
  );

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        caveat:
          "A logged CLOB order ID proves submission, not final fill. Matched simulation outcome is used as the settlement proxy.",
        submittedOrders: matched.length,
        matchedResolvedOrders: resolved.length,
        unresolvedOrUnmatched: matched.length - resolved.length,
        allSubmittedResolvedSummary: summarize(resolved),
        beforeHistoricalGateSummary: summarize(
          resolved.filter((row) => !row.historicalGateMetadataPresent)
        ),
        withHistoricalGateSummary: summarize(
          resolved.filter((row) => row.historicalGateMetadataPresent)
        ),
        byDay: Object.fromEntries(
          Array.from(new Set(resolved.map((row) => row.day))).map((day) => [
            day,
            summarize(resolved.filter((row) => row.day === day))
          ])
        ),
        orders: matched
      },
      null,
      2
    )
  );
}

function readOrders(): LoggedOrder[] {
  const logPaths = ["2026-06-10.log", "2026-06-11.log"]
    .map((name) => path.join(process.cwd(), "logs", name))
    .filter((value) => fs.existsSync(value));
  const byOrderId = new Map<string, LoggedOrder>();
  const pattern =
    /^\[(?<timestamp>[^\]]+)\] \[INFO\] Real order placed successfully\. (?<context>\{.*\})$/;

  for (const logPath of logPaths) {
    for (const line of fs.readFileSync(logPath, "utf8").split(/\r?\n/)) {
      const match = pattern.exec(line);
      if (!match?.groups) continue;

      try {
        const context = JSON.parse(match.groups.context) as Record<string, unknown>;
        const orderId = String(context.orderId ?? "");
        if (!orderId || byOrderId.has(orderId)) continue;

        byOrderId.set(orderId, {
          timestamp: new Date(match.groups.timestamp),
          orderId,
          market: String(context.market ?? ""),
          outcome: String(context.outcome ?? ""),
          stakeUsd: Number(context.stakeUsd ?? 0),
          entryPrice: Number(context.entryPrice ?? 0),
          similarCases: numberOrNull(context.similarCases),
          historicalWinRate: numberOrNull(context.historicalWinRate),
          historicalProfit: numberOrNull(context.historicalProfit)
        });
      } catch {
        continue;
      }
    }
  }

  return Array.from(byOrderId.values()).sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime()
  );
}

function summarize<T extends {
  isWin: boolean | null;
  simulatedProfit: number | null;
  stakeUsd: number;
}>(rows: T[]) {
  const wins = rows.filter((row) => row.isWin === true).length;
  return {
    orders: rows.length,
    wins,
    losses: rows.length - wins,
    winRate: round6(rows.length === 0 ? 0 : wins / rows.length),
    submittedStake: round6(rows.reduce((sum, row) => sum + row.stakeUsd, 0)),
    simulatedSettlementProfit: round6(
      rows.reduce((sum, row) => sum + (row.simulatedProfit ?? 0), 0)
    )
  };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bogotaDay(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
