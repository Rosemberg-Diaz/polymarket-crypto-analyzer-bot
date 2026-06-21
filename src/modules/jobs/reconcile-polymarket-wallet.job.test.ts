import { describe, expect, it } from "vitest";
import {
  calculateActivityTotals,
  findBestBuyActivity
} from "./reconcile-polymarket-wallet.job";
import { PolymarketWalletActivity } from "../market-data/polymarket-wallet-data.service";

function activity(
  values: Partial<PolymarketWalletActivity>
): PolymarketWalletActivity {
  return {
    timestamp: 1_000,
    conditionId: "condition",
    type: "TRADE",
    size: 2,
    usdcSize: 1.5,
    transactionHash: "tx",
    asset: "token",
    side: "BUY",
    slug: "market",
    outcome: "UP",
    ...values
  };
}

describe("Polymarket wallet reconciliation", () => {
  it("calculates wallet-wide realized trading cashflow", () => {
    const result = calculateActivityTotals([
      activity({ side: "BUY", usdcSize: 3 }),
      activity({ side: "SELL", usdcSize: 1 }),
      activity({ type: "REDEEM", side: "", usdcSize: 4 })
    ]);
    expect(result).toEqual({
      buyUsdc: 3,
      sellUsdc: 1,
      redeemUsdc: 4,
      realizedTradingPnl: 2
    });
  });

  it("matches the closest actual buy amount for the token", () => {
    const openedAt = new Date(1_000_000);
    const result = findBestBuyActivity({
      activity: [
        activity({
          timestamp: 1_000,
          transactionHash: "far-amount",
          usdcSize: 2.99
        }),
        activity({
          timestamp: 1_001,
          transactionHash: "exact",
          usdcSize: 1.49
        })
      ],
      tokenId: "token",
      slug: "market",
      openedAt,
      expectedUsdc: 1.5
    });
    expect(result?.transactionHash).toBe("exact");
  });

  it("does not reuse an already assigned transaction", () => {
    const result = findBestBuyActivity({
      activity: [activity({ transactionHash: "used" })],
      tokenId: "token",
      slug: "market",
      openedAt: new Date(1_000_000),
      expectedUsdc: 1.5,
      excludedTransactions: new Set(["used"])
    });
    expect(result).toBeNull();
  });
});
