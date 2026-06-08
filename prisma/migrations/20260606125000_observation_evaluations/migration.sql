CREATE TABLE "ObservationEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "predictionId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "observationType" TEXT NOT NULL,
    "hypotheticalStake" DECIMAL NOT NULL,
    "entryPrice" DECIMAL NOT NULL,
    "shares" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "wouldWin" BOOLEAN,
    "finalValue" DECIMAL,
    "hypotheticalProfit" DECIMAL,
    "hypotheticalRoi" DECIMAL,
    "resolutionSource" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ObservationEvaluation_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "BotPrediction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ObservationEvaluation_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ObservationEvaluation_predictionId_key" ON "ObservationEvaluation"("predictionId");
CREATE INDEX "ObservationEvaluation_marketId_idx" ON "ObservationEvaluation"("marketId");
CREATE INDEX "ObservationEvaluation_observationType_idx" ON "ObservationEvaluation"("observationType");
CREATE INDEX "ObservationEvaluation_status_idx" ON "ObservationEvaluation"("status");
CREATE INDEX "ObservationEvaluation_createdAt_idx" ON "ObservationEvaluation"("createdAt");
CREATE INDEX "ObservationEvaluation_resolvedAt_idx" ON "ObservationEvaluation"("resolvedAt");
