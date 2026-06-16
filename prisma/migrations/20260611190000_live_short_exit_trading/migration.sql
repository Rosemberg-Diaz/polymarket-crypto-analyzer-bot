CREATE TABLE "LiveShortExitTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "observationId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENTRY_ATTEMPTING',
    "budget" DECIMAL NOT NULL,
    "entryPrice" DECIMAL NOT NULL,
    "entryCost" DECIMAL NOT NULL DEFAULT 0,
    "sharesBought" DECIMAL NOT NULL DEFAULT 0,
    "sharesSold" DECIMAL NOT NULL DEFAULT 0,
    "remainingShares" DECIMAL NOT NULL DEFAULT 0,
    "sellProceeds" DECIMAL NOT NULL DEFAULT 0,
    "estimatedFees" DECIMAL NOT NULL DEFAULT 0,
    "profit" DECIMAL,
    "roi" DECIMAL,
    "exitTrigger" TEXT,
    "errorMessage" TEXT,
    "openedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveShortExitTrade_observationId_fkey"
      FOREIGN KEY ("observationId") REFERENCES "ShortTermExitObservation" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveShortExitTrade_marketId_fkey"
      FOREIGN KEY ("marketId") REFERENCES "Market" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LiveShortExitOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "status" TEXT NOT NULL,
    "requestedAmount" DECIMAL NOT NULL,
    "requestedPrice" DECIMAL,
    "filledShares" DECIMAL NOT NULL DEFAULT 0,
    "cashAmount" DECIMAL NOT NULL DEFAULT 0,
    "averagePrice" DECIMAL,
    "responseData" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveShortExitOrder_tradeId_fkey"
      FOREIGN KEY ("tradeId") REFERENCES "LiveShortExitTrade" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LiveShortExitTrade_observationId_key"
ON "LiveShortExitTrade"("observationId");
CREATE INDEX "LiveShortExitTrade_marketId_idx" ON "LiveShortExitTrade"("marketId");
CREATE INDEX "LiveShortExitTrade_assetSymbol_idx" ON "LiveShortExitTrade"("assetSymbol");
CREATE INDEX "LiveShortExitTrade_status_idx" ON "LiveShortExitTrade"("status");
CREATE INDEX "LiveShortExitTrade_createdAt_idx" ON "LiveShortExitTrade"("createdAt");
CREATE INDEX "LiveShortExitTrade_closedAt_idx" ON "LiveShortExitTrade"("closedAt");
CREATE INDEX "LiveShortExitOrder_tradeId_idx" ON "LiveShortExitOrder"("tradeId");
CREATE INDEX "LiveShortExitOrder_side_idx" ON "LiveShortExitOrder"("side");
CREATE INDEX "LiveShortExitOrder_status_idx" ON "LiveShortExitOrder"("status");
CREATE INDEX "LiveShortExitOrder_externalOrderId_idx" ON "LiveShortExitOrder"("externalOrderId");
CREATE INDEX "LiveShortExitOrder_createdAt_idx" ON "LiveShortExitOrder"("createdAt");
