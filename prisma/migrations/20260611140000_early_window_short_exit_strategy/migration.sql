ALTER TABLE "ShortTermExitObservation"
ADD COLUMN "strategyVersion" TEXT NOT NULL DEFAULT 'CHEAP_REBOUND_V1';

ALTER TABLE "ShortTermExitObservation"
ADD COLUMN "entryTrigger" TEXT;

CREATE INDEX "ShortTermExitObservation_strategyVersion_idx"
ON "ShortTermExitObservation"("strategyVersion");

CREATE TABLE "ShortTermEntryQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "bestBid" DECIMAL NOT NULL,
    "bidSize" DECIMAL NOT NULL,
    "bestAsk" DECIMAL NOT NULL,
    "askSize" DECIMAL NOT NULL,
    "spread" DECIMAL NOT NULL,
    "liquidity" DECIMAL NOT NULL,
    "secondsToClose" INTEGER NOT NULL,
    "executable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShortTermEntryQuote_marketId_fkey"
      FOREIGN KEY ("marketId") REFERENCES "Market" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ShortTermEntryQuote_marketId_outcome_idx"
ON "ShortTermEntryQuote"("marketId", "outcome");

CREATE INDEX "ShortTermEntryQuote_assetSymbol_idx"
ON "ShortTermEntryQuote"("assetSymbol");

CREATE INDEX "ShortTermEntryQuote_createdAt_idx"
ON "ShortTermEntryQuote"("createdAt");
