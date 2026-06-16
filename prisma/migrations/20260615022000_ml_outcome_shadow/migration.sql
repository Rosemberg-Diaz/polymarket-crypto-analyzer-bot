ALTER TABLE "BotPrediction" ADD COLUMN "mlOutcomePrediction" TEXT;
ALTER TABLE "BotPrediction" ADD COLUMN "mlProbabilityUp" DECIMAL;
ALTER TABLE "BotPrediction" ADD COLUMN "mlProbabilityDown" DECIMAL;
ALTER TABLE "BotPrediction" ADD COLUMN "mlOutcomeEntryPrice" DECIMAL;
ALTER TABLE "BotPrediction" ADD COLUMN "mlOutcomeModelVersion" TEXT;
ALTER TABLE "BotPrediction" ADD COLUMN "mlOutcomeFeatures" TEXT;
ALTER TABLE "BotPrediction" ADD COLUMN "mlOutcomeScoredAt" DATETIME;

CREATE INDEX "BotPrediction_mlOutcomePrediction_idx"
ON "BotPrediction"("mlOutcomePrediction");
