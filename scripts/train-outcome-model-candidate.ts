import fs from "node:fs";
import path from "node:path";
import { connectDatabase, disconnectDatabase } from "../src/database/client";
import { LoggerService } from "../src/modules/logger/logger.service";
import {
  evaluateOutcomeArtifactOnRecentHoldout,
  loadNormalizedOutcomeSamples,
  OutcomeModelService
} from "../src/modules/learning/outcome-model.service";
import {
  OutcomeModelArtifact,
  OutcomeTimeframe
} from "../src/modules/learning/outcome-model.types";

async function main(): Promise<void> {
  await connectDatabase();
  const generatedAt = new Date();
  const candidateId = generatedAt.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const outputDirectory = path.resolve(
    process.cwd(),
    "models",
    "candidates",
    candidateId
  );
  const samples = await loadNormalizedOutcomeSamples();
  const candidates = await new OutcomeModelService(
    new LoggerService("info")
  ).trainAllAndSave({
    outputDirectory,
    updateRuntimeCache: false,
    versionSuffix: `CANDIDATE_${candidateId}`
  });

  const comparisons = candidates.map((candidate) => {
    const timeframe = candidate.timeframe as OutcomeTimeframe;
    const production = readProductionArtifact(timeframe);
    const incumbentOnCurrentHoldout =
      evaluateOutcomeArtifactOnRecentHoldout(
        production,
        samples,
        timeframe
      );
    return {
      timeframe,
      productionVersion: production.version,
      candidateVersion: candidate.version,
      productionTrainedAt: production.trainedAt,
      candidateTrainedAt: candidate.trainedAt,
      productionTrainingMarkets: production.trainingMarkets,
      candidateTrainingMarkets: candidate.trainingMarkets,
      incumbentOnCurrentHoldout,
      candidateOnCurrentHoldout: candidate.validation,
      accuracyDelta:
        candidate.validation.accuracy -
        incumbentOnCurrentHoldout.accuracy,
      precisionUpDelta:
        candidate.validation.precisionUp -
        incumbentOnCurrentHoldout.precisionUp,
      precisionDownDelta:
        candidate.validation.precisionDown -
        incumbentOnCurrentHoldout.precisionDown,
      automaticallyPromoted: false
    };
  });

  const report = {
    generatedAt: generatedAt.toISOString(),
    outputDirectory,
    productionFilesModified: false,
    runtimeCacheModified: false,
    automaticallyPromoted: false,
    comparisons
  };
  fs.writeFileSync(
    path.join(outputDirectory, "comparison.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
}

function readProductionArtifact(
  timeframe: OutcomeTimeframe
): OutcomeModelArtifact {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        process.cwd(),
        "models",
        `outcome-up-down-logistic-${timeframe}.json`
      ),
      "utf8"
    )
  ) as OutcomeModelArtifact;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
