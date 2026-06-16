import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { PolymarketService } from "../polymarket/polymarket.service";
import { NormalizedCryptoMarket } from "../crypto/crypto-market.types";
import { DailyExitObservationService } from "../simulations/daily-exit-observation.service";

const DAILY_DISCOVERY_INTERVAL_MS = 60 * 1000;

export class DailyExitObserverJob {
  private readonly client = new PolymarketClient();
  private readonly polymarketService: PolymarketService;
  private readonly observationService: DailyExitObservationService;
  private lastDiscoveryAt = 0;

  constructor(private readonly logger: LoggerService) {
    this.polymarketService = new PolymarketService(this.client, logger);
    this.observationService = new DailyExitObservationService(logger);
  }

  async runOnce(): Promise<void> {
    let discovered: NormalizedCryptoMarket[] = [];
    if (Date.now() - this.lastDiscoveryAt >= DAILY_DISCOVERY_INTERVAL_MS) {
      discovered = await this.polymarketService.getFastCryptoUpDownDailyMarkets();
      this.lastDiscoveryAt = Date.now();
      for (const market of discovered) {
        try {
          await this.upsertMarket(market);
        } catch (error) {
          this.logger.error("Failed to store daily Up/Down market.", error, {
            slug: market.slug,
            assetSymbol: market.assetSymbol
          });
        }
      }
    }

    const now = new Date();
    const markets = await prisma.market.findMany({
      where: {
        category: "CRYPTO",
        marketType: "UP_DOWN_SHORT_TERM",
        timeframe: "1d",
        active: true,
        closed: false,
        endDate: {
          gt: now
        }
      },
      include: {
        outcomes: true
      },
      orderBy: { endDate: "asc" },
      take: 12
    });

    for (const market of markets) {
      try {
        const upTokenId = findTokenId(market.outcomes, ["UP", "YES"]);
        const downTokenId = findTokenId(market.outcomes, ["DOWN", "NO"]);
        if (!upTokenId || !downTokenId || !market.endDate) {
          continue;
        }

        const [upOrderBook, downOrderBook] = await Promise.all([
          this.client.getOrderBook(upTokenId),
          this.client.getOrderBook(downTokenId)
        ]);
        await this.observationService.observeMarket({
          marketId: market.id,
          assetSymbol: market.assetSymbol,
          secondsToClose: Math.max(
            0,
            Math.floor((market.endDate.getTime() - Date.now()) / 1_000)
          ),
          upOrderBook,
          downOrderBook
        });
      } catch (error) {
        this.logger.error("Daily multi-cycle observation failed for one market.", error, {
          marketId: market.id,
          slug: market.slug,
          assetSymbol: market.assetSymbol
        });
      }
    }

    const settled = await this.observationService.resolveExpiredCycles();
    this.logger.debug("Daily multi-cycle observer tick finished.", {
      discovered: discovered.length,
      markets: markets.length,
      settled
    });
  }

  private async upsertMarket(market: NormalizedCryptoMarket): Promise<void> {
    const externalMarketId =
      market.externalMarketId ?? `slug:${market.slug ?? market.question}`;
    const saved = await prisma.market.upsert({
      where: { externalMarketId },
      update: {
        slug: market.slug,
        question: market.question,
        category: market.category,
        assetSymbol: market.assetSymbol,
        baseAsset: market.baseAsset,
        quoteAsset: market.quoteAsset,
        marketType: "UP_DOWN_SHORT_TERM",
        timeframe: "1d",
        active: market.active,
        closed: market.closed,
        endDate: market.endDate,
        resolutionSource: market.resolutionSource,
        rawData: market.rawData
      },
      create: {
        externalMarketId,
        slug: market.slug,
        question: market.question,
        category: market.category,
        assetSymbol: market.assetSymbol,
        baseAsset: market.baseAsset,
        quoteAsset: market.quoteAsset,
        marketType: "UP_DOWN_SHORT_TERM",
        timeframe: "1d",
        active: market.active,
        closed: market.closed,
        endDate: market.endDate,
        resolutionSource: market.resolutionSource,
        rawData: market.rawData
      }
    });

    for (const outcome of market.outcomes) {
      const existing = outcome.externalTokenId
        ? await prisma.marketOutcome.findFirst({
            where: {
              marketId: saved.id,
              externalTokenId: outcome.externalTokenId
            }
          })
        : await prisma.marketOutcome.findFirst({
            where: {
              marketId: saved.id,
              normalizedName: outcome.normalizedName
            }
          });
      const data = {
        externalTokenId: outcome.externalTokenId,
        name: outcome.name,
        normalizedName: outcome.normalizedName,
        currentPrice:
          outcome.currentPrice === null
            ? null
            : new Prisma.Decimal(outcome.currentPrice)
      };

      if (existing) {
        await prisma.marketOutcome.update({
          where: { id: existing.id },
          data
        });
      } else {
        await prisma.marketOutcome.create({
          data: {
            marketId: saved.id,
            ...data
          }
        });
      }
    }
  }
}

function findTokenId(
  outcomes: Array<{ normalizedName: string; externalTokenId: string | null }>,
  names: string[]
): string | null {
  return outcomes.find(
    (outcome) =>
      names.includes(outcome.normalizedName) &&
      outcome.externalTokenId
  )?.externalTokenId ?? null;
}
