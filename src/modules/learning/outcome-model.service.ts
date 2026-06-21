import fs from "node:fs";
import path from "node:path";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import {
  buildOutcomeVector,
  normalizeCheckpoint,
  OUTCOME_FEATURE_NAMES
} from "./outcome-feature-builder.service";
import {
  BinaryOutcome,
  OutcomeModelArtifact,
  OutcomeModelScore,
  OutcomeRawFeatures,
  OutcomeTimeframe,
  OutcomeTrainingSample,
  OutcomeValidationMetrics
} from "./outcome-model.types";
import {
  predictLogisticProbability,
  trainLogisticRegression
} from "./logistic-regression.service";

export const OUTCOME_MODEL_VERSION = "OUTCOME_UP_DOWN_LOGREG_V1";
export interface OutcomeTrainingOptions {
  outputDirectory?: string;
  updateRuntimeCache?: boolean;
  versionSuffix?: string;
}

const OFFICIAL_RESOLUTION_SOURCES = new Set([
  "POLYMARKET_EXPLICIT",
  "GAMMA_OUTCOME_PRICES",
  "CLOB_FINAL_PRICE",
  "POLYMARKET_RTDS_CHAINLINK_CLOSE"
]);

export class OutcomeModelService {
  private readonly artifacts = new Map<OutcomeTimeframe, OutcomeModelArtifact | null>();

  constructor(private readonly logger?: LoggerService) {}

  score(features: OutcomeRawFeatures): OutcomeModelScore | null {
    const artifact = this.loadArtifact(features.timeframe);
    if (!artifact) {
      return null;
    }
    const probabilityUp = predictLogisticProbability(
      buildOutcomeVector(features),
      artifact
    );
    return {
      predictedOutcome:
        probabilityUp >= artifact.threshold ? "UP" : "DOWN",
      probabilityUp,
      probabilityDown: 1 - probabilityUp,
      modelVersion: artifact.version,
      features
    };
  }

  async trainAllAndSave(
    options: OutcomeTrainingOptions = {}
  ): Promise<OutcomeModelArtifact[]> {
    const samples = await loadNormalizedOutcomeSamples();
    const artifacts: OutcomeModelArtifact[] = [];
    for (const timeframe of ["5m", "15m"] as const) {
      const timeframeSamples = samples.filter(
        (sample) => sample.features.timeframe === timeframe
      );
      const artifact = trainTimeframeModel(timeframeSamples, timeframe);
      if (options.versionSuffix) {
        artifact.version = `${artifact.version}_${options.versionSuffix}`;
      }
      const modelPath = outcomeModelPath(timeframe, options.outputDirectory);
      fs.mkdirSync(path.dirname(modelPath), { recursive: true });
      fs.writeFileSync(modelPath, JSON.stringify(artifact, null, 2));
      if (options.updateRuntimeCache !== false) {
        this.artifacts.set(timeframe, artifact);
      }
      artifacts.push(artifact);
      this.logger?.info("UP/DOWN outcome shadow model trained.", {
        timeframe,
        modelVersion: artifact.version,
        trainingSamples: artifact.trainingSamples,
        trainingMarkets: artifact.trainingMarkets,
        validation: artifact.validation
      });
    }
    return artifacts;
  }

  private loadArtifact(timeframe: OutcomeTimeframe): OutcomeModelArtifact | null {
    if (this.artifacts.has(timeframe)) {
      return this.artifacts.get(timeframe) ?? null;
    }
    try {
      const artifact = JSON.parse(
        fs.readFileSync(outcomeModelPath(timeframe), "utf8")
      ) as OutcomeModelArtifact;
      this.artifacts.set(timeframe, artifact);
      return artifact;
    } catch (error) {
      this.artifacts.set(timeframe, null);
      this.logger?.warn("UP/DOWN outcome shadow model is unavailable.", {
        timeframe,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}

export function evaluateOutcomeArtifactOnRecentHoldout(
  artifact: OutcomeModelArtifact,
  samples: OutcomeTrainingSample[],
  timeframe: OutcomeTimeframe
): OutcomeValidationMetrics {
  const markets = groupSamplesByMarket(
    samples.filter((sample) => sample.features.timeframe === timeframe)
  ).sort((left, right) => left.at.getTime() - right.at.getTime());
  const splitIndex = Math.max(1, Math.floor(markets.length * 0.8));
  const validationMarkets = markets.slice(splitIndex);
  return evaluateOutcomeModel(
    validationMarkets.flatMap((market) => market.samples),
    validationMarkets.length,
    artifact
  );
}

export async function loadNormalizedOutcomeSamples(): Promise<OutcomeTrainingSample[]> {
  const rows = await prisma.observationEvaluation.findMany({
    where: {
      status: "RESOLVED",
      resolutionSource: { in: [...OFFICIAL_RESOLUTION_SOURCES] }
    },
    include: {
      prediction: true,
      market: {
        select: {
          timeframe: true,
          endDate: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const normalized = new Map<
    string,
    OutcomeTrainingSample & { checkpointDistance: number }
  >();
  for (const row of rows) {
    const timeframe = row.market.timeframe;
    if (timeframe !== "5m" && timeframe !== "15m") {
      continue;
    }
    const winner = parseWinner(row.result);
    const features = parseFeatures(row.prediction.features);
    if (
      !winner ||
      features.targetPriceTrustedForLearning !== true
    ) {
      continue;
    }

    const targetPrice = finiteNumber(features.targetPrice);
    const currentAssetPrice = finiteNumber(features.currentAssetPrice);
    const distanceToTargetPercent = finiteNumber(features.distanceToTargetPercent);
    const secondsToClose = finiteNumber(features.secondsToClose);
    const entryPrice = finiteNumber(features.entryPrice) ??
      Number(row.prediction.entryPrice);
    if (
      targetPrice === null ||
      targetPrice <= 0 ||
      currentAssetPrice === null ||
      currentAssetPrice <= 0 ||
      distanceToTargetPercent === null ||
      Math.abs(distanceToTargetPercent) > 0.1 ||
      secondsToClose === null ||
      secondsToClose < 0 ||
      secondsToClose > (timeframe === "15m" ? 900 : 300) ||
      !Number.isFinite(entryPrice) ||
      entryPrice <= 0 ||
      entryPrice >= 1
    ) {
      continue;
    }

    const predictedOutcome = row.prediction.predictedOutcome.toUpperCase();
    const explicitUpPrice = finiteNumber(features.upPrice);
    const explicitDownPrice = finiteNumber(features.downPrice);
    const impliedProbabilityUp = explicitUpPrice !== null &&
      explicitDownPrice !== null &&
      explicitUpPrice + explicitDownPrice > 0
      ? explicitUpPrice / (explicitUpPrice + explicitDownPrice)
      : ["UP", "YES"].includes(predictedOutcome)
        ? entryPrice
        : 1 - entryPrice;
    const checkpointSeconds = normalizeCheckpoint(secondsToClose, timeframe);
    const key = `${row.marketId}:${checkpointSeconds}`;
    const checkpointDistance = Math.abs(secondsToClose - checkpointSeconds);
    const sample: OutcomeTrainingSample & { checkpointDistance: number } = {
      marketId: row.marketId,
      marketAt: row.market.endDate ?? row.createdAt,
      checkpointSeconds,
      winner,
      checkpointDistance,
      features: {
        assetSymbol: row.prediction.assetSymbol,
        timeframe,
        targetPrice,
        currentAssetPrice,
        distanceToTargetPercent,
        secondsToClose,
        impliedProbabilityUp,
        checkpointSeconds
      }
    };
    const existing = normalized.get(key);
    if (!existing || checkpointDistance < existing.checkpointDistance) {
      normalized.set(key, sample);
    }
  }

  return [...normalized.values()].map(({ checkpointDistance: _, ...sample }) => sample);
}

function trainTimeframeModel(
  samples: OutcomeTrainingSample[],
  timeframe: OutcomeTimeframe
): OutcomeModelArtifact {
  const markets = groupSamplesByMarket(samples);
  if (markets.length < 100) {
    throw new Error(
      `Insufficient ${timeframe} markets for outcome model: ${markets.length}.`
    );
  }
  markets.sort((left, right) => left.at.getTime() - right.at.getTime());
  const splitIndex = Math.max(1, Math.floor(markets.length * 0.8));
  const training = markets.slice(0, splitIndex).flatMap((market) => market.samples);
  const validation = markets.slice(splitIndex).flatMap((market) => market.samples);
  const validationMarketCount = markets.length - splitIndex;
  const trained = trainLogisticRegression(
    training.map((sample) => buildOutcomeVector(sample.features)),
    training.map((sample) => sample.winner === "UP" ? 1 : 0),
    { epochs: 1_500, learningRate: 0.04, l2: 0.02 }
  );
  const validationMetrics = evaluateOutcomeModel(
    validation,
    validationMarketCount,
    trained
  );
  const finalModel = trainLogisticRegression(
    samples.map((sample) => buildOutcomeVector(sample.features)),
    samples.map((sample) => sample.winner === "UP" ? 1 : 0),
    { epochs: 1_500, learningRate: 0.04, l2: 0.02 }
  );

  return {
    version: `${OUTCOME_MODEL_VERSION}_${timeframe.toUpperCase()}`,
    timeframe,
    trainedAt: new Date().toISOString(),
    featureNames: [...OUTCOME_FEATURE_NAMES],
    ...finalModel,
    threshold: 0.5,
    trainingSamples: samples.length,
    trainingMarkets: markets.length,
    validation: validationMetrics,
    normalization: {
      trustedTargetsOnly: true,
      officialOutcomesOnly: true,
      grouping: "MARKET_AND_NORMALIZED_CHECKPOINT",
      split: "CHRONOLOGICAL_BY_MARKET"
    }
  };
}

function evaluateOutcomeModel(
  samples: OutcomeTrainingSample[],
  markets: number,
  model: ReturnType<typeof trainLogisticRegression>
): OutcomeValidationMetrics {
  let trueUp = 0;
  let falseUp = 0;
  let trueDown = 0;
  let falseDown = 0;
  let baselineMarketCorrect = 0;
  let baselineSpotCorrect = 0;

  for (const sample of samples) {
    const probabilityUp = predictLogisticProbability(
      buildOutcomeVector(sample.features),
      model
    );
    const predicted = probabilityUp >= 0.5 ? "UP" : "DOWN";
    if (predicted === "UP" && sample.winner === "UP") trueUp += 1;
    if (predicted === "UP" && sample.winner === "DOWN") falseUp += 1;
    if (predicted === "DOWN" && sample.winner === "DOWN") trueDown += 1;
    if (predicted === "DOWN" && sample.winner === "UP") falseDown += 1;
    if (
      (sample.features.impliedProbabilityUp >= 0.5 ? "UP" : "DOWN") ===
      sample.winner
    ) {
      baselineMarketCorrect += 1;
    }
    if (
      (sample.features.distanceToTargetPercent >= 0 ? "UP" : "DOWN") ===
      sample.winner
    ) {
      baselineSpotCorrect += 1;
    }
  }

  const total = Math.max(1, samples.length);
  return {
    samples: samples.length,
    markets,
    accuracy: (trueUp + trueDown) / total,
    precisionUp: trueUp / Math.max(1, trueUp + falseUp),
    precisionDown: trueDown / Math.max(1, trueDown + falseDown),
    recallUp: trueUp / Math.max(1, trueUp + falseDown),
    recallDown: trueDown / Math.max(1, trueDown + falseUp),
    baselineMarketAccuracy: baselineMarketCorrect / total,
    baselineSpotAccuracy: baselineSpotCorrect / total
  };
}

function groupSamplesByMarket(samples: OutcomeTrainingSample[]) {
  const grouped = new Map<string, OutcomeTrainingSample[]>();
  for (const sample of samples) {
    const rows = grouped.get(sample.marketId) ?? [];
    rows.push(sample);
    grouped.set(sample.marketId, rows);
  }
  return [...grouped.entries()].map(([marketId, rows]) => ({
    marketId,
    at: rows[0].marketAt,
    samples: rows
  }));
}

function outcomeModelPath(
  timeframe: OutcomeTimeframe,
  outputDirectory?: string
): string {
  return path.resolve(
    outputDirectory ?? path.resolve(process.cwd(), "models"),
    `outcome-up-down-logistic-${timeframe}.json`
  );
}

function parseWinner(result: string | null): BinaryOutcome | null {
  const normalized = result?.split(":")[0]?.toUpperCase();
  if (normalized === "UP" || normalized === "YES") return "UP";
  if (normalized === "DOWN" || normalized === "NO") return "DOWN";
  return null;
}

function parseFeatures(value: string | null): Record<string, unknown> {
  try {
    return JSON.parse(value ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
