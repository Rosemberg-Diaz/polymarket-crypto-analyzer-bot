/*
  Warnings:

  - You are about to drop the `BotRun` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CryptoMarket` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Signal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SimulationTrade` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "BotRun";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CryptoMarket";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Signal";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SimulationTrade";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalMarketId" TEXT,
    "slug" TEXT,
    "question" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'CRYPTO',
    "assetSymbol" TEXT NOT NULL,
    "baseAsset" TEXT,
    "quoteAsset" TEXT,
    "marketType" TEXT NOT NULL,
    "timeframe" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "resolutionSource" TEXT,
    "rawData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "externalTokenId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "currentPrice" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketOutcome_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "upPrice" DECIMAL,
    "downPrice" DECIMAL,
    "yesPrice" DECIMAL,
    "noPrice" DECIMAL,
    "bid" DECIMAL,
    "ask" DECIMAL,
    "spread" DECIMAL,
    "liquidity" DECIMAL,
    "volume" DECIMAL,
    "targetPrice" DECIMAL,
    "currentAssetPrice" DECIMAL,
    "distanceToTarget" DECIMAL,
    "distanceToTargetPercent" DECIMAL,
    "secondsToClose" INTEGER,
    "momentumLast30s" DECIMAL,
    "momentumLast60s" DECIMAL,
    "momentumLast120s" DECIMAL,
    "volatilityLast60s" DECIMAL,
    "volatilityLast120s" DECIMAL,
    "rawOrderbook" TEXT,
    "rawData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotPrediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "predictedOutcome" TEXT NOT NULL,
    "entryPrice" DECIMAL NOT NULL,
    "impliedProbability" DECIMAL,
    "botProbability" DECIMAL,
    "edge" DECIMAL,
    "confidence" DECIMAL,
    "recommendation" TEXT NOT NULL,
    "reason" TEXT,
    "features" TEXT,
    "historicalSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotPrediction_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BotPrediction_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimulatedTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "predictionId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "stake" DECIMAL NOT NULL,
    "entryPrice" DECIMAL NOT NULL,
    "shares" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "isWin" BOOLEAN,
    "finalValue" DECIMAL,
    "profit" DECIMAL,
    "roi" DECIMAL,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SimulatedTrade_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "BotPrediction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SimulatedTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "strategyName" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "predictedOutcome" TEXT NOT NULL,
    "totalPredictions" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "winRate" DECIMAL NOT NULL DEFAULT 0,
    "totalProfit" DECIMAL NOT NULL DEFAULT 0,
    "averageRoi" DECIMAL NOT NULL DEFAULT 0,
    "maxDrawdown" DECIMAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BotRunLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DailyPerformance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "totalPredictions" INTEGER NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "winRate" DECIMAL NOT NULL DEFAULT 0,
    "totalProfit" DECIMAL NOT NULL DEFAULT 0,
    "averageRoi" DECIMAL NOT NULL DEFAULT 0,
    "bestStrategy" TEXT,
    "worstStrategy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_externalMarketId_key" ON "Market"("externalMarketId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_slug_key" ON "Market"("slug");

-- CreateIndex
CREATE INDEX "Market_assetSymbol_idx" ON "Market"("assetSymbol");

-- CreateIndex
CREATE INDEX "Market_marketType_idx" ON "Market"("marketType");

-- CreateIndex
CREATE INDEX "Market_createdAt_idx" ON "Market"("createdAt");

-- CreateIndex
CREATE INDEX "MarketOutcome_marketId_idx" ON "MarketOutcome"("marketId");

-- CreateIndex
CREATE INDEX "MarketOutcome_externalTokenId_idx" ON "MarketOutcome"("externalTokenId");

-- CreateIndex
CREATE INDEX "MarketOutcome_createdAt_idx" ON "MarketOutcome"("createdAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_marketId_idx" ON "MarketSnapshot"("marketId");

-- CreateIndex
CREATE INDEX "MarketSnapshot_createdAt_idx" ON "MarketSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "BotPrediction_marketId_idx" ON "BotPrediction"("marketId");

-- CreateIndex
CREATE INDEX "BotPrediction_snapshotId_idx" ON "BotPrediction"("snapshotId");

-- CreateIndex
CREATE INDEX "BotPrediction_assetSymbol_idx" ON "BotPrediction"("assetSymbol");

-- CreateIndex
CREATE INDEX "BotPrediction_marketType_idx" ON "BotPrediction"("marketType");

-- CreateIndex
CREATE INDEX "BotPrediction_strategyName_idx" ON "BotPrediction"("strategyName");

-- CreateIndex
CREATE INDEX "BotPrediction_createdAt_idx" ON "BotPrediction"("createdAt");

-- CreateIndex
CREATE INDEX "SimulatedTrade_predictionId_idx" ON "SimulatedTrade"("predictionId");

-- CreateIndex
CREATE INDEX "SimulatedTrade_marketId_idx" ON "SimulatedTrade"("marketId");

-- CreateIndex
CREATE INDEX "SimulatedTrade_status_idx" ON "SimulatedTrade"("status");

-- CreateIndex
CREATE INDEX "SimulatedTrade_createdAt_idx" ON "SimulatedTrade"("createdAt");

-- CreateIndex
CREATE INDEX "SimulatedTrade_resolvedAt_idx" ON "SimulatedTrade"("resolvedAt");

-- CreateIndex
CREATE INDEX "LearningStat_assetSymbol_idx" ON "LearningStat"("assetSymbol");

-- CreateIndex
CREATE INDEX "LearningStat_marketType_idx" ON "LearningStat"("marketType");

-- CreateIndex
CREATE INDEX "LearningStat_strategyName_idx" ON "LearningStat"("strategyName");

-- CreateIndex
CREATE INDEX "LearningStat_updatedAt_idx" ON "LearningStat"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningStat_strategyName_marketType_assetSymbol_predictedOutcome_key" ON "LearningStat"("strategyName", "marketType", "assetSymbol", "predictedOutcome");

-- CreateIndex
CREATE INDEX "BotRunLog_level_idx" ON "BotRunLog"("level");

-- CreateIndex
CREATE INDEX "BotRunLog_createdAt_idx" ON "BotRunLog"("createdAt");

-- CreateIndex
CREATE INDEX "DailyPerformance_assetSymbol_idx" ON "DailyPerformance"("assetSymbol");

-- CreateIndex
CREATE INDEX "DailyPerformance_marketType_idx" ON "DailyPerformance"("marketType");

-- CreateIndex
CREATE INDEX "DailyPerformance_createdAt_idx" ON "DailyPerformance"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPerformance_date_assetSymbol_marketType_key" ON "DailyPerformance"("date", "assetSymbol", "marketType");
