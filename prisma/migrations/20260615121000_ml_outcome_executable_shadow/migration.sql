CREATE TABLE "MlOutcomeShadowExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "predictionId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "predictedOutcome" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "checkpointSeconds" INTEGER NOT NULL,
    "actualSecondsToClose" INTEGER NOT NULL,
    "requestedBudget" DECIMAL NOT NULL,
    "status" TEXT NOT NULL,
    "skipReason" TEXT,
    "minOrderSize" DECIMAL,
    "tickSize" DECIMAL,
    "bestAsk" DECIMAL,
    "worstFillPrice" DECIMAL,
    "averageEntryPrice" DECIMAL,
    "shares" DECIMAL,
    "grossCost" DECIMAL,
    "fee" DECIMAL,
    "totalCost" DECIMAL,
    "slippage" DECIMAL,
    "fullyFilled" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL,
    "bookTimestamp" TEXT,
    "bookFingerprint" TEXT,
    "officialWinner" TEXT,
    "resolutionSource" TEXT,
    "isWin" BOOLEAN,
    "finalValue" DECIMAL,
    "profit" DECIMAL,
    "roi" DECIMAL,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MlOutcomeShadowExecution_predictionId_fkey"
      FOREIGN KEY ("predictionId") REFERENCES "BotPrediction" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MlOutcomeShadowExecution_marketId_fkey"
      FOREIGN KEY ("marketId") REFERENCES "Market" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MlOutcomeShadowExecution_predictionId_key"
ON "MlOutcomeShadowExecution"("predictionId");

CREATE UNIQUE INDEX "MlOutcomeShadowExecution_marketId_key"
ON "MlOutcomeShadowExecution"("marketId");

CREATE INDEX "MlOutcomeShadowExecution_assetSymbol_idx"
ON "MlOutcomeShadowExecution"("assetSymbol");

CREATE INDEX "MlOutcomeShadowExecution_timeframe_idx"
ON "MlOutcomeShadowExecution"("timeframe");

CREATE INDEX "MlOutcomeShadowExecution_predictedOutcome_idx"
ON "MlOutcomeShadowExecution"("predictedOutcome");

CREATE INDEX "MlOutcomeShadowExecution_status_idx"
ON "MlOutcomeShadowExecution"("status");

CREATE INDEX "MlOutcomeShadowExecution_createdAt_idx"
ON "MlOutcomeShadowExecution"("createdAt");

CREATE INDEX "MlOutcomeShadowExecution_resolvedAt_idx"
ON "MlOutcomeShadowExecution"("resolvedAt");
