import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/client";
import { ApiRoute } from "../api.types";
import { getBooleanParam, getNumberParam, getStringParam, toNumber } from "../api.utils";

export const marketsRoutes: ApiRoute[] = [
  {
    method: "GET",
    path: "/api/markets",
    handler: async ({ url }) => {
      const where: Prisma.MarketWhereInput = {
        category: "CRYPTO"
      };
      const assetSymbol = getStringParam(url, "assetSymbol");
      const marketType = getStringParam(url, "marketType");
      const active = getBooleanParam(url, "active");
      const closed = getBooleanParam(url, "closed");
      const limit = getNumberParam(url, "limit", 100, 500);

      if (assetSymbol) where.assetSymbol = assetSymbol;
      if (marketType) where.marketType = marketType;
      if (active !== undefined) where.active = active;
      if (closed !== undefined) where.closed = closed;

      const markets = await prisma.market.findMany({
        where,
        include: {
          snapshots: {
            orderBy: { createdAt: "desc" },
            take: 1
          },
          outcomes: true
        },
        orderBy: {
          updatedAt: "desc"
        },
        take: limit
      });

      return {
        markets: markets.map((market) => ({
          id: market.id,
          externalMarketId: market.externalMarketId,
          slug: market.slug,
          question: market.question,
          category: market.category,
          assetSymbol: market.assetSymbol,
          marketType: market.marketType,
          timeframe: market.timeframe,
          active: market.active,
          closed: market.closed,
          endDate: market.endDate,
          updatedAt: market.updatedAt,
          outcomes: market.outcomes,
          lastSnapshot: market.snapshots[0]
            ? {
                createdAt: market.snapshots[0].createdAt,
                upPrice: toNumber(market.snapshots[0].upPrice),
                downPrice: toNumber(market.snapshots[0].downPrice),
                currentAssetPrice: toNumber(market.snapshots[0].currentAssetPrice),
                spread: toNumber(market.snapshots[0].spread),
                liquidity: toNumber(market.snapshots[0].liquidity)
              }
            : null
        }))
      };
    }
  }
];
