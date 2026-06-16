ALTER TABLE "ShortTermExitObservation" ADD COLUMN "mlRiskLabel" TEXT;
ALTER TABLE "ShortTermExitObservation" ADD COLUMN "mlRiskProbability" DECIMAL;
ALTER TABLE "ShortTermExitObservation" ADD COLUMN "mlModelVersion" TEXT;
ALTER TABLE "ShortTermExitObservation" ADD COLUMN "mlFeatures" TEXT;
ALTER TABLE "ShortTermExitObservation" ADD COLUMN "mlScoredAt" DATETIME;

ALTER TABLE "ShortTermExitQuote" ADD COLUMN "bidDepth5" DECIMAL;
ALTER TABLE "ShortTermExitQuote" ADD COLUMN "askDepth5" DECIMAL;
ALTER TABLE "ShortTermExitQuote" ADD COLUMN "depthImbalance" DECIMAL;
ALTER TABLE "ShortTermExitQuote" ADD COLUMN "microPrice" DECIMAL;
ALTER TABLE "ShortTermExitQuote" ADD COLUMN "orderFlowRiskScore" INTEGER;
ALTER TABLE "ShortTermExitQuote" ADD COLUMN "orderFlowRiskReasons" TEXT;

CREATE INDEX "ShortTermExitObservation_mlRiskLabel_idx"
ON "ShortTermExitObservation"("mlRiskLabel");
