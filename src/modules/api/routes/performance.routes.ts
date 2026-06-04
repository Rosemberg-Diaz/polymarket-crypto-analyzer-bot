import { config } from "../../../config/env";
import { prisma } from "../../../database/client";
import { ApiRoute } from "../api.types";
import { average, ratio, round6, sum, toNumber } from "../api.utils";

export const performanceRoutes: ApiRoute[] = [
  {
    method: "GET",
    path: "/api/performance/summary",
    handler: async () => {
      const [totalPredictions, trades, predictionsByDay] = await Promise.all([
        prisma.botPrediction.count(),
        prisma.simulatedTrade.findMany({
          include: {
            prediction: {
              include: {
                market: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }),
        prisma.botPrediction.findMany({
          select: {
            createdAt: true
          },
          orderBy: {
            createdAt: "asc"
          }
        })
      ]);

      const resolvedTrades = trades.filter((trade) => trade.status === "RESOLVED");
      const wins = resolvedTrades.filter((trade) => trade.isWin === true).length;
      const losses = resolvedTrades.filter((trade) => trade.isWin === false).length;
      const totalProfit = round6(sum(resolvedTrades.map((trade) => toNumber(trade.profit) ?? 0)));
      const averageRoi = round6(average(resolvedTrades.map((trade) => toNumber(trade.roi) ?? 0)));
      const byAsset = groupTrades(resolvedTrades, (trade) => trade.prediction.assetSymbol);
      const byStrategy = groupTrades(resolvedTrades, (trade) => trade.prediction.strategyName);
      const cumulativeProfit = buildCumulativeProfit(resolvedTrades);
      const signalsByDay = groupPredictionsByDay(predictionsByDay);

      return {
        totalPredictions,
        totalTrades: trades.length,
        wins,
        losses,
        winRate: round6(ratio(wins, wins + losses)),
        totalProfit,
        averageRoi,
        bestAsset: byAsset[0]?.key ?? null,
        worstAsset: byAsset.at(-1)?.key ?? null,
        bestStrategy: byStrategy[0]?.key ?? null,
        worstStrategy: byStrategy.at(-1)?.key ?? null,
        mlReady: resolvedTrades.length >= config.mlMinResolvedTrades,
        resolvedTradesForMl: resolvedTrades.length,
        minResolvedTradesForMl: config.mlMinResolvedTrades,
        charts: {
          cumulativeProfit,
          winRateByAsset: byAsset,
          profitByStrategy: byStrategy,
          signalsByDay
        }
      };
    }
  }
];

function groupTrades<T extends { isWin: boolean | null; profit: unknown }>(
  trades: T[],
  getKey: (trade: T) => string
) {
  const groups = new Map<string, T[]>();
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
        winRate: round6(ratio(wins, wins + losses)),
        totalProfit: round6(sum(group.map((trade) => Number(trade.profit ?? 0))))
      };
    })
    .sort((a, b) => b.totalProfit - a.totalProfit);
}

function buildCumulativeProfit(
  trades: Array<{ resolvedAt: Date | null; createdAt: Date; profit: unknown }>
) {
  let running = 0;
  return trades
    .filter((trade) => trade.resolvedAt !== null)
    .map((trade) => {
      running += Number(trade.profit ?? 0);
      return {
        date: (trade.resolvedAt ?? trade.createdAt).toISOString(),
        profit: round6(running)
      };
    });
}

function groupPredictionsByDay(predictions: Array<{ createdAt: Date }>) {
  const counts = new Map<string, number>();
  for (const prediction of predictions) {
    const key = prediction.createdAt.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()].map(([date, count]) => ({ date, count }));
}
