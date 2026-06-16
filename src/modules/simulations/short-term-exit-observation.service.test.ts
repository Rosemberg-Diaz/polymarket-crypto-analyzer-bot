import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import {
  determineExitReason,
  evaluateOrderFlowExitRisk,
  evaluateExitScenarios,
  getObservationStrategyProfile,
  getExecutableBookQuote,
  isEligibleShortTermExitEntry,
  matchesObservationEntryFilter,
  selectFilteredFiveMinuteEntry,
  selectFifteenMinuteBandEntries,
  selectOrderFlowEntry,
  selectStrictFifteenMinuteEntry,
  selectShortTermEntry,
  shouldCloseObservationAtTakeProfit,
  ALL_ASSETS_FIFTEEN_MINUTE_STRATEGY_VERSION,
  ORDER_FLOW_STRATEGY_VERSION,
  STRICT_FIFTEEN_MINUTE_STRATEGY_VERSION
} from "./short-term-exit-observation.service";

describe("ShortTermExitObservationService orderbook parsing", () => {
  it("selects the highest bid and lowest ask for one outcome", () => {
    const book: PolymarketOrderBook = {
      tokenId: "token",
      bids: [
        { price: "0.20", size: "4" },
        { price: "0.24", size: "8" }
      ],
      asks: [
        { price: "0.31", size: "5" },
        { price: "0.28", size: "9" }
      ]
    };

    expect(getExecutableBookQuote(book)).toEqual({
      bestBid: 0.24,
      bidSize: 8,
      bestAsk: 0.28,
      askSize: 9,
      bidDepth5: 12,
      askDepth5: 14,
      depthImbalance: -0.07692307692307693,
      microPrice: 0.25882352941176473,
      spread: 0.040000000000000036
    });
  });

  it("returns null for an incomplete book", () => {
    expect(
      getExecutableBookQuote({
        tokenId: "token",
        bids: [],
        asks: [{ price: "0.40", size: "10" }]
      })
    ).toBeNull();
  });
});

describe("ShortTermExitObservationService strategy rules", () => {
  const quote = {
    bestBid: 0.19,
    bidSize: 20,
    bestAsk: 0.2,
    askSize: 20,
    spread: 0.01
  };

  it("accepts entries only during the first minute of a five-minute market", () => {
    expect(isEligibleShortTermExitEntry(quote, 1_000, 270)).toBe(true);
    expect(isEligibleShortTermExitEntry(quote, 1_000, 301)).toBe(false);
    expect(isEligibleShortTermExitEntry(quote, 1_000, 239)).toBe(false);
  });

  it("accepts 15m entries only during the first three minutes", () => {
    const fifteenMinuteQuote = {
      ...quote,
      bestBid: 0.54,
      bestAsk: 0.55
    };

    expect(
      isEligibleShortTermExitEntry(fifteenMinuteQuote, 1_000, 810, "15m")
    ).toBe(true);
    expect(
      isEligibleShortTermExitEntry(fifteenMinuteQuote, 1_000, 719, "15m")
    ).toBe(false);
    expect(
      isEligibleShortTermExitEntry(fifteenMinuteQuote, 1_000, 901, "15m")
    ).toBe(false);
  });

  it("keeps the 15m strategy observation-only after reaching take profit", () => {
    expect(getObservationStrategyProfile("15m").keepObservingAfterTakeProfit)
      .toBe(true);
  });

  it("applies the validated five-minute filters by asset", () => {
    const risingBtc = {
      outcome: "UP" as const,
      quote: {
        bestBid: 0.57,
        bidSize: 20,
        bestAsk: 0.58,
        askSize: 20,
        spread: 0.01
      },
      trigger: "RISING_BID_TIGHT_SPREAD" as const
    };

    expect(matchesObservationEntryFilter("BTC", "5m", risingBtc)).toBe(true);
    expect(
      matchesObservationEntryFilter("ETH", "5m", {
        ...risingBtc,
        outcome: "DOWN"
      })
    ).toBe(false);
    expect(
      matchesObservationEntryFilter("SOL", "5m", {
        ...risingBtc,
        quote: { ...risingBtc.quote, bestBid: 0.66, bestAsk: 0.67 }
      })
    ).toBe(true);
    expect(
      matchesObservationEntryFilter("XRP", "5m", {
        ...risingBtc,
        quote: { ...risingBtc.quote, bestBid: 0.55, bestAsk: 0.56 }
      })
    ).toBe(true);
  });

  it("accepts all six supported recurring assets in the 15m observation band", () => {
    const selection = {
      outcome: "UP" as const,
      quote: {
        bestBid: 0.54,
        bidSize: 20,
        bestAsk: 0.55,
        askSize: 20,
        spread: 0.01
      },
      trigger: "RISING_BID_TIGHT_SPREAD" as const
    };

    for (const asset of ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]) {
      expect(matchesObservationEntryFilter(asset, "15m", selection)).toBe(true);
    }
  });

  it("selects independent cheap, mid and strong 15m entries", () => {
    const selections = selectFifteenMinuteBandEntries(
      [
        {
          outcome: "UP",
          quote: {
            bestBid: 0.22,
            bidSize: 20,
            bestAsk: 0.23,
            askSize: 20,
            spread: 0.01
          },
          previousQuotes: [
            {
              bestBid: 0.21,
              bidSize: 20,
              bestAsk: 0.24,
              askSize: 20,
              spread: 0.03
            }
          ]
        },
        {
          outcome: "DOWN",
          quote: {
            bestBid: 0.68,
            bidSize: 20,
            bestAsk: 0.69,
            askSize: 20,
            spread: 0.01
          },
          previousQuotes: [
            {
              bestBid: 0.67,
              bidSize: 20,
              bestAsk: 0.7,
              askSize: 20,
              spread: 0.03
            }
          ]
        }
      ],
      1_000,
      810
    );

    expect(selections.map((selection) => selection.entryBand))
      .toEqual(["CHEAP", "STRONG"]);
  });

  it("uses a broad executable entry at the end of the 15m entry window", () => {
    const selections = selectFifteenMinuteBandEntries(
      [
        {
          outcome: "UP",
          quote: {
            bestBid: 0.44,
            bidSize: 20,
            bestAsk: 0.46,
            askSize: 20,
            spread: 0.02
          },
          previousQuotes: [
            {
              bestBid: 0.44,
              bidSize: 20,
              bestAsk: 0.46,
              askSize: 20,
              spread: 0.02
            }
          ]
        }
      ],
      1_000,
      725
    );

    expect(selections[0]?.entryBand).toBe("MID");
    expect(selections[0]?.trigger).toBe("WINDOW_END_EXECUTABLE");
  });

  it("selects the strict 15m variant for supported assets only in the first minute", () => {
    const candidates = [
      {
        outcome: "UP" as const,
        quote: {
          bestBid: 0.61,
          bidSize: 20,
          bestAsk: 0.62,
          askSize: 20,
          spread: 0.01
        },
        previousQuotes: [
          {
            bestBid: 0.59,
            bidSize: 20,
            bestAsk: 0.61,
            askSize: 20,
            spread: 0.02
          }
        ]
      }
    ];

    expect(
      selectStrictFifteenMinuteEntry("BTC", candidates, 1_000, 850)
    )?.toMatchObject({
      outcome: "UP",
      entryBand: "STRICT",
      trigger: "RISING_BID_TIGHT_SPREAD"
    });
    for (const asset of ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]) {
      expect(
        selectStrictFifteenMinuteEntry(asset, candidates, 1_000, 850)
      )?.toMatchObject({
        outcome: "UP",
        entryBand: "STRICT"
      });
    }
    expect(
      selectStrictFifteenMinuteEntry("AVAX", candidates, 1_000, 850)
    ).toBeNull();
    expect(
      selectStrictFifteenMinuteEntry("ETH", candidates, 1_000, 820)
    ).toBeNull();
  });

  it("accepts the revised strict 15m price range from 0.50 to 0.70", () => {
    const candidates = [
      {
        outcome: "UP" as const,
        quote: {
          bestBid: 0.51,
          bidSize: 20,
          bestAsk: 0.52,
          askSize: 20,
          spread: 0.01
        },
        previousQuotes: [
          {
            bestBid: 0.49,
            bidSize: 20,
            bestAsk: 0.51,
            askSize: 20,
            spread: 0.02
          }
        ]
      }
    ];

    expect(
      selectStrictFifteenMinuteEntry("ETH", candidates, 1_000, 880)
    )?.toMatchObject({
      outcome: "UP",
      entryBand: "STRICT"
    });
  });

  it("selects filtered XRP/SOL 5m entries only after two consecutive bid rises", () => {
    const candidates = [
      {
        outcome: "UP" as const,
        quote: {
          bestBid: 0.55,
          bidSize: 20,
          bestAsk: 0.56,
          askSize: 20,
          spread: 0.01
        },
        previousQuotes: [
          {
            bestBid: 0.53,
            bidSize: 20,
            bestAsk: 0.55,
            askSize: 20,
            spread: 0.02
          },
          {
            bestBid: 0.54,
            bidSize: 20,
            bestAsk: 0.56,
            askSize: 20,
            spread: 0.02
          }
        ]
      }
    ];

    expect(
      selectFilteredFiveMinuteEntry("XRP", candidates, 1_000, 285)
    )?.toMatchObject({
      outcome: "UP",
      trigger: "RISING_BID_TIGHT_SPREAD"
    });
    expect(
      selectFilteredFiveMinuteEntry("BTC", candidates, 1_000, 285)
    ).toBeNull();
    expect(
      selectFilteredFiveMinuteEntry("XRP", candidates, 1_000, 275)
    ).toBeNull();
    expect(
      selectFilteredFiveMinuteEntry(
        "XRP",
        [{
          ...candidates[0],
          previousQuotes: [
            candidates[0].previousQuotes[0],
            {
              ...candidates[0].previousQuotes[1],
              bestBid: 0.53
            }
          ]
        }],
        1_000,
        285
      )
    ).toBeNull();
  });

  it("waits for persistent bid pressure before opening an order-flow observation", () => {
    const observedAt = new Date("2026-06-14T18:00:00.000Z");
    const previousQuotes = [
      { bestBid: 0.5, bestAsk: 0.53, bidSize: 25, askSize: 15, spread: 0.03 },
      { bestBid: 0.51, bestAsk: 0.54, bidSize: 30, askSize: 14, spread: 0.03 },
      { bestBid: 0.52, bestAsk: 0.55, bidSize: 35, askSize: 13, spread: 0.03 }
    ].map((item, index) => ({
      ...item,
      observedAt: new Date(observedAt.getTime() + index * 5_000)
    }));

    expect(
      selectOrderFlowEntry(
        [{
          outcome: "UP",
          quote: {
            bestBid: 0.53,
            bestAsk: 0.56,
            bidSize: 40,
            askSize: 12,
            spread: 0.03
          },
          previousQuotes
        }],
        1_000,
        270,
        "5m"
      )
    )?.toMatchObject({
      outcome: "UP",
      trigger: "ORDER_FLOW_CONFIRMATION",
      entryBand: "ORDER_FLOW"
    });
  });

  it("rejects rising prices when visible depth is dominated by asks", () => {
    const previousQuotes = [0.5, 0.51, 0.52].map((bestBid, index) => ({
      bestBid,
      bestAsk: bestBid + 0.03,
      bidSize: 8,
      askSize: 40,
      spread: 0.03,
      observedAt: new Date(1_000 + index * 5_000)
    }));

    expect(
      selectOrderFlowEntry(
        [{
          outcome: "UP",
          quote: {
            bestBid: 0.53,
            bestAsk: 0.56,
            bidSize: 8,
            askSize: 40,
            spread: 0.03
          },
          previousQuotes
        }],
        1_000,
        270,
        "5m"
      )
    ).toBeNull();
  });

  it("requires persistent combined order-flow deterioration before exiting", () => {
    const openedAt = new Date("2026-06-14T18:00:00.000Z");
    const previous = [
      {
        bestBid: new Prisma.Decimal(0.54),
        bidDepth5: new Prisma.Decimal(100),
        depthImbalance: new Prisma.Decimal(0.1),
        microPrice: new Prisma.Decimal(0.555),
        spread: new Prisma.Decimal(0.02),
        orderFlowRiskScore: 0
      },
      {
        bestBid: new Prisma.Decimal(0.52),
        bidDepth5: new Prisma.Decimal(60),
        depthImbalance: new Prisma.Decimal(-0.12),
        microPrice: new Prisma.Decimal(0.525),
        spread: new Prisma.Decimal(0.04),
        orderFlowRiskScore: 3
      }
    ];

    const risk = evaluateOrderFlowExitRisk(
      { entryBid: 0.55, entrySpread: 0.02, openedAt },
      previous,
      {
        bestBid: 0.49,
        bestAsk: 0.55,
        bidSize: 10,
        askSize: 50,
        bidDepth5: 30,
        askDepth5: 120,
        depthImbalance: -0.6,
        microPrice: 0.505,
        spread: 0.06
      },
      new Date(openedAt.getTime() + 20_000)
    );

    expect(risk.shouldExit).toBe(true);
    expect(risk.score).toBeGreaterThanOrEqual(4);
    expect(risk.reasons).toContain("BID_DEPTH_COLLAPSE");
  });

  it("does not exit on one isolated weak order-flow reading", () => {
    const openedAt = new Date("2026-06-14T18:00:00.000Z");
    const risk = evaluateOrderFlowExitRisk(
      { entryBid: 0.55, entrySpread: 0.02, openedAt },
      [],
      {
        bestBid: 0.54,
        bestAsk: 0.57,
        bidSize: 10,
        askSize: 30,
        bidDepth5: 40,
        askDepth5: 80,
        depthImbalance: -0.33,
        microPrice: 0.548,
        spread: 0.03
      },
      new Date(openedAt.getTime() + 20_000)
    );

    expect(risk.shouldExit).toBe(false);
    expect(risk.score).toBeLessThan(4);
  });

  it("takes profit immediately for the revised strict 15m strategy", () => {
    expect(
      shouldCloseObservationAtTakeProfit(
        STRICT_FIFTEEN_MINUTE_STRATEGY_VERSION,
        "15m"
      )
    ).toBe(true);
    expect(
      shouldCloseObservationAtTakeProfit(
        ALL_ASSETS_FIFTEEN_MINUTE_STRATEGY_VERSION,
        "15m"
      )
    ).toBe(true);
    expect(
      shouldCloseObservationAtTakeProfit(
        ORDER_FLOW_STRATEGY_VERSION,
        "15m"
      )
    ).toBe(true);
    expect(
      shouldCloseObservationAtTakeProfit(
        "EARLY_WINDOW_MULTI_BAND_15M_V2",
        "15m"
      )
    ).toBe(false);
  });

  it("accepts prices up to 0.70 and rejects prices outside 0.20-0.70", () => {
    expect(
      isEligibleShortTermExitEntry(
        {
          ...quote,
          bestBid: 0.68,
          bestAsk: 0.7
        },
        1_000,
        270
      )
    ).toBe(true);
    expect(isEligibleShortTermExitEntry({ ...quote, bestAsk: 0.19 }, 1_000, 270)).toBe(false);
    expect(isEligibleShortTermExitEntry({ ...quote, bestAsk: 0.71 }, 1_000, 270)).toBe(false);
  });

  it("selects a favorable drop only when the bid still supports it", () => {
    const selection = selectShortTermEntry(
      [
        {
          outcome: "UP",
          quote: {
            bestBid: 0.45,
            bidSize: 20,
            bestAsk: 0.47,
            askSize: 20,
            spread: 0.02
          },
          previousQuotes: [
            {
              bestBid: 0.45,
              bidSize: 20,
              bestAsk: 0.49,
              askSize: 20,
              spread: 0.04
            }
          ]
        }
      ],
      1_000,
      270
    );

    expect(selection?.outcome).toBe("UP");
    expect(selection?.trigger).toBe("FAVORABLE_DROP_WITH_BID_SUPPORT");
  });

  it("chooses only one executable outcome at the end of the entry window", () => {
    const selection = selectShortTermEntry(
      [
        {
          outcome: "UP",
          quote: { bestBid: 0.39, bidSize: 20, bestAsk: 0.42, askSize: 20, spread: 0.03 },
          previousQuotes: [
            { bestBid: 0.39, bidSize: 20, bestAsk: 0.42, askSize: 20, spread: 0.03 }
          ]
        },
        {
          outcome: "DOWN",
          quote: { bestBid: 0.55, bidSize: 20, bestAsk: 0.57, askSize: 20, spread: 0.02 },
          previousQuotes: [
            { bestBid: 0.55, bidSize: 20, bestAsk: 0.57, askSize: 20, spread: 0.02 }
          ]
        }
      ],
      1_000,
      245
    );

    expect(selection).toEqual({
      outcome: "DOWN",
      quote: {
        bestBid: 0.55,
        bidSize: 20,
        bestAsk: 0.57,
        askSize: 20,
        spread: 0.02
      },
      trigger: "WINDOW_END_EXECUTABLE"
    });
  });

  it("takes profit at two percent", () => {
    expect(determineExitReason(0.02, 180)).toBe("TAKE_PROFIT");
  });

  it("does not stop early when the position is losing", () => {
    expect(determineExitReason(-0.5, 61)).toBeNull();
  });

  it("exits at an executable bid during the last minute", () => {
    expect(determineExitReason(-0.5, 60)).toBe("LAST_MINUTE_EXIT");
  });

  it("preserves take profit in every later hypothetical exit scenario", () => {
    const at = new Date("2026-06-11T15:00:00Z");
    const scenarios = evaluateExitScenarios(
      [storedQuote(250, 0.55, 0.03, at)],
      1,
      false
    );

    expect(scenarios).toHaveLength(4);
    expect(scenarios.every((row) => row.exitReason === "TAKE_PROFIT_BEFORE_THRESHOLD"))
      .toBe(true);
    expect(scenarios.every((row) => row.profit === 0.03)).toBe(true);
  });

  it("uses the first executable quote after each hypothetical threshold", () => {
    const scenarios = evaluateExitScenarios(
      [
        storedQuote(170, 0.4, -0.1),
        storedQuote(110, 0.35, -0.2),
        storedQuote(80, 0.3, -0.3),
        storedQuote(50, 0.25, -0.4)
      ],
      1,
      false
    );

    expect(scenarios.map((row) => row.roi)).toEqual([-0.1, -0.2, -0.3, -0.4]);
    expect(scenarios.every((row) => row.exitReason === "FORCED_AT_THRESHOLD")).toBe(true);
  });

  it("counts a settled observation without an executable exit as a full loss", () => {
    const scenarios = evaluateExitScenarios([], 1, false);

    expect(scenarios.every((row) => row.status === "RESOLVED")).toBe(true);
    expect(scenarios.every((row) => row.profit === -1 && row.roi === -1)).toBe(true);
    expect(scenarios.every((row) => row.exitReason === "CONSERVATIVE_NO_EXIT")).toBe(true);
  });

  it("keeps unavailable scenarios pending while the observation is open", () => {
    const scenarios = evaluateExitScenarios([], 1, true);

    expect(scenarios.every((row) => row.status === "PENDING")).toBe(true);
    expect(scenarios.every((row) => row.profit === null)).toBe(true);
  });
});

function storedQuote(
  secondsToClose: number,
  bestBid: number,
  roi: number,
  createdAt = new Date()
) {
  return {
    bestBid: new Prisma.Decimal(bestBid),
    netExitValue: new Prisma.Decimal(1 + roi),
    netProfit: new Prisma.Decimal(roi),
    netRoi: new Prisma.Decimal(roi),
    secondsToClose,
    createdAt
  };
}
