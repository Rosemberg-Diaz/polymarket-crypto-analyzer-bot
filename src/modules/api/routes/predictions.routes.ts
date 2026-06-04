import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/client";
import { ApiRoute } from "../api.types";
import { getDateParam, getNumberParam, getStringParam, toNumber } from "../api.utils";

export const predictionsRoutes: ApiRoute[] = [
  {
    method: "GET",
    path: "/api/predictions",
    handler: async ({ url }) => {
      const where: Prisma.BotPredictionWhereInput = {};
      const createdAt: Prisma.DateTimeFilter = {};
      const limit = getNumberParam(url, "limit", 200, 500);

      const filters = ["assetSymbol", "marketType", "strategyName", "recommendation"] as const;
      for (const filter of filters) {
        const value = getStringParam(url, filter);
        if (value) where[filter] = value;
      }

      const confidence = getStringParam(url, "confidence");
      if (confidence) {
        const score = confidence.toUpperCase() === "HIGH" ? 0.85 : confidence.toUpperCase() === "MODERATE" ? 0.6 : 0.35;
        where.confidence = { gte: score - 0.01, lte: score + 0.01 };
      }

      const dateFrom = getDateParam(url, "dateFrom");
      const dateTo = getDateParam(url, "dateTo");
      if (dateFrom) createdAt.gte = dateFrom;
      if (dateTo) createdAt.lte = dateTo;
      if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

      const predictions = await prisma.botPrediction.findMany({
        where,
        include: {
          market: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: limit
      });

      return {
        predictions: predictions.map((prediction) => ({
          id: prediction.id,
          createdAt: prediction.createdAt,
          assetSymbol: prediction.assetSymbol,
          marketQuestion: prediction.market.question,
          marketSlug: prediction.market.slug,
          marketType: prediction.marketType,
          strategyName: prediction.strategyName,
          predictedOutcome: prediction.predictedOutcome,
          entryPrice: toNumber(prediction.entryPrice),
          impliedProbability: toNumber(prediction.impliedProbability),
          botProbability: toNumber(prediction.botProbability),
          edge: toNumber(prediction.edge),
          recommendation: prediction.recommendation,
          confidence: toNumber(prediction.confidence),
          reason: prediction.reason,
          historicalSummary: prediction.historicalSummary
        }))
      };
    }
  }
];
