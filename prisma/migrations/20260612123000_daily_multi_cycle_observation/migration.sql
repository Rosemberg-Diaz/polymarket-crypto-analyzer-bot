CREATE TABLE "DailyExitCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL DEFAULT 'DAILY_MULTI_CYCLE_NO_STOP_V1',
    "cycleNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "stake" DECIMAL NOT NULL,
    "entryPrice" DECIMAL NOT NULL,
    "entrySpread" DECIMAL NOT NULL,
    "shares" DECIMAL NOT NULL,
    "buyFee" DECIMAL NOT NULL,
    "entryCost" DECIMAL NOT NULL,
    "entrySecondsToClose" INTEGER NOT NULL,
    "exitPrice" DECIMAL,
    "sellFee" DECIMAL,
    "finalValue" DECIMAL,
    "profit" DECIMAL,
    "roi" DECIMAL,
    "exitReason" TEXT,
    "officialWinner" TEXT,
    "resolutionSource" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyExitCycle_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DailyMarketQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "cycleId" TEXT,
    "assetSymbol" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "bestBid" DECIMAL NOT NULL,
    "bidSize" DECIMAL NOT NULL,
    "bestAsk" DECIMAL NOT NULL,
    "askSize" DECIMAL NOT NULL,
    "spread" DECIMAL NOT NULL,
    "secondsToClose" INTEGER NOT NULL,
    "executable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyMarketQuote_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyMarketQuote_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "DailyExitCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DailyExitCycle_marketId_cycleNumber_key" ON "DailyExitCycle"("marketId", "cycleNumber");
CREATE INDEX "DailyExitCycle_marketId_idx" ON "DailyExitCycle"("marketId");
CREATE INDEX "DailyExitCycle_assetSymbol_idx" ON "DailyExitCycle"("assetSymbol");
CREATE INDEX "DailyExitCycle_outcome_idx" ON "DailyExitCycle"("outcome");
CREATE INDEX "DailyExitCycle_status_idx" ON "DailyExitCycle"("status");
CREATE INDEX "DailyExitCycle_strategyVersion_idx" ON "DailyExitCycle"("strategyVersion");
CREATE INDEX "DailyExitCycle_createdAt_idx" ON "DailyExitCycle"("createdAt");
CREATE INDEX "DailyExitCycle_closedAt_idx" ON "DailyExitCycle"("closedAt");
CREATE INDEX "DailyMarketQuote_marketId_outcome_idx" ON "DailyMarketQuote"("marketId", "outcome");
CREATE INDEX "DailyMarketQuote_cycleId_idx" ON "DailyMarketQuote"("cycleId");
CREATE INDEX "DailyMarketQuote_assetSymbol_idx" ON "DailyMarketQuote"("assetSymbol");
CREATE INDEX "DailyMarketQuote_createdAt_idx" ON "DailyMarketQuote"("createdAt");
