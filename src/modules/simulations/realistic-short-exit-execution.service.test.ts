import { describe, expect, it } from "vitest";
import {
  executeBuyDepth,
  executeSellDepth,
  fingerprintBook
} from "./realistic-short-exit-execution.service";

describe("RealisticShortExitExecutionService depth execution", () => {
  it("buys across multiple ask levels and includes fees", () => {
    const result = executeBuyDepth(
      [
        { price: "0.40", size: "1" },
        { price: "0.50", size: "10" }
      ],
      1
    );

    expect(result.fills).toHaveLength(2);
    expect(result.shares).toBeGreaterThan(1);
    expect(result.netValue).toBeCloseTo(1, 5);
    expect(result.averagePrice).toBeGreaterThan(0.4);
    expect(result.fees).toBeGreaterThan(0);
    expect(result.fullyFilled).toBe(true);
  });

  it("sells partially when total bid depth is insufficient", () => {
    const result = executeSellDepth(
      [
        { price: "0.60", size: "0.5" },
        { price: "0.55", size: "0.25" }
      ],
      2
    );

    expect(result.fills).toHaveLength(2);
    expect(result.shares).toBeCloseTo(0.75, 6);
    expect(result.fullyFilled).toBe(false);
    expect(result.netValue).toBeLessThan(result.grossValue);
  });

  it("uses the highest bids first when selling", () => {
    const result = executeSellDepth(
      [
        { price: "0.40", size: "10" },
        { price: "0.60", size: "1" }
      ],
      1.5
    );

    expect(result.fills[0].price).toBe(0.6);
    expect(result.fills[0].shares).toBe(1);
    expect(result.fills[1].price).toBe(0.4);
    expect(result.fullyFilled).toBe(true);
  });

  it("creates stable fingerprints and detects changed depth", () => {
    const first = fingerprintBook(
      {
        tokenId: "token",
        bids: [{ price: "0.40", size: "2" }],
        asks: [{ price: "0.50", size: "2" }]
      },
      "SELL"
    );
    const same = fingerprintBook(
      {
        tokenId: "token",
        bids: [{ price: "0.40", size: "2" }],
        asks: [{ price: "0.90", size: "99" }]
      },
      "SELL"
    );
    const changed = fingerprintBook(
      {
        tokenId: "token",
        bids: [{ price: "0.40", size: "3" }],
        asks: [{ price: "0.50", size: "2" }]
      },
      "SELL"
    );

    expect(first).toBe(same);
    expect(first).not.toBe(changed);
  });
});
