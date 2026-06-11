-- CreateTable
CREATE TABLE "ShortTermExitObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "stake" DECIMAL NOT NULL,
    "entryAsk" DECIMAL NOT NULL,
    "entryBid" DECIMAL NOT NULL,
    "entrySpread" DECIMAL NOT NULL,
    "shares" DECIMAL NOT NULL,
    "buyFee" DECIMAL NOT NULL,
    "entrySecondsToClose" INTEGER NOT NULL,
    "maxExecutableBid" DECIMAL NOT NULL,
    "minExecutableBid" DECIMAL NOT NULL,
    "maxNetRoi" DECIMAL NOT NULL DEFAULT 0,
    "minNetRoi" DECIMAL NOT NULL DEFAULT 0,
    "firstTakeProfit2At" DATETIME,
    "firstTakeProfit5At" DATETIME,
    "firstTakeProfit10At" DATETIME,
    "firstStopLoss3At" DATETIME,
    "firstStopLoss5At" DATETIME,
    "firstStopLoss10At" DATETIME,
    "exitBid" DECIMAL,
    "sellFee" DECIMAL,
    "finalValue" DECIMAL,
    "profit" DECIMAL,
    "roi" DECIMAL,
    "exitReason" TEXT,
    "exitedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShortTermExitObservation_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShortTermExitQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "observationId" TEXT NOT NULL,
    "bestBid" DECIMAL NOT NULL,
    "bidSize" DECIMAL NOT NULL,
    "bestAsk" DECIMAL NOT NULL,
    "askSize" DECIMAL NOT NULL,
    "spread" DECIMAL NOT NULL,
    "liquidity" DECIMAL NOT NULL,
    "secondsToClose" INTEGER NOT NULL,
    "netExitValue" DECIMAL NOT NULL,
    "netProfit" DECIMAL NOT NULL,
    "netRoi" DECIMAL NOT NULL,
    "executable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShortTermExitQuote_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ShortTermExitObservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShortTermExitObservation_marketId_outcome_key" ON "ShortTermExitObservation"("marketId", "outcome");

-- CreateIndex
CREATE INDEX "ShortTermExitObservation_assetSymbol_idx" ON "ShortTermExitObservation"("assetSymbol");

-- CreateIndex
CREATE INDEX "ShortTermExitObservation_outcome_idx" ON "ShortTermExitObservation"("outcome");

-- CreateIndex
CREATE INDEX "ShortTermExitObservation_status_idx" ON "ShortTermExitObservation"("status");

-- CreateIndex
CREATE INDEX "ShortTermExitObservation_createdAt_idx" ON "ShortTermExitObservation"("createdAt");

-- CreateIndex
CREATE INDEX "ShortTermExitObservation_exitedAt_idx" ON "ShortTermExitObservation"("exitedAt");

-- CreateIndex
CREATE INDEX "ShortTermExitQuote_observationId_idx" ON "ShortTermExitQuote"("observationId");

-- CreateIndex
CREATE INDEX "ShortTermExitQuote_createdAt_idx" ON "ShortTermExitQuote"("createdAt");
