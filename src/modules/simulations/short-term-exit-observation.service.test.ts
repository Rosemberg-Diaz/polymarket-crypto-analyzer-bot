import { describe, expect, it } from "vitest";
import { PolymarketOrderBook } from "../polymarket/polymarket.types";
import {
  determineExitReason,
  getExecutableBookQuote,
  isEligibleShortTermExitEntry
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

  it("accepts cheap entries only inside the 60-120 second window", () => {
    expect(isEligibleShortTermExitEntry(quote, 1_000, 90)).toBe(true);
    expect(isEligibleShortTermExitEntry(quote, 1_000, 121)).toBe(false);
    expect(isEligibleShortTermExitEntry(quote, 1_000, 59)).toBe(false);
  });

  it("rejects entries above the validated price band", () => {
    expect(
      isEligibleShortTermExitEntry(
        {
          ...quote,
          bestBid: 0.49,
          bestAsk: 0.5
        },
        1_000,
        90
      )
    ).toBe(false);
  });

  it("takes profit at two percent", () => {
    expect(determineExitReason(0.02, 10, 90)).toBe("TAKE_PROFIT");
  });

  it("stops at a ten percent loss", () => {
    expect(determineExitReason(-0.1, 10, 90)).toBe("STOP_LOSS");
  });

  it("times out after sixty seconds", () => {
    expect(determineExitReason(0, 60, 40)).toBe("TIMEOUT");
  });
});
