import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/client";
import { ApiRoute } from "../api.types";
import { getBooleanParam, getDateParam, getNumberParam, getStringParam, toNumber } from "../api.utils";

export const tradesRoutes: ApiRoute[] = [
  {
    method: "GET",
    path: "/api/trades",
    handler: async ({ url }) => {
      const where: Prisma.SimulatedTradeWhereInput = {};
      const createdAt: Prisma.DateTimeFilter = {};
      const limit = getNumberParam(url, "limit", 200, 500);

      const status = getStringParam(url, "status");
      const isWin = getBooleanParam(url, "isWin");
      const assetSymbol = getStringParam(url, "assetSymbol");
      const marketType = getStringParam(url, "marketType");
      const dateFrom = getDateParam(url, "dateFrom");
      const dateTo = getDateParam(url, "dateTo");

      if (status) where.status = status;
      if (isWin !== undefined) where.isWin = isWin;
      if (dateFrom) createdAt.gte = dateFrom;
      if (dateTo) createdAt.lte = dateTo;
      if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
      if (assetSymbol || marketType) {
        where.prediction = {};
        if (assetSymbol) where.prediction.assetSymbol = assetSymbol;
        if (marketType) where.prediction.marketType = marketType;
      }

      const trades = await prisma.simulatedTrade.findMany({
        where,
        include: {
          market: true,
          prediction: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: limit
      });

      return {
        trades: trades.map((trade) => ({
          id: trade.id,
          createdAt: trade.createdAt,
          assetSymbol: trade.prediction.assetSymbol,
          marketQuestion: trade.market.question,
          marketType: trade.prediction.marketType,
          prediction: trade.prediction.predictedOutcome,
          stake: toNumber(trade.stake),
          entryPrice: toNumber(trade.entryPrice),
          shares: toNumber(trade.shares),
          status: trade.status,
          result: trade.result,
          isWin: trade.isWin,
          finalValue: toNumber(trade.finalValue),
          profit: toNumber(trade.profit),
          roi: toNumber(trade.roi),
          resolvedAt: trade.resolvedAt
        }))
      };
    }
  }
];
