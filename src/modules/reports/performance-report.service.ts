import { Prisma } from "@prisma/client";
import { config } from "../../config/env";
import { prisma } from "../../database/client";

interface SegmentMetrics {
  key: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  averageRoi: number;
}

type ResolvedTrade = Awaited<ReturnType<typeof loadResolvedTrades>>[number];

export class PerformanceReportService {
  async generate(): Promise<string> {
    const trades = await loadResolvedTrades();
    const wins = trades.filter((trade) => trade.isWin === true).length;
    const losses = trades.filter((trade) => trade.isWin === false).length;
    const totalProfit = sum(trades.map((trade) => Number(trade.profit ?? 0)));
    const averageRoi = average(trades.map((trade) => Number(trade.roi ?? 0)));
    const streaks = calculateStreaks(trades);
    const drawdown = calculateApproxDrawdown(trades);

    return [
      "Performance Report - Polymarket Crypto Analyzer Bot",
      "",
      `Total general: ${trades.length}`,
      `Win rate general: ${formatPercent(ratio(wins, wins + losses))}`,
      `Profit total: ${formatNumber(totalProfit)}`,
      `ROI promedio: ${formatPercent(averageRoi)}`,
      `Peor racha: ${streaks.worstLosingStreak} perdidas`,
      `Mejor racha: ${streaks.bestWinningStreak} ganadas`,
      `Drawdown aproximado: ${formatNumber(drawdown)}`,
      `Operaciones resueltas disponibles para futuro ML: ${trades.length}`,
      `Mínimo recomendado para ML: ${config.mlMinResolvedTrades}`,
      "",
      "Rendimiento por estrategia:",
      formatSegment(groupTrades(trades, (trade) => trade.prediction.strategyName)),
      "",
      "Rendimiento por assetSymbol:",
      formatSegment(groupTrades(trades, (trade) => trade.prediction.assetSymbol)),
      "",
      "Rendimiento por marketType:",
      formatSegment(groupTrades(trades, (trade) => trade.prediction.marketType)),
      "",
      "Rendimiento por entryPrice range:",
      formatSegment(groupTrades(trades, (trade) => getEntryPriceRange(Number(trade.entryPrice)))),
      "",
      "Rendimiento por secondsToClose range:",
      formatSegment(groupTrades(trades, (trade) => getSecondsToCloseRange(trade.prediction.snapshot.secondsToClose)))
    ].join("\n");
  }
}

async function loadResolvedTrades() {
  return prisma.simulatedTrade.findMany({
    where: {
      status: "RESOLVED"
    },
    include: {
      prediction: {
        include: {
          snapshot: true
        }
      }
    },
    orderBy: {
      resolvedAt: "asc"
    }
  });
}

function groupTrades(trades: ResolvedTrade[], getKey: (trade: ResolvedTrade) => string): SegmentMetrics[] {
  const groups = new Map<string, ResolvedTrade[]>();

  for (const trade of trades) {
    const key = getKey(trade);
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const wins = group.filter((trade) => trade.isWin === true).length;
      const losses = group.filter((trade) => trade.isWin === false).length;

      return {
        key,
        totalTrades: group.length,
        wins,
        losses,
        winRate: ratio(wins, wins + losses),
        totalProfit: sum(group.map((trade) => Number(trade.profit ?? new Prisma.Decimal(0)))),
        averageRoi: average(group.map((trade) => Number(trade.roi ?? new Prisma.Decimal(0))))
      };
    })
    .sort((a, b) => b.totalProfit - a.totalProfit);
}

function formatSegment(groups: SegmentMetrics[]): string {
  if (groups.length === 0) {
    return "- Sin operaciones resueltas.";
  }

  return groups
    .map(
      (group) =>
        `- ${group.key}: trades=${group.totalTrades}, winRate=${formatPercent(group.winRate)}, profit=${formatNumber(
          group.totalProfit
        )}, avgRoi=${formatPercent(group.averageRoi)}`
    )
    .join("\n");
}

function calculateStreaks(trades: ResolvedTrade[]): { bestWinningStreak: number; worstLosingStreak: number } {
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let bestWinningStreak = 0;
  let worstLosingStreak = 0;

  for (const trade of trades) {
    if (trade.isWin === true) {
      currentWinStreak += 1;
      currentLossStreak = 0;
    } else if (trade.isWin === false) {
      currentLossStreak += 1;
      currentWinStreak = 0;
    }

    bestWinningStreak = Math.max(bestWinningStreak, currentWinStreak);
    worstLosingStreak = Math.max(worstLosingStreak, currentLossStreak);
  }

  return { bestWinningStreak, worstLosingStreak };
}

function calculateApproxDrawdown(trades: ResolvedTrade[]): number {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    equity += Number(trade.profit ?? 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  return maxDrawdown;
}

function getEntryPriceRange(entryPrice: number): string {
  if (entryPrice < 0.2) return "0.05-0.20";
  if (entryPrice < 0.4) return "0.20-0.40";
  if (entryPrice < 0.6) return "0.40-0.60";
  if (entryPrice < 0.8) return "0.60-0.80";
  return "0.80-0.95";
}

function getSecondsToCloseRange(secondsToClose: number | null): string {
  if (secondsToClose === null) return "unknown";
  if (secondsToClose < 60) return "<60s";
  if (secondsToClose < 300) return "60s-5m";
  if (secondsToClose < 900) return "5m-15m";
  if (secondsToClose < 3600) return "15m-1h";
  return ">1h";
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

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function formatNumber(value: number): string {
  return round6(value).toFixed(6);
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
