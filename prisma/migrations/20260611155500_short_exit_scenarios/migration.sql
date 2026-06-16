CREATE TABLE "ShortTermExitScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "observationId" TEXT NOT NULL,
    "thresholdSeconds" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "exitReason" TEXT,
    "exitBid" DECIMAL,
    "finalValue" DECIMAL,
    "profit" DECIMAL,
    "roi" DECIMAL,
    "evaluatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShortTermExitScenario_observationId_fkey"
      FOREIGN KEY ("observationId") REFERENCES "ShortTermExitObservation" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ShortTermExitScenario_observationId_thresholdSeconds_key"
ON "ShortTermExitScenario"("observationId", "thresholdSeconds");

CREATE INDEX "ShortTermExitScenario_thresholdSeconds_idx"
ON "ShortTermExitScenario"("thresholdSeconds");

CREATE INDEX "ShortTermExitScenario_status_idx"
ON "ShortTermExitScenario"("status");

CREATE INDEX "ShortTermExitScenario_createdAt_idx"
ON "ShortTermExitScenario"("createdAt");
