DROP INDEX "MlOutcomeShadowExecution_marketId_key";

ALTER TABLE "MlOutcomeShadowExecution"
ADD COLUMN "modelProbability" DECIMAL;

ALTER TABLE "MlOutcomeShadowExecution"
ADD COLUMN "expectedProfit" DECIMAL;

ALTER TABLE "MlOutcomeShadowExecution"
ADD COLUMN "expectedRoi" DECIMAL;

CREATE UNIQUE INDEX "MlOutcomeShadowExecution_marketId_checkpointSeconds_key"
ON "MlOutcomeShadowExecution"("marketId", "checkpointSeconds");
