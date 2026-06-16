CREATE TABLE "LiveOutcomeCheckpointTrade" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shadowExecutionId" TEXT NOT NULL,
  "predictionId" TEXT NOT NULL,
  "marketId" TEXT NOT NULL,
  "assetSymbol" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "predictedOutcome" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "checkpointSeconds" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ENTRY_ATTEMPTING',
  "budget" DECIMAL NOT NULL,
  "requestedMaxPrice" DECIMAL NOT NULL,
  "externalOrderId" TEXT,
  "filledShares" DECIMAL NOT NULL DEFAULT 0,
  "cashAmount" DECIMAL NOT NULL DEFAULT 0,
  "averagePrice" DECIMAL,
  "responseData" TEXT,
  "errorMessage" TEXT,
  "officialWinner" TEXT,
  "resolutionSource" TEXT,
  "isWin" BOOLEAN,
  "finalValue" DECIMAL,
  "profit" DECIMAL,
  "roi" DECIMAL,
  "openedAt" DATETIME,
  "resolvedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LiveOutcomeCheckpointTrade_shadowExecutionId_fkey"
    FOREIGN KEY ("shadowExecutionId") REFERENCES "MlOutcomeShadowExecution" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveOutcomeCheckpointTrade_predictionId_fkey"
    FOREIGN KEY ("predictionId") REFERENCES "BotPrediction" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveOutcomeCheckpointTrade_marketId_fkey"
    FOREIGN KEY ("marketId") REFERENCES "Market" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LiveOutcomeCheckpointTrade_shadowExecutionId_key"
ON "LiveOutcomeCheckpointTrade"("shadowExecutionId");

CREATE UNIQUE INDEX "LiveOutcomeCheckpointTrade_predictionId_key"
ON "LiveOutcomeCheckpointTrade"("predictionId");

CREATE INDEX "LiveOutcomeCheckpointTrade_marketId_idx"
ON "LiveOutcomeCheckpointTrade"("marketId");

CREATE INDEX "LiveOutcomeCheckpointTrade_assetSymbol_idx"
ON "LiveOutcomeCheckpointTrade"("assetSymbol");

CREATE INDEX "LiveOutcomeCheckpointTrade_timeframe_idx"
ON "LiveOutcomeCheckpointTrade"("timeframe");

CREATE INDEX "LiveOutcomeCheckpointTrade_predictedOutcome_idx"
ON "LiveOutcomeCheckpointTrade"("predictedOutcome");

CREATE INDEX "LiveOutcomeCheckpointTrade_checkpointSeconds_idx"
ON "LiveOutcomeCheckpointTrade"("checkpointSeconds");

CREATE INDEX "LiveOutcomeCheckpointTrade_status_idx"
ON "LiveOutcomeCheckpointTrade"("status");

CREATE INDEX "LiveOutcomeCheckpointTrade_createdAt_idx"
ON "LiveOutcomeCheckpointTrade"("createdAt");

CREATE INDEX "LiveOutcomeCheckpointTrade_resolvedAt_idx"
ON "LiveOutcomeCheckpointTrade"("resolvedAt");
