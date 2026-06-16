import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { PolymarketClient } from "../polymarket/polymarket.client";
import { ShortTermExitObservationService } from "../simulations/short-term-exit-observation.service";
import { config } from "../../config/env";
import { LiveShortExitTradingService } from "../trading/live-short-exit-trading.service";
import { PolymarketTradingService } from "../trading/polymarket-trading.service";

const CURRENT_MARKET_LOOKAHEAD_MS = 15 * 60 * 1000;
const MAX_MARKETS_PER_TICK = 16;

export class ShortTermExitObserverJob {
  private readonly polymarketClient = new PolymarketClient();
  private readonly observationService: ShortTermExitObservationService;
  private readonly tradingService: PolymarketTradingService | null;

  constructor(private readonly logger: LoggerService) {
    if (
      config.enableShortExitRealTrading &&
      config.enableRealTrading &&
      config.polygonPrivateKey &&
      config.addressWallet
    ) {
      this.tradingService = new PolymarketTradingService(
        config.polygonPrivateKey,
        config.addressWallet,
        logger,
        config.polymarketApiKey ?? undefined,
        config.polymarketSecret ?? undefined,
        config.polymarketPassphrase ?? undefined,
        config.polymarketFunderAddress ?? undefined
      );
      const liveTradingService = new LiveShortExitTradingService(
        this.tradingService,
        logger
      );
      this.observationService = new ShortTermExitObservationService(
        logger,
        liveTradingService
      );
      void this.tradingService.initialize().then((ready) => {
        if (ready) {
          logger.info("Live short-exit trading service is ready.", {
            assets: config.shortExitRealAssets,
            stakeUsd: config.shortExitRealStakeUsd,
            entryPriceRange: [
              config.shortExitRealEntryPriceMin,
              config.shortExitRealEntryPriceMax
            ]
          });
        }
      });
    } else {
      this.tradingService = null;
      this.observationService = new ShortTermExitObservationService(logger);

      if (config.enableShortExitRealTrading) {
        logger.error("Live short-exit trading requested but credentials or global live mode are missing.");
      }
    }
  }

  async runOnce(): Promise<void> {
    const now = new Date();
    const markets = await prisma.market.findMany({
      where: {
        category: "CRYPTO",
        marketType: "UP_DOWN_SHORT_TERM",
        timeframe: {
          in: ["5m", "15m"]
        },
        endDate: {
          gt: now,
          lte: new Date(now.getTime() + CURRENT_MARKET_LOOKAHEAD_MS)
        }
      },
      include: {
        outcomes: true,
        snapshots: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { endDate: "asc" },
      take: MAX_MARKETS_PER_TICK
    });

    for (const market of markets) {
      try {
        const upTokenId = findTokenId(market.outcomes, ["UP", "YES"]);
        const downTokenId = findTokenId(market.outcomes, ["DOWN", "NO"]);
        if (!upTokenId || !downTokenId || !market.endDate) {
          continue;
        }

        const [upOrderBook, downOrderBook] = await Promise.all([
          this.polymarketClient.getOrderBook(upTokenId),
          this.polymarketClient.getOrderBook(downTokenId)
        ]);
        const latestSnapshot = market.snapshots[0];

        await this.observationService.observeMarket({
          marketId: market.id,
          assetSymbol: market.assetSymbol,
          timeframe: market.timeframe as "5m" | "15m",
          liquidity: latestSnapshot?.liquidity === null ||
            latestSnapshot?.liquidity === undefined
            ? null
            : Number(latestSnapshot.liquidity),
          secondsToClose: Math.max(
            0,
            Math.floor((market.endDate.getTime() - Date.now()) / 1_000)
          ),
          upOrderBook,
          downOrderBook
        });
      } catch (error) {
        this.logger.error("Fast short-term exit observation failed for one market.", error, {
          marketId: market.id,
          slug: market.slug,
          assetSymbol: market.assetSymbol
        });
      }
    }

    const closedExpired = await this.observationService.closeExpiredObservations();
    this.logger.debug("Fast short-term exit observer tick finished.", {
      markets: markets.length,
      closedExpired
    });
  }
}

function findTokenId(
  outcomes: Array<{ normalizedName: string; externalTokenId: string | null }>,
  names: string[]
): string | null {
  return outcomes.find(
    (outcome) => names.includes(outcome.normalizedName) && outcome.externalTokenId
  )?.externalTokenId ?? null;
}
