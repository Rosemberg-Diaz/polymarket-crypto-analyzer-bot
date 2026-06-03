-- CreateTable
CREATE TABLE "CryptoMarket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "polymarketId" TEXT,
    "title" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'CRYPTO',
    "liquidityUsd" REAL NOT NULL DEFAULT 0,
    "spread" REAL NOT NULL DEFAULT 0,
    "yesPrice" REAL,
    "noPrice" REAL,
    "closesAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Signal_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "CryptoMarket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimulationTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entryPrice" REAL NOT NULL,
    "stakeUsd" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "pnlUsd" REAL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "SimulationTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "CryptoMarket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'SIMULATION_ONLY',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "notes" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "CryptoMarket_polymarketId_key" ON "CryptoMarket"("polymarketId");
