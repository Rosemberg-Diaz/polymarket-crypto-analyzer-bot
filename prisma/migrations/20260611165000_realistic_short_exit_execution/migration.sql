CREATE TABLE "RealisticShortExitExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "observationId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "budget" DECIMAL NOT NULL,
    "entryCost" DECIMAL NOT NULL,
    "sharesBought" DECIMAL NOT NULL,
    "averageEntryPrice" DECIMAL NOT NULL,
    "buyFees" DECIMAL NOT NULL,
    "sharesSold" DECIMAL NOT NULL DEFAULT 0,
    "sellGrossProceeds" DECIMAL NOT NULL DEFAULT 0,
    "sellFees" DECIMAL NOT NULL DEFAULT 0,
    "remainingShares" DECIMAL NOT NULL,
    "settlementValue" DECIMAL NOT NULL DEFAULT 0,
    "finalValue" DECIMAL,
    "profit" DECIMAL,
    "roi" DECIMAL,
    "exitTrigger" TEXT,
    "dataGapCount" INTEGER NOT NULL DEFAULT 0,
    "resolutionSource" TEXT,
    "officialWinner" TEXT,
    "lastObservedAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RealisticShortExitExecution_observationId_fkey"
      FOREIGN KEY ("observationId") REFERENCES "ShortTermExitObservation" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RealisticShortExitExecution_marketId_fkey"
      FOREIGN KEY ("marketId") REFERENCES "Market" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RealisticShortExitFill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "shares" DECIMAL NOT NULL,
    "grossValue" DECIMAL NOT NULL,
    "fee" DECIMAL NOT NULL,
    "netValue" DECIMAL NOT NULL,
    "secondsToClose" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealisticShortExitFill_executionId_fkey"
      FOREIGN KEY ("executionId") REFERENCES "RealisticShortExitExecution" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RealisticShortExitBookUse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "secondsToClose" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealisticShortExitBookUse_executionId_fkey"
      FOREIGN KEY ("executionId") REFERENCES "RealisticShortExitExecution" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RealisticShortExitExecution_observationId_key"
ON "RealisticShortExitExecution"("observationId");
CREATE INDEX "RealisticShortExitExecution_marketId_idx"
ON "RealisticShortExitExecution"("marketId");
CREATE INDEX "RealisticShortExitExecution_assetSymbol_idx"
ON "RealisticShortExitExecution"("assetSymbol");
CREATE INDEX "RealisticShortExitExecution_outcome_idx"
ON "RealisticShortExitExecution"("outcome");
CREATE INDEX "RealisticShortExitExecution_status_idx"
ON "RealisticShortExitExecution"("status");
CREATE INDEX "RealisticShortExitExecution_createdAt_idx"
ON "RealisticShortExitExecution"("createdAt");
CREATE INDEX "RealisticShortExitExecution_resolvedAt_idx"
ON "RealisticShortExitExecution"("resolvedAt");

CREATE INDEX "RealisticShortExitFill_executionId_idx"
ON "RealisticShortExitFill"("executionId");
CREATE INDEX "RealisticShortExitFill_side_idx"
ON "RealisticShortExitFill"("side");
CREATE INDEX "RealisticShortExitFill_createdAt_idx"
ON "RealisticShortExitFill"("createdAt");

CREATE UNIQUE INDEX "RealisticShortExitBookUse_executionId_side_fingerprint_key"
ON "RealisticShortExitBookUse"("executionId", "side", "fingerprint");
CREATE INDEX "RealisticShortExitBookUse_executionId_idx"
ON "RealisticShortExitBookUse"("executionId");
CREATE INDEX "RealisticShortExitBookUse_createdAt_idx"
ON "RealisticShortExitBookUse"("createdAt");
