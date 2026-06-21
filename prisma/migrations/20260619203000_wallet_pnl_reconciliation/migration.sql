ALTER TABLE "LiveOutcomeCheckpointTrade" ADD COLUMN "actualBuyUsdc" DECIMAL;
ALTER TABLE "LiveOutcomeCheckpointTrade" ADD COLUMN "actualPayoutUsdc" DECIMAL;
ALTER TABLE "LiveOutcomeCheckpointTrade" ADD COLUMN "actualProfit" DECIMAL;
ALTER TABLE "LiveOutcomeCheckpointTrade" ADD COLUMN "actualRoi" DECIMAL;
ALTER TABLE "LiveOutcomeCheckpointTrade" ADD COLUMN "buyTransactionHash" TEXT;
ALTER TABLE "LiveOutcomeCheckpointTrade" ADD COLUMN "redeemTransactionHash" TEXT;
ALTER TABLE "LiveOutcomeCheckpointTrade" ADD COLUMN "reconciliationStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "LiveOutcomeCheckpointTrade" ADD COLUMN "reconciledAt" DATETIME;

CREATE INDEX "LiveOutcomeCheckpointTrade_reconciliationStatus_idx"
ON "LiveOutcomeCheckpointTrade"("reconciliationStatus");

CREATE TABLE "WalletDailyPnl" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dayKey" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
  "openingCashUsd" DECIMAL NOT NULL,
  "openingPositionsUsd" DECIMAL NOT NULL,
  "openingEquityUsd" DECIMAL NOT NULL,
  "closingCashUsd" DECIMAL NOT NULL,
  "closingPositionsUsd" DECIMAL NOT NULL,
  "closingEquityUsd" DECIMAL NOT NULL,
  "buyUsdc" DECIMAL NOT NULL DEFAULT 0,
  "sellUsdc" DECIMAL NOT NULL DEFAULT 0,
  "redeemUsdc" DECIMAL NOT NULL DEFAULT 0,
  "realizedTradingPnl" DECIMAL NOT NULL DEFAULT 0,
  "equityChange" DECIMAL NOT NULL DEFAULT 0,
  "isComplete" BOOLEAN NOT NULL DEFAULT false,
  "firstCapturedAt" DATETIME NOT NULL,
  "lastCapturedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "WalletDailyPnl_dayKey_key" ON "WalletDailyPnl"("dayKey");
CREATE INDEX "WalletDailyPnl_dayKey_idx" ON "WalletDailyPnl"("dayKey");
CREATE INDEX "WalletDailyPnl_lastCapturedAt_idx" ON "WalletDailyPnl"("lastCapturedAt");
