import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { NormalizedCryptoMarket } from "../crypto/crypto-market.types";
import { PolymarketClient } from "./polymarket.client";
import { mapPolymarketMarketToCryptoMarket, sortPolymarketCryptoMarkets } from "./polymarket.mapper";
import {
  GetActiveMarketsParams,
  PolymarketCryptoMarketSyncResult,
  PolymarketEvent,
  PolymarketMarket
} from "./polymarket.types";

const ACTIVE_MARKET_PAGE_SIZE = 100;
const ACTIVE_MARKET_MAX_PAGES = 10;
const ACTIVE_EVENT_PAGE_SIZE = 100;
const ACTIVE_EVENT_MAX_PAGES = 3;
const ACTIVE_SERIES_PAGE_SIZE = 100;
const ACTIVE_SERIES_MAX_PAGES = 2;
const CLOB_SAMPLING_MARKET_MAX_PAGES = 6;
const DISCOVERY_CACHE_TTL_MS = 60 * 1000;
const RECURRING_UP_DOWN_ASSETS = ["btc", "eth", "sol"] as const;
const RECURRING_UP_DOWN_TIMEFRAME_SECONDS = 5 * 60;
const FAST_RECURRING_UP_DOWN_WINDOW_OFFSETS_SECONDS = [0];
const RECURRING_UP_DOWN_WINDOW_OFFSETS_SECONDS = [
  -5 * 60,
  0,
  5 * 60,
  10 * 60,
  15 * 60,
  20 * 60,
  25 * 60,
  30 * 60
];
const TARGETED_DISCOVERY_QUERIES = [
  "Bitcoin up down",
  "BTC up down",
  "Ethereum up down",
  "ETH up down",
  "Solana up down",
  "SOL up down",
  "crypto up down",
  "Bitcoin 5 minute",
  "Ethereum 15 minute",
  "Solana hourly",
  "Bitcoin today",
  "Ethereum today"
];

interface DiscoveryCache {
  expiresAt: number;
  markets: PolymarketMarket[];
}

export class PolymarketService {
  private discoveryCache: DiscoveryCache | null = null;

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

  async getFastCryptoUpDown5mMarkets(): Promise<NormalizedCryptoMarket[]> {
    const markets = await this.fetchRecurringCryptoUpDownMarkets(FAST_RECURRING_UP_DOWN_WINDOW_OFFSETS_SECONDS);
    const cryptoMarkets = markets
      .map((market) => mapPolymarketMarketToCryptoMarket(market))
      .filter((market): market is NormalizedCryptoMarket => market !== null)
      .filter((market) => market.marketType === "UP_DOWN_SHORT_TERM" && market.timeframe === "5m");

    return sortPolymarketCryptoMarkets(cryptoMarkets);
  }

  private async fetchCryptoMarketCandidates(params: GetActiveMarketsParams): Promise<PolymarketMarket[]> {
    const now = Date.now();
    if (!params.offset && !params.tagId && !params.category && this.discoveryCache && this.discoveryCache.expiresAt > now) {
      this.logger.debug("Using cached Polymarket discovery candidates.", {
        uniqueCandidates: this.discoveryCache.markets.length,
        ttlSeconds: Math.ceil((this.discoveryCache.expiresAt - now) / 1000)
      });
      return this.discoveryCache.markets;
    }

    const pageLimit = Math.min(params.limit ?? ACTIVE_MARKET_PAGE_SIZE, ACTIVE_MARKET_PAGE_SIZE);
    const marketPages = await Promise.all(
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
    const eventPages = await Promise.all(
      Array.from({ length: ACTIVE_EVENT_MAX_PAGES }, (_, index) =>
        this.client.getActiveEvents({
          limit: ACTIVE_EVENT_PAGE_SIZE,
          offset: index * ACTIVE_EVENT_PAGE_SIZE,
          active: true,
          closed: false,
          archived: false,
          includeRaw: true
        })
      )
    );
    const seriesPages = await Promise.all(
      Array.from({ length: ACTIVE_SERIES_MAX_PAGES }, (_, index) =>
        this.client.getActiveSeries({
          limit: ACTIVE_SERIES_PAGE_SIZE,
          offset: index * ACTIVE_SERIES_PAGE_SIZE,
          active: true,
          closed: false,
          archived: false,
          includeRaw: true
        })
      )
    );
    const marketSearches = await Promise.all(
      TARGETED_DISCOVERY_QUERIES.map((query) => this.client.searchMarkets(query))
    );
    const eventSearches = await Promise.all(
      TARGETED_DISCOVERY_QUERIES.map((query) => this.client.searchEvents(query))
    );
    const seriesSearches = await Promise.all(
      TARGETED_DISCOVERY_QUERIES.map((query) => this.client.searchSeries(query))
    );
    const recurringUpDownMarkets = await this.fetchRecurringCryptoUpDownMarkets(
      RECURRING_UP_DOWN_WINDOW_OFFSETS_SECONDS
    );
    const samplingMarkets = await this.fetchClobSamplingMarkets();
    const generalMarkets = marketPages.flat();
    const activeEvents = eventPages.flat();
    const activeSeries = seriesPages.flat();
    const searchedMarkets = marketSearches.flat();
    const searchedEvents = eventSearches.flat();
    const searchedSeries = seriesSearches.flat();
    const marketsFromEvents = [
      ...extractMarketsFromEvents(activeEvents),
      ...extractMarketsFromEvents(activeSeries),
      ...extractMarketsFromEvents(searchedEvents),
      ...extractMarketsFromEvents(searchedSeries)
    ];
    const allCandidates = [
      ...recurringUpDownMarkets,
      ...generalMarkets,
      ...searchedMarkets,
      ...marketsFromEvents,
      ...samplingMarkets
    ];
    const byKey = new Map<string, PolymarketMarket>();

    for (const market of allCandidates) {
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
      searchedMarkets: searchedMarkets.length,
      activeEvents: activeEvents.length,
      activeSeries: activeSeries.length,
      searchedEvents: searchedEvents.length,
      searchedSeries: searchedSeries.length,
      recurringUpDownMarkets: recurringUpDownMarkets.length,
      marketsFromEvents: marketsFromEvents.length,
      samplingMarkets: samplingMarkets.length,
      uniqueCandidates: candidates.length
    });

    if (!params.offset && !params.tagId && !params.category) {
      this.discoveryCache = {
        expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
        markets: candidates
      };
    }

    return candidates;
  }

  private async fetchRecurringCryptoUpDownMarkets(offsetsSeconds: number[]): Promise<PolymarketMarket[]> {
    const baseTimestamp =
      Math.floor(Date.now() / 1000 / RECURRING_UP_DOWN_TIMEFRAME_SECONDS) *
      RECURRING_UP_DOWN_TIMEFRAME_SECONDS;
    const slugs = RECURRING_UP_DOWN_ASSETS.flatMap((asset) =>
      offsetsSeconds.map((offset) => `${asset}-updown-5m-${baseTimestamp + offset}`)
    );
    const events = await Promise.all(slugs.map((slug) => this.client.getEventBySlug(slug)));

    return extractMarketsFromEvents(
      events.filter((event): event is PolymarketEvent => event !== null)
    ).filter((market) => {
      const endDate = market.endDate ? new Date(market.endDate) : null;
      const isExpired = endDate !== null && endDate.getTime() <= Date.now() + 20 * 1000;

      return market.active !== false && market.closed !== true && !isExpired;
    });
  }

  private async fetchClobSamplingMarkets(): Promise<PolymarketMarket[]> {
    const markets: PolymarketMarket[] = [];
    let nextCursor: string | null = null;

    for (let page = 0; page < CLOB_SAMPLING_MARKET_MAX_PAGES; page += 1) {
      const result = await this.client.getSamplingMarketsPage({
        nextCursor: nextCursor ?? undefined,
        includeRaw: true
      });

      markets.push(...result.markets);

      if (!result.nextCursor || result.nextCursor === "LTE=") {
        break;
      }

      nextCursor = result.nextCursor;
    }

    return markets;
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

function extractMarketsFromEvents(events: PolymarketEvent[]): PolymarketMarket[] {
  return events.flatMap((event) => event.markets ?? []);
}
