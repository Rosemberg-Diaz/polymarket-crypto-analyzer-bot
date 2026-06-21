import { Prisma } from "@prisma/client";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import {
  PolymarketWalletActivity,
  PolymarketWalletDataService
} from "../market-data/polymarket-wallet-data.service";
import { PolymarketTradingService } from "../trading/polymarket-trading.service";

const TIMEZONE = "America/Bogota";
const DAILY_REFRESH_MS = 5 * 60_000;
const BUY_MATCH_WINDOW_MS = 10 * 60_000;
const EPSILON = 0.000001;

export class ReconcilePolymarketWalletJob {
  private readonly dataService: PolymarketWalletDataService;
  private readonly tradingService: PolymarketTradingService;
  private initialized = false;
  private lastDailyRefreshAt = 0;

  constructor(private readonly logger: LoggerService) {
    const walletAddress =
      config.polymarketFunderAddress ?? config.addressWallet ?? "";
    this.dataService = new PolymarketWalletDataService(walletAddress);
    this.tradingService = new PolymarketTradingService(
      config.polygonPrivateKey ?? "",
      config.addressWallet ?? "",
      logger,
      config.polymarketApiKey ?? undefined,
      config.polymarketSecret ?? undefined,
      config.polymarketPassphrase ?? undefined,
      walletAddress
    );
  }

  async runOnce(): Promise<void> {
    try {
      const [activity, positions] = await Promise.all([
        this.dataService.getActivity(),
        this.dataService.getPositions()
      ]);
      await this.reconcileResolvedTrades(activity);

      if (Date.now() - this.lastDailyRefreshAt >= DAILY_REFRESH_MS) {
        const cashUsd = await this.getReliableCashBalance();
        if (cashUsd !== null) {
          await this.updateDailyPnl(activity, positions, cashUsd);
          this.lastDailyRefreshAt = Date.now();
        }
      }
    } catch (error) {
      this.logger.error("Polymarket wallet reconciliation failed.", error);
    }
  }

  private async reconcileResolvedTrades(
    activity: PolymarketWalletActivity[]
  ): Promise<void> {
    const pending = await prisma.liveOutcomeCheckpointTrade.findMany({
      where: {
        status: "RESOLVED",
        reconciliationStatus: { not: "RECONCILED" }
      },
      include: {
        market: { select: { slug: true } }
      },
      orderBy: { openedAt: "asc" },
      take: 100
    });
    if (pending.length === 0) return;

    const allMarketTrades = await prisma.liveOutcomeCheckpointTrade.findMany({
      where: {
        status: "RESOLVED",
        marketId: { in: [...new Set(pending.map((trade) => trade.marketId))] }
      },
      include: {
        market: { select: { slug: true } }
      }
    });
    const usedBuyTransactions = new Set(
      allMarketTrades
        .map((trade) => trade.buyTransactionHash)
        .filter((value): value is string => Boolean(value))
    );

    for (const trade of pending) {
      const slug = trade.market.slug ?? "";
      const buy = findBestBuyActivity({
        activity,
        tokenId: trade.tokenId,
        slug,
        openedAt: trade.openedAt,
        expectedUsdc: Number(trade.cashAmount),
        excludedTransactions: usedBuyTransactions
      });
      if (!buy) {
        await this.setReconciliationStatus(trade.id, "WAITING_BUY_ACTIVITY");
        continue;
      }
      usedBuyTransactions.add(buy.transactionHash);

      let payoutUsd = 0;
      let redeemTransactionHash: string | null = null;
      if (trade.isWin === true) {
        const redemptions = activity.filter(
          (row) =>
            row.type === "REDEEM" &&
            row.slug === slug &&
            row.usdcSize > 0
        );
        if (redemptions.length === 0) {
          await prisma.liveOutcomeCheckpointTrade.update({
            where: { id: trade.id },
            data: {
              actualBuyUsdc: decimal(buy.usdcSize),
              buyTransactionHash: buy.transactionHash || null,
              reconciliationStatus: "WAITING_REDEEM"
            }
          });
          continue;
        }

        const totalRedeemed = redemptions.reduce(
          (sum, row) => sum + row.usdcSize,
          0
        );
        const winningTrades = allMarketTrades.filter(
          (row) => row.market.slug === slug && row.isWin === true
        );
        const totalWinningShares = winningTrades.reduce(
          (sum, row) => sum + Number(row.filledShares),
          0
        );
        payoutUsd = totalWinningShares > 0
          ? totalRedeemed * Number(trade.filledShares) / totalWinningShares
          : totalRedeemed;
        redeemTransactionHash = redemptions[0]?.transactionHash ?? null;
      }

      const actualProfit = payoutUsd - buy.usdcSize;
      const actualRoi = buy.usdcSize > 0
        ? actualProfit / buy.usdcSize
        : 0;
      await prisma.liveOutcomeCheckpointTrade.update({
        where: { id: trade.id },
        data: {
          actualBuyUsdc: decimal(buy.usdcSize),
          actualPayoutUsdc: decimal(payoutUsd),
          actualProfit: decimal(actualProfit),
          actualRoi: decimal(actualRoi),
          buyTransactionHash: buy.transactionHash || null,
          redeemTransactionHash,
          reconciliationStatus: "RECONCILED",
          reconciledAt: new Date()
        }
      });

      this.logger.info("Live outcome trade reconciled with Polymarket ledger.", {
        tradeId: trade.id,
        slug,
        actualBuyUsdc: buy.usdcSize,
        actualPayoutUsdc: payoutUsd,
        actualProfit,
        theoreticalProfit: Number(trade.profit ?? 0)
      });
    }
  }

  private async updateDailyPnl(
    activity: PolymarketWalletActivity[],
    positions: Array<{ currentValue: number }>,
    cashUsd: number
  ): Promise<void> {
    const now = new Date();
    const dayKey = getBogotaDayKey(now);
    const dayActivity = activity.filter(
      (row) => getBogotaDayKey(new Date(row.timestamp * 1_000)) === dayKey
    );
    const totals = calculateActivityTotals(dayActivity);
    const positionsUsd = positions.reduce(
      (sum, position) => sum + position.currentValue,
      0
    );
    const equityUsd = cashUsd + positionsUsd;
    const existing = await prisma.walletDailyPnl.findUnique({
      where: { dayKey }
    });

    if (!existing) {
      await prisma.walletDailyPnl.create({
        data: {
          dayKey,
          openingCashUsd: decimal(cashUsd),
          openingPositionsUsd: decimal(positionsUsd),
          openingEquityUsd: decimal(equityUsd),
          closingCashUsd: decimal(cashUsd),
          closingPositionsUsd: decimal(positionsUsd),
          closingEquityUsd: decimal(equityUsd),
          buyUsdc: decimal(totals.buyUsdc),
          sellUsdc: decimal(totals.sellUsdc),
          redeemUsdc: decimal(totals.redeemUsdc),
          realizedTradingPnl: decimal(totals.realizedTradingPnl),
          equityChange: decimal(0),
          isComplete: false,
          firstCapturedAt: now,
          lastCapturedAt: now
        }
      });
    } else {
      await prisma.walletDailyPnl.update({
        where: { dayKey },
        data: {
          closingCashUsd: decimal(cashUsd),
          closingPositionsUsd: decimal(positionsUsd),
          closingEquityUsd: decimal(equityUsd),
          buyUsdc: decimal(totals.buyUsdc),
          sellUsdc: decimal(totals.sellUsdc),
          redeemUsdc: decimal(totals.redeemUsdc),
          realizedTradingPnl: decimal(totals.realizedTradingPnl),
          equityChange: decimal(equityUsd - Number(existing.openingEquityUsd)),
          lastCapturedAt: now
        }
      });
    }

    await prisma.walletDailyPnl.updateMany({
      where: { dayKey: { not: dayKey }, isComplete: false },
      data: { isComplete: true }
    });

    this.logger.info("Wallet daily PnL snapshot updated.", {
      dayKey,
      cashUsd,
      positionsUsd,
      equityUsd,
      realizedTradingPnl: totals.realizedTradingPnl,
      baselineIsPartial: !existing
    });
  }

  private async getReliableCashBalance(): Promise<number | null> {
    if (!this.initialized) {
      this.initialized = await this.tradingService.initialize();
      if (!this.initialized) return null;
    }
    await this.tradingService.syncBalanceAllowance();

    const samples: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.tradingService.getUsdcBalance(false);
      if (result && Number.isFinite(result.balanceUsd)) {
        samples.push(result.balanceUsd);
      }
      if (attempt < 2) await sleep(250);
    }
    if (samples.length === 0) return null;
    const positiveSamples = samples.filter((value) => value > 0);
    const reliableSamples =
      positiveSamples.length > 0 ? positiveSamples : samples;
    reliableSamples.sort((a, b) => a - b);
    return reliableSamples[Math.floor(reliableSamples.length / 2)] ?? null;
  }

  private async setReconciliationStatus(
    id: string,
    reconciliationStatus: string
  ): Promise<void> {
    await prisma.liveOutcomeCheckpointTrade.update({
      where: { id },
      data: { reconciliationStatus }
    });
  }
}

export function findBestBuyActivity(params: {
  activity: PolymarketWalletActivity[];
  tokenId: string;
  slug: string;
  openedAt: Date | null;
  expectedUsdc: number;
  excludedTransactions?: Set<string>;
}): PolymarketWalletActivity | null {
  const openedAtMs = params.openedAt?.getTime() ?? 0;
  const candidates = params.activity.filter((row) => {
    if (row.type !== "TRADE" || row.side !== "BUY") return false;
    if (row.asset !== params.tokenId && row.slug !== params.slug) return false;
    if (
      row.transactionHash &&
      params.excludedTransactions?.has(row.transactionHash)
    ) return false;
    return openedAtMs === 0 ||
      Math.abs(row.timestamp * 1_000 - openedAtMs) <= BUY_MATCH_WINDOW_MS;
  });
  candidates.sort((a, b) => {
    const amountA = Math.abs(a.usdcSize - params.expectedUsdc);
    const amountB = Math.abs(b.usdcSize - params.expectedUsdc);
    if (Math.abs(amountA - amountB) > EPSILON) return amountA - amountB;
    return Math.abs(a.timestamp * 1_000 - openedAtMs) -
      Math.abs(b.timestamp * 1_000 - openedAtMs);
  });
  return candidates[0] ?? null;
}

export function calculateActivityTotals(
  activity: PolymarketWalletActivity[]
): {
  buyUsdc: number;
  sellUsdc: number;
  redeemUsdc: number;
  realizedTradingPnl: number;
} {
  let buyUsdc = 0;
  let sellUsdc = 0;
  let redeemUsdc = 0;
  for (const row of activity) {
    if (row.type === "TRADE" && row.side === "BUY") buyUsdc += row.usdcSize;
    if (row.type === "TRADE" && row.side === "SELL") sellUsdc += row.usdcSize;
    if (row.type === "REDEEM") redeemUsdc += row.usdcSize;
  }
  return {
    buyUsdc,
    sellUsdc,
    redeemUsdc,
    realizedTradingPnl: sellUsdc + redeemUsdc - buyUsdc
  };
}

function getBogotaDayKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
