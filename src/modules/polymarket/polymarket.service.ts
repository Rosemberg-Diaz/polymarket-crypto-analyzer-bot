import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { NormalizedCryptoMarket } from "../crypto/crypto-market.types";
import { PolymarketClient } from "./polymarket.client";
import { mapPolymarketMarketToCryptoMarket, sortPolymarketCryptoMarkets } from "./polymarket.mapper";
import { GetActiveMarketsParams, PolymarketCryptoMarketSyncResult } from "./polymarket.types";

const ACTIVE_MARKET_PAGE_SIZE = 100;
const ACTIVE_MARKET_MAX_PAGES = 10;

export class PolymarketService {
  constructor(
    private readonly client = new PolymarketClient(),
    private readonly logger = new LoggerService("info")
  ) {}

  async getActiveCryptoMarkets(params: GetActiveMarketsParams = {}): Promise<NormalizedCryptoMarket[]> {
    const markets = await this.fetchCryptoMarketCandidates(params);

    if (markets.length === 0) {
      this.logger.warn("Polymarket returned no active markets.");
      return [];
    }

    const cryptoMarkets = markets
      .map((market) => mapPolymarketMarketToCryptoMarket(market))
      .filter((market): market is NormalizedCryptoMarket => market !== null);

    return sortPolymarketCryptoMarkets(cryptoMarkets);
  }

  private async fetchCryptoMarketCandidates(params: GetActiveMarketsParams): Promise<Awaited<ReturnType<PolymarketClient["getActiveMarkets"]>>> {
    const pageLimit = Math.min(params.limit ?? ACTIVE_MARKET_PAGE_SIZE, ACTIVE_MARKET_PAGE_SIZE);
    const pages = await Promise.all(
      Array.from({ length: ACTIVE_MARKET_MAX_PAGES }, (_, index) =>
        this.client.getActiveMarkets({
          limit: pageLimit,
          offset: params.offset !== undefined ? params.offset + index * pageLimit : index * pageLimit,
          active: true,
          closed: false,
          archived: false,
          includeRaw: true,
          category: params.category,
          tagId: params.tagId
        })
      )
    );
    const generalMarkets = pages.flat();
    const byKey = new Map<string, (typeof generalMarkets)[number]>();

    for (const market of generalMarkets) {
      const key = market.conditionId ?? market.id ?? market.slug;
      if (!key) {
        continue;
      }

      byKey.set(key, market);
    }

    const candidates = [...byKey.values()];
    this.logger.info("Polymarket candidate markets fetched.", {
      pages: ACTIVE_MARKET_MAX_PAGES,
      generalMarkets: generalMarkets.length,
      uniqueCandidates: candidates.length
    });

    return candidates;
  }

  async syncActiveCryptoMarkets(params: GetActiveMarketsParams = {}): Promise<PolymarketCryptoMarketSyncResult> {
    const fetchedMarkets = await this.client.getActiveMarkets({
      limit: params.limit ?? 200,
      offset: params.offset,
      active: true,
      closed: false,
      archived: false,
      includeRaw: true,
      category: params.category,
      tagId: params.tagId
    });
    const cryptoMarkets = sortPolymarketCryptoMarkets(
      fetchedMarkets
        .map((market) => mapPolymarketMarketToCryptoMarket(market))
        .filter((market): market is NormalizedCryptoMarket => market !== null)
    );

    let savedMarkets = 0;

    for (const market of cryptoMarkets) {
      await this.saveCryptoMarket(market);
      savedMarkets += 1;
    }

    const result = {
      fetchedMarkets: fetchedMarkets.length,
      cryptoMarkets: cryptoMarkets.length,
      savedMarkets,
      operableMarkets: cryptoMarkets.filter((market) => market.isOperable).length
    };

    this.logger.info("Polymarket crypto markets synced.", result);
    return result;
  }

  private async saveCryptoMarket(market: NormalizedCryptoMarket): Promise<void> {
    const savedMarket = await prisma.market.upsert({
      where: {
        externalMarketId: market.externalMarketId ?? `slug:${market.slug ?? market.question}`
      },
      update: {
        slug: market.slug,
        question: market.question,
        category: market.category,
        assetSymbol: market.assetSymbol,
        baseAsset: market.baseAsset,
        quoteAsset: market.quoteAsset,
        marketType: market.marketType,
        timeframe: market.timeframe,
        active: market.active,
        closed: market.closed,
        endDate: market.endDate,
        resolutionSource: market.resolutionSource,
        rawData: market.rawData
      },
      create: {
        externalMarketId: market.externalMarketId ?? `slug:${market.slug ?? market.question}`,
        slug: market.slug,
        question: market.question,
        category: market.category,
        assetSymbol: market.assetSymbol,
        baseAsset: market.baseAsset,
        quoteAsset: market.quoteAsset,
        marketType: market.marketType,
        timeframe: market.timeframe,
        active: market.active,
        closed: market.closed,
        endDate: market.endDate,
        resolutionSource: market.resolutionSource,
        rawData: market.rawData
      }
    });

    await prisma.marketOutcome.deleteMany({
      where: {
        marketId: savedMarket.id
      }
    });

    if (market.outcomes.length > 0) {
      await prisma.marketOutcome.createMany({
        data: market.outcomes.map((outcome) => ({
          marketId: savedMarket.id,
          externalTokenId: outcome.externalTokenId,
          name: outcome.name,
          normalizedName: outcome.normalizedName,
          currentPrice: outcome.currentPrice === null ? null : new Prisma.Decimal(outcome.currentPrice)
        }))
      });
    }
  }
}
