-- CreateTable
CREATE TABLE "RealOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "predictionId" TEXT NOT NULL,
    "simulatedTradeId" TEXT,
    "marketId" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "assetSymbol" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "predictedOutcome" TEXT NOT NULL,
    "entryRule" TEXT NOT NULL,
    "stake" DECIMAL NOT NULL,
    "requestedPrice" DECIMAL NOT NULL,
    "requestedShares" DECIMAL NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "responseData" TEXT,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RealOrder_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "BotPrediction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RealOrder_simulatedTradeId_fkey" FOREIGN KEY ("simulatedTradeId") REFERENCES "SimulatedTrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RealOrder_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RealOrder_externalOrderId_key" ON "RealOrder"("externalOrderId");

-- CreateIndex
CREATE INDEX "RealOrder_predictionId_idx" ON "RealOrder"("predictionId");

-- CreateIndex
CREATE INDEX "RealOrder_simulatedTradeId_idx" ON "RealOrder"("simulatedTradeId");

-- CreateIndex
CREATE INDEX "RealOrder_marketId_idx" ON "RealOrder"("marketId");

-- CreateIndex
CREATE INDEX "RealOrder_assetSymbol_idx" ON "RealOrder"("assetSymbol");

-- CreateIndex
CREATE INDEX "RealOrder_marketType_idx" ON "RealOrder"("marketType");

-- CreateIndex
CREATE INDEX "RealOrder_entryRule_idx" ON "RealOrder"("entryRule");

-- CreateIndex
CREATE INDEX "RealOrder_status_idx" ON "RealOrder"("status");

-- CreateIndex
CREATE INDEX "RealOrder_submittedAt_idx" ON "RealOrder"("submittedAt");

-- CreateIndex
CREATE INDEX "RealOrder_createdAt_idx" ON "RealOrder"("createdAt");
