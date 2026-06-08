import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { ObservationEvaluationService } from "../simulations/observation-evaluation.service";
import {
  inferGammaWinnerFromOutcomePrices,
  inferWinningOutcome,
  normalizeOutcome
} from "./resolve-simulated-trades.job";

const PENDING_LIMIT = 50;
const OFFICIAL_RESOLUTION_DELAY_MS = 60 * 1000;

export class ResolveObservationEvaluationsJob {
  constructor(
    private readonly logger: LoggerService,
    private readonly polymarketClient = new PolymarketClient(),
    private readonly observationService = new ObservationEvaluationService()
  ) {}

  async runOnce(): Promise<void> {
    const observations = await prisma.observationEvaluation.findMany({
      where: { status: "PENDING" },
      include: {
        prediction: true,
        market: true
      },
      orderBy: { createdAt: "asc" },
      take: PENDING_LIMIT
    });

    for (const observation of observations) {
      try {
        if (
          observation.market.endDate &&
          Date.now() < observation.market.endDate.getTime() + OFFICIAL_RESOLUTION_DELAY_MS
        ) {
          continue;
        }

        const slug = observation.market.slug;
        if (!slug) {
          this.logger.warn("Cannot resolve shadow observation because market slug is missing.", {
            observationId: observation.id,
            marketId: observation.marketId
          });
          continue;
        }

        const market = await this.polymarketClient.getMarketBySlug(slug);
        if (!market) {
          continue;
        }

        const winner = inferWinningOutcome(market) ?? inferGammaWinnerFromOutcomePrices(market);
        if (!winner || !winner.trustedForLearning) {
          continue;
        }

        const didWin =
          normalizeOutcome(observation.prediction.predictedOutcome) === winner.normalizedName;
        const result = `${winner.normalizedName}:${winner.source}`;

        const resolved = await this.observationService.resolveObservation(
          observation.id,
          didWin,
          result,
          winner.source
        );

        this.logger.info("Shadow observation resolved.", {
          observationId: observation.id,
          observationType: observation.observationType,
          market: observation.market.question,
          asset: observation.prediction.assetSymbol,
          prediction: observation.prediction.predictedOutcome,
          entryPrice: Number(observation.entryPrice),
          hypotheticalStake: Number(observation.hypotheticalStake),
          result: winner.normalizedName,
          resolutionSource: winner.source,
          wouldWin: resolved.wouldWin,
          hypotheticalProfit:
            resolved.hypotheticalProfit === null ? null : Number(resolved.hypotheticalProfit),
          hypotheticalRoi:
            resolved.hypotheticalRoi === null ? null : Number(resolved.hypotheticalRoi)
        });
      } catch (error) {
        this.logger.error("Failed to resolve shadow observation.", error, {
          observationId: observation.id,
          marketId: observation.marketId
        });
      }
    }
  }
}
