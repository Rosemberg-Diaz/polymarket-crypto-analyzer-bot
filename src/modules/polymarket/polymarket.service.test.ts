import { describe, expect, it } from "vitest";
import { getHourlyEventSlugs } from "./polymarket.service";

describe("Polymarket hourly event discovery", () => {
  it("builds the calendar slug format used by hourly crypto events", () => {
    const slugs = getHourlyEventSlugs(
      new Date("2026-06-18T22:15:00.000Z")
    );
    expect(slugs).toContain(
      "bitcoin-up-or-down-june-18-2026-6pm-et"
    );
    expect(slugs).toContain(
      "ethereum-up-or-down-june-18-2026-7pm-et"
    );
  });
});
