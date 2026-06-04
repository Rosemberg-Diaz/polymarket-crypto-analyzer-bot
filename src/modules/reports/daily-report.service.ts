import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { DIRECTORIES } from "../../config/constants";
import { prisma } from "../../database/client";

interface GroupMetrics {
  key: string;
  totalTrades: number;
  wins: number;
  losses: number;
  totalProfit: number;
  averageRoi: number;
  winRate: number;
}

export class DailyReportService {
  async generate(date = new Date()): Promise<string> {
    const { start, end, dateKey } = getDayRange(date);
    const [predictions, trades, errors] = await Promise.all([
      prisma.botPrediction.findMany({
        where: { createdAt: { gte: start, lt: end } },
        include: { market: true }
      }),
      prisma.simulatedTrade.findMany({
        where: { createdAt: { gte: start, lt: end } },
        include: { prediction: true }
      }),
      prisma.botRunLog.findMany({
        where: {
          level: "error",
          createdAt: { gte: start, lt: end }
        },
        orderBy: { createdAt: "desc" },
        take: 10
      })
    ]);

    const resolvedTrades = trades.filter((trade) => trade.status === "RESOLVED");
    const wins = resolvedTrades.filter((trade) => trade.isWin === true).length;
    const losses = resolvedTrades.filter((trade) => trade.isWin === false).length;
    const totalProfit = sum(resolvedTrades.map((trade) => Number(trade.profit ?? 0)));
    const averageRoi = average(resolvedTrades.map((trade) => Number(trade.roi ?? 0)));
    const winRate = ratio(wins, wins + losses);
    const waitSignals = predictions.filter((prediction) => prediction.recommendation === "WAIT").length;
    const avoidSignals = predictions.filter((prediction) => prediction.recommendation === "AVOID").length;
    const byStrategy = groupTrades(resolvedTrades, (trade) => trade.prediction.strategyName);
    const byAsset = groupTrades(resolvedTrades, (trade) => trade.prediction.assetSymbol);
    const bestStrategy = bestByProfit(byStrategy)?.key ?? "N/A";
    const worstStrategy = worstByProfit(byStrategy)?.key ?? "N/A";
    const bestAsset = bestByProfit(byAsset)?.key ?? "N/A";
    const worstAsset = worstByProfit(byAsset)?.key ?? "N/A";

    await this.saveDailyPerformanceRows(start, predictions, resolvedTrades, byStrategy);

    const report = [
      `Daily Report - ${dateKey}`,
      "",
      `Total predicciones: ${predictions.length}`,
      `Operaciones simuladas: ${trades.length}`,
      `Ganadas: ${wins}`,
      `Perdidas: ${losses}`,
      `Win rate: ${formatPercent(winRate)}`,
      `Profit simulado total: ${formatNumber(totalProfit)}`,
      `ROI promedio: ${formatPercent(averageRoi)}`,
      `Mejor estrategia: ${bestStrategy}`,
      `Peor estrategia: ${worstStrategy}`,
      `Mejor asset: ${bestAsset}`,
      `Peor asset: ${worstAsset}`,
      `Señales WAIT: ${waitSignals}`,
      `Señales AVOID: ${avoidSignals}`,
      "",
      "Errores relevantes:",
      ...(errors.length > 0
        ? errors.map((error) => `- [${error.createdAt.toISOString()}] ${error.message}`)
        : ["- Sin errores relevantes registrados."])
    ].join("\n");

    await this.writeReportFile(dateKey, report);
    return report;
  }

  private async saveDailyPerformanceRows(
    date: Date,
    predictions: Array<{ assetSymbol: string; marketType: string; recommendation: string }>,
    resolvedTrades: Array<{
      isWin: boolean | null;
      profit: Prisma.Decimal | null;
      roi: Prisma.Decimal | null;
      prediction: { assetSymbol: string; marketType: string; strategyName: string };
    }>,
    byStrategy: GroupMetrics[]
  ): Promise<void> {
    const keys = new Set<string>();

    for (const prediction of predictions) {
      keys.add(`${prediction.assetSymbol}|${prediction.marketType}`);
    }

    for (const trade of resolvedTrades) {
      keys.add(`${trade.prediction.assetSymbol}|${trade.prediction.marketType}`);
    }

    for (const key of keys) {
      const [assetSymbol, marketType] = key.split("|");
      const pairPredictions = predictions.filter(
        (prediction) => prediction.assetSymbol === assetSymbol && prediction.marketType === marketType
      );
      const pairTrades = resolvedTrades.filter(
        (trade) => trade.prediction.assetSymbol === assetSymbol && trade.prediction.marketType === marketType
      );
      const wins = pairTrades.filter((trade) => trade.isWin === true).length;
      const losses = pairTrades.filter((trade) => trade.isWin === false).length;
      const totalProfit = sum(pairTrades.map((trade) => Number(trade.profit ?? 0)));
      const averageRoi = average(pairTrades.map((trade) => Number(trade.roi ?? 0)));
      const strategiesForPair = byStrategy.filter((strategy) =>
        pairTrades.some((trade) => trade.prediction.strategyName === strategy.key)
      );

      await prisma.dailyPerformance.upsert({
        where: {
          date_assetSymbol_marketType: {
            date,
            assetSymbol,
            marketType
          }
        },
        update: {
          totalPredictions: pairPredictions.length,
          totalTrades: pairTrades.length,
          wins,
          losses,
          winRate: toDecimal(ratio(wins, wins + losses)),
          totalProfit: toDecimal(totalProfit),
          averageRoi: toDecimal(averageRoi),
          bestStrategy: bestByProfit(strategiesForPair)?.key ?? null,
          worstStrategy: worstByProfit(strategiesForPair)?.key ?? null
        },
        create: {
          date,
          assetSymbol,
          marketType,
          totalPredictions: pairPredictions.length,
          totalTrades: pairTrades.length,
          wins,
          losses,
          winRate: toDecimal(ratio(wins, wins + losses)),
          totalProfit: toDecimal(totalProfit),
          averageRoi: toDecimal(averageRoi),
          bestStrategy: bestByProfit(strategiesForPair)?.key ?? null,
          worstStrategy: worstByProfit(strategiesForPair)?.key ?? null
        }
      });
    }
  }

  private async writeReportFile(dateKey: string, report: string): Promise<void> {
    const reportsDir = path.join(DIRECTORIES.logs, "reports");
    await fs.mkdir(reportsDir, { recursive: true });
    await fs.writeFile(path.join(reportsDir, `${dateKey}-report.txt`), report, "utf8");
  }
}

function getDayRange(date: Date): { start: Date; end: Date; dateKey: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end, dateKey: start.toISOString().slice(0, 10) };
}

function groupTrades<T extends { isWin: boolean | null; profit: Prisma.Decimal | null; roi: Prisma.Decimal | null }>(
  trades: T[],
  getKey: (trade: T) => string
): GroupMetrics[] {
  const groups = new Map<string, T[]>();

  for (const trade of trades) {
    const key = getKey(trade);
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const wins = group.filter((trade) => trade.isWin === true).length;
    const losses = group.filter((trade) => trade.isWin === false).length;
    return {
      key,
      totalTrades: group.length,
      wins,
      losses,
      totalProfit: sum(group.map((trade) => Number(trade.profit ?? 0))),
      averageRoi: average(group.map((trade) => Number(trade.roi ?? 0))),
      winRate: ratio(wins, wins + losses)
    };
  });
}

function bestByProfit(groups: GroupMetrics[]): GroupMetrics | null {
  return groups.length === 0 ? null : [...groups].sort((a, b) => b.totalProfit - a.totalProfit)[0];
}

function worstByProfit(groups: GroupMetrics[]): GroupMetrics | null {
  return groups.length === 0 ? null : [...groups].sort((a, b) => a.totalProfit - b.totalProfit)[0];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(round6(value));
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function formatNumber(value: number): string {
  return round6(value).toFixed(6);
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
