CREATE INDEX "Market_runtime_scan_idx"
ON "Market"("category", "marketType", "timeframe", "active", "closed", "endDate");

CREATE INDEX "MarketSnapshot_marketId_createdAt_idx"
ON "MarketSnapshot"("marketId", "createdAt");

CREATE INDEX "BotPrediction_marketId_strategyName_createdAt_idx"
ON "BotPrediction"("marketId", "strategyName", "createdAt");

CREATE INDEX "ShortTermExitObservation_marketId_strategyVersion_idx"
ON "ShortTermExitObservation"("marketId", "strategyVersion");

CREATE INDEX "ShortTermEntryQuote_marketId_outcome_createdAt_idx"
ON "ShortTermEntryQuote"("marketId", "outcome", "createdAt");

CREATE INDEX "DailyExitCycle_status_marketId_idx"
ON "DailyExitCycle"("status", "marketId");

CREATE INDEX "DailyMarketQuote_marketId_outcome_createdAt_idx"
ON "DailyMarketQuote"("marketId", "outcome", "createdAt");
