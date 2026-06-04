import { prisma } from "../../../database/client";
import { config } from "../../../config/env";
import { ApiRoute } from "../api.types";
import { ratio, round6, sum, toNumber } from "../api.utils";

export const learningRoutes: ApiRoute[] = [
  {
    method: "GET",
    path: "/api/learning/stats",
    handler: async () => {
      const [learningStats, resolvedTrades] = await Promise.all([
        prisma.learningStat.findMany({
          orderBy: [
            { totalPredictions: "desc" },
            { totalProfit: "desc" }
          ]
        }),
        prisma.simulatedTrade.findMany({
          where: { status: "RESOLVED" },
          include: {
            prediction: true
          }
        })
      ]);

      return {
        mlReady: resolvedTrades.length >= config.mlMinResolvedTrades,
        resolvedTradesForMl: resolvedTrades.length,
        minResolvedTradesForMl: config.mlMinResolvedTrades,
        similarCasesAccumulated: learningStats.reduce((total, stat) => total + stat.totalPredictions, 0),
        byAsset: groupResolvedTrades(resolvedTrades, (trade) => trade.prediction.assetSymbol),
        byStrategy: groupResolvedTrades(resolvedTrades, (trade) => trade.prediction.strategyName),
        byMarketType: groupResolvedTrades(resolvedTrades, (trade) => trade.prediction.marketType),
        byPredictedOutcome: groupResolvedTrades(resolvedTrades, (trade) => trade.prediction.predictedOutcome),
        learningStats: learningStats.map((stat) => ({
          id: stat.id,
          strategyName: stat.strategyName,
          marketType: stat.marketType,
          assetSymbol: stat.assetSymbol,
          predictedOutcome: stat.predictedOutcome,
          totalPredictions: stat.totalPredictions,
          wins: stat.wins,
          losses: stat.losses,
          winRate: toNumber(stat.winRate),
          totalProfit: toNumber(stat.totalProfit),
          averageRoi: toNumber(stat.averageRoi),
          maxDrawdown: toNumber(stat.maxDrawdown),
          updatedAt: stat.updatedAt
        }))
      };
    }
  }
];

function groupResolvedTrades<T extends { isWin: boolean | null; profit: unknown; roi: unknown }>(
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
        totalProfit: round6(sum(group.map((trade) => Number(trade.profit ?? 0)))),
        averageRoi: round6(sum(group.map((trade) => Number(trade.roi ?? 0))) / Math.max(group.length, 1))
      };
    })
    .sort((a, b) => b.totalProfit - a.totalProfit);
}
