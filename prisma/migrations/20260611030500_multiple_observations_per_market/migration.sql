DROP INDEX IF EXISTS "ObservationEvaluation_marketId_observationType_key";

CREATE INDEX "ObservationEvaluation_marketId_observationType_idx"
ON "ObservationEvaluation"("marketId", "observationType");
