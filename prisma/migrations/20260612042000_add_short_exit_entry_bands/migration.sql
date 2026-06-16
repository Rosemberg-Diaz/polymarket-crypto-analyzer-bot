PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ShortTermExitObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL DEFAULT 'CHEAP_REBOUND_V1',
    "entryBand" TEXT NOT NULL DEFAULT 'DEFAULT',
    "entryTrigger" TEXT,
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
    "firstTakeProfit3At" DATETIME,
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
    CONSTRAINT "ShortTermExitObservation_marketId_fkey"
      FOREIGN KEY ("marketId") REFERENCES "Market" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_ShortTermExitObservation" (
    "id", "marketId", "assetSymbol", "outcome", "strategyVersion",
    "entryBand", "entryTrigger", "status", "stake", "entryAsk",
    "entryBid", "entrySpread", "shares", "buyFee", "entrySecondsToClose",
    "maxExecutableBid", "minExecutableBid", "maxNetRoi", "minNetRoi",
    "firstTakeProfit2At", "firstTakeProfit3At", "firstTakeProfit5At",
    "firstTakeProfit10At", "firstStopLoss3At", "firstStopLoss5At",
    "firstStopLoss10At", "exitBid", "sellFee", "finalValue", "profit",
    "roi", "exitReason", "exitedAt", "createdAt", "updatedAt"
)
SELECT
    "id", "marketId", "assetSymbol", "outcome", "strategyVersion",
    'DEFAULT', "entryTrigger", "status", "stake", "entryAsk",
    "entryBid", "entrySpread", "shares", "buyFee", "entrySecondsToClose",
    "maxExecutableBid", "minExecutableBid", "maxNetRoi", "minNetRoi",
    "firstTakeProfit2At", "firstTakeProfit3At", "firstTakeProfit5At",
    "firstTakeProfit10At", "firstStopLoss3At", "firstStopLoss5At",
    "firstStopLoss10At", "exitBid", "sellFee", "finalValue", "profit",
    "roi", "exitReason", "exitedAt", "createdAt", "updatedAt"
FROM "ShortTermExitObservation";

DROP TABLE "ShortTermExitObservation";
ALTER TABLE "new_ShortTermExitObservation" RENAME TO "ShortTermExitObservation";

CREATE UNIQUE INDEX "ShortTermExitObservation_marketId_outcome_strategyVersion_entryBand_key"
ON "ShortTermExitObservation"("marketId", "outcome", "strategyVersion", "entryBand");
CREATE INDEX "ShortTermExitObservation_assetSymbol_idx"
ON "ShortTermExitObservation"("assetSymbol");
CREATE INDEX "ShortTermExitObservation_outcome_idx"
ON "ShortTermExitObservation"("outcome");
CREATE INDEX "ShortTermExitObservation_entryBand_idx"
ON "ShortTermExitObservation"("entryBand");
CREATE INDEX "ShortTermExitObservation_strategyVersion_idx"
ON "ShortTermExitObservation"("strategyVersion");
CREATE INDEX "ShortTermExitObservation_status_idx"
ON "ShortTermExitObservation"("status");
CREATE INDEX "ShortTermExitObservation_createdAt_idx"
ON "ShortTermExitObservation"("createdAt");
CREATE INDEX "ShortTermExitObservation_exitedAt_idx"
ON "ShortTermExitObservation"("exitedAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
