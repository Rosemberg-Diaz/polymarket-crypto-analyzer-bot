import { describe, expect, it } from "vitest";
import { buildRetentionCutoffs } from "./database-retention.service";

describe("DatabaseRetentionService policy", () => {
  it("builds retention cutoffs before the supplied time", () => {
    const now = new Date("2026-06-14T12:00:00.000Z");
    const cutoffs = buildRetentionCutoffs(now);

    expect(cutoffs.compactSnapshotRawBefore.getTime()).toBeLessThan(now.getTime());
    expect(cutoffs.thinSnapshotsBefore.getTime())
      .toBeLessThan(cutoffs.compactSnapshotRawBefore.getTime());
    expect(cutoffs.deleteSnapshotsBefore.getTime())
      .toBeLessThan(cutoffs.thinSnapshotsBefore.getTime());
    expect(cutoffs.deleteErrorLogsBefore.getTime())
      .toBeLessThan(cutoffs.deleteWarnLogsBefore.getTime());
  });
});
