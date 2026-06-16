import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import {
  buildEntryRiskVector,
  ENTRY_RISK_FEATURE_NAMES
} from "./entry-risk-feature-builder.service";
import {
  EntryRiskRawFeatures,
  EntryRiskScore,
  EntryRiskTrainingSample,
  LogisticRegressionArtifact
} from "./entry-risk-model.types";
import {
  predictLogisticProbability,
  trainLogisticRegression
} from "./logistic-regression.service";

export const ENTRY_RISK_MODEL_VERSION = "ENTRY_RISK_LOGREG_V1";
export const ENTRY_RISK_MODEL_PATH = path.resolve(
  process.cwd(),
  "models",
  "entry-risk-logistic-v1.json"
);

interface TrainingRow {
  marketId: string;
  assetSymbol: string;
  outcome: string;
  timeframe: string;
  observedAt: Date;
  profit: Prisma.Decimal;
  exitTrigger: string | null;
  entryBid: Prisma.Decimal;
  entryAsk: Prisma.Decimal;
  spread: Prisma.Decimal;
  liquidity: Prisma.Decimal;
  secondsToClose: number;
  bidSize: Prisma.Decimal;
  askSize: Prisma.Decimal;
  bidDepth5: Prisma.Decimal | null;
  askDepth5: Prisma.Decimal | null;
  depthImbalance: Prisma.Decimal | null;
  microPrice: Prisma.Decimal | null;
}

export class EntryRiskModelService {
  private artifact: LogisticRegressionArtifact | null | undefined;

  constructor(private readonly logger?: LoggerService) {}

  score(features: EntryRiskRawFeatures): EntryRiskScore | null {
    const artifact = this.loadArtifact();
    if (!artifact) {
      return null;
    }

    const probability = predictLogisticProbability(
      buildEntryRiskVector(features),
      artifact
    );
    return {
      label: probability >= artifact.threshold ? "CONSIDER_BLOCK" : "ALLOW",
      probability,
      modelVersion: artifact.version,
      features
    };
  }

  async trainAndSave(): Promise<LogisticRegressionArtifact> {
    const samples = await loadTrainingSamples();
    if (samples.length < 100) {
      throw new Error(
        `Insufficient independent resolved samples: ${samples.length}. Minimum: 100.`
      );
    }

    samples.sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
    const splitIndex = Math.max(1, Math.floor(samples.length * 0.8));
    const training = samples.slice(0, splitIndex);
    const validation = samples.slice(splitIndex);
    const trained = trainLogisticRegression(
      training.map((sample) => buildEntryRiskVector(sample.features)),
      training.map((sample) => sample.highRisk ? 1 : 0)
    );
    const threshold = selectValidationThreshold(validation, trained);
    const validationMetrics = evaluateModel(validation, trained, threshold);
    const finalModel = trainLogisticRegression(
      samples.map((sample) => buildEntryRiskVector(sample.features)),
      samples.map((sample) => sample.highRisk ? 1 : 0)
    );
    const artifact: LogisticRegressionArtifact = {
      version: ENTRY_RISK_MODEL_VERSION,
      trainedAt: new Date().toISOString(),
      featureNames: [...ENTRY_RISK_FEATURE_NAMES],
      ...finalModel,
      threshold,
      trainingSamples: samples.length,
      positiveSamples: samples.filter((sample) => sample.highRisk).length,
      validationSamples: validation.length,
      validation: validationMetrics
    };

    fs.mkdirSync(path.dirname(ENTRY_RISK_MODEL_PATH), { recursive: true });
    fs.writeFileSync(ENTRY_RISK_MODEL_PATH, JSON.stringify(artifact, null, 2));
    this.artifact = artifact;
    this.logger?.info("Entry-risk shadow model trained.", {
      modelVersion: artifact.version,
      samples: artifact.trainingSamples,
      positiveSamples: artifact.positiveSamples,
      validation: artifact.validation
    });
    return artifact;
  }

  private loadArtifact(): LogisticRegressionArtifact | null {
    if (this.artifact !== undefined) {
      return this.artifact;
    }
    try {
      this.artifact = JSON.parse(
        fs.readFileSync(ENTRY_RISK_MODEL_PATH, "utf8")
      ) as LogisticRegressionArtifact;
    } catch (error) {
      this.artifact = null;
      this.logger?.warn("Entry-risk shadow model is not available yet.", {
        modelPath: ENTRY_RISK_MODEL_PATH,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return this.artifact;
  }
}

async function loadTrainingSamples(): Promise<EntryRiskTrainingSample[]> {
  const rows = await prisma.$queryRaw<TrainingRow[]>`
    SELECT
      r."marketId",
      r."assetSymbol",
      r."outcome",
      m."timeframe",
      o."createdAt" AS "observedAt",
      r."profit",
      r."exitTrigger",
      o."entryBid",
      o."entryAsk",
      q."spread",
      q."liquidity",
      q."secondsToClose",
      q."bidSize",
      q."askSize",
      q."bidDepth5",
      q."askDepth5",
      q."depthImbalance",
      q."microPrice"
    FROM "RealisticShortExitExecution" r
    JOIN "ShortTermExitObservation" o ON o."id" = r."observationId"
    JOIN "Market" m ON m."id" = r."marketId"
    JOIN "ShortTermEntryQuote" q ON q."id" = (
      SELECT q2."id"
      FROM "ShortTermEntryQuote" q2
      WHERE q2."marketId" = r."marketId"
        AND q2."outcome" = r."outcome"
        AND q2."createdAt" <= o."createdAt"
      ORDER BY q2."createdAt" DESC
      LIMIT 1
    )
    WHERE r."status" = 'RESOLVED'
      AND r."profit" IS NOT NULL
    ORDER BY o."createdAt" ASC
  `;

  const independent = new Map<string, EntryRiskTrainingSample>();
  for (const row of rows) {
    const key = `${row.marketId}:${row.outcome}`;
    if (independent.has(key)) {
      continue;
    }
    const profit = Number(row.profit);
    const highRisk =
      profit <= -0.1 ||
      [
        "LAST_MINUTE_FAK",
        "HELD_TO_OFFICIAL_RESOLUTION",
        "MARKET_CLOSE_REMAINDER",
        "API_DATA_GAP"
      ].includes(row.exitTrigger ?? "");
    independent.set(key, {
      marketId: row.marketId,
      observedAt: new Date(row.observedAt),
      highRisk,
      profit,
      features: {
        assetSymbol: row.assetSymbol,
        timeframe: row.timeframe,
        outcome: row.outcome,
        entryBid: Number(row.entryBid),
        entryAsk: Number(row.entryAsk),
        spread: Number(row.spread),
        liquidity: Number(row.liquidity),
        secondsToClose: row.secondsToClose,
        bidSize: Number(row.bidSize),
        askSize: Number(row.askSize),
        bidDepth5: Number(row.bidDepth5 ?? row.bidSize),
        askDepth5: Number(row.askDepth5 ?? row.askSize),
        depthImbalance: Number(row.depthImbalance ?? 0),
        microPrice: Number(
          row.microPrice ??
          (Number(row.entryBid) + Number(row.entryAsk)) / 2
        )
      }
    });
  }
  return [...independent.values()];
}

function evaluateModel(
  samples: EntryRiskTrainingSample[],
  model: ReturnType<typeof trainLogisticRegression>,
  threshold: number
) {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let blockedProfit = 0;
  let allowedProfit = 0;

  for (const sample of samples) {
    const blocked =
      predictLogisticProbability(buildEntryRiskVector(sample.features), model) >= threshold;
    if (blocked) {
      blockedProfit += sample.profit;
    } else {
      allowedProfit += sample.profit;
    }
    if (blocked && sample.highRisk) truePositive += 1;
    if (blocked && !sample.highRisk) falsePositive += 1;
    if (!blocked && !sample.highRisk) trueNegative += 1;
    if (!blocked && sample.highRisk) falseNegative += 1;
  }

  const total = samples.length || 1;
  return {
    accuracy: (truePositive + trueNegative) / total,
    precision: truePositive / Math.max(1, truePositive + falsePositive),
    recall: truePositive / Math.max(1, truePositive + falseNegative),
    specificity: trueNegative / Math.max(1, trueNegative + falsePositive),
    blockedSamples: truePositive + falsePositive,
    allowedSamples: trueNegative + falseNegative,
    blockedProfit,
    allowedProfit
  };
}

function selectValidationThreshold(
  samples: EntryRiskTrainingSample[],
  model: ReturnType<typeof trainLogisticRegression>
): number {
  if (samples.length === 0) {
    return 0.5;
  }

  const minimumAllowed = Math.ceil(samples.length * 0.3);
  let selected = {
    threshold: 0.5,
    allowedProfit: Number.NEGATIVE_INFINITY,
    recall: Number.NEGATIVE_INFINITY
  };

  for (let threshold = 0.3; threshold <= 0.8; threshold += 0.025) {
    const metrics = evaluateModel(samples, model, threshold);
    if (metrics.allowedSamples < minimumAllowed) {
      continue;
    }
    if (
      metrics.allowedProfit > selected.allowedProfit ||
      (
        metrics.allowedProfit === selected.allowedProfit &&
        metrics.recall > selected.recall
      )
    ) {
      selected = {
        threshold: Number(threshold.toFixed(3)),
        allowedProfit: metrics.allowedProfit,
        recall: metrics.recall
      };
    }
  }

  return selected.threshold;
}
