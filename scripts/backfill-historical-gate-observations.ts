import { PrismaClient } from "@prisma/client";
import { config } from "../src/config/env";
import { ObservationEvaluationService } from "../src/modules/simulations/observation-evaluation.service";

const prisma = new PrismaClient();
const observationService = new ObservationEvaluationService();
const dryRun = process.argv.includes("--dry-run");

interface Features {
  blockedByHistoricalGate?: boolean;
  blockedReason?: string;
  baseEntryRule?: string;
  entryRule?: string;
  similarCases?: number;
  historicalWinRate?: number;
  historicalProfit?: number;
  secondsToClose?: number;
  spread?: number;
  liquidity?: number;
}

async function main(): Promise<void> {
  const predictions = await prisma.botPrediction.findMany({
    where: {
      recommendation: {
        in: ["WAIT", "ENTER_SMALL", "ENTER_MODERATE"]
      },
      observationEvaluation: null,
      simulatedTrades: {
        none: {}
      }
    },
    select: {
      id: true,
      marketId: true,
      entryPrice: true,
      features: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  let created = 0;
  let skipped = 0;
  const eligiblePredictionIds: string[] = [];

  for (const prediction of predictions) {
    const features = parseFeatures(prediction.features);
    const effectiveEntryRule =
      typeof features.baseEntryRule === "string"
        ? features.baseEntryRule
        : features.entryRule;
    const entryPrice = Number(prediction.entryPrice);

    if (!isHistoricalCountOnlyCandidate(features, effectiveEntryRule, entryPrice)) {
      skipped++;
      continue;
    }

    eligiblePredictionIds.push(prediction.id);

    if (!dryRun) {
      await observationService.createPendingObservation(
        prediction.id,
        prediction.marketId,
        `OBSERVE_HISTORICAL_GATE_${effectiveEntryRule}`,
        config.simulatedStakeUsd,
        entryPrice
      );
    }

    created++;
  }

  console.log(
    JSON.stringify({
      dryRun,
      inspected: predictions.length,
      eligible: created,
      skipped,
      eligiblePredictionIds
    })
  );
}

function isHistoricalCountOnlyCandidate(
  features: Features,
  effectiveEntryRule: string | undefined,
  entryPrice: number
): boolean {
  const secondsToClose = features.secondsToClose;

  return (
    typeof effectiveEntryRule === "string" &&
    effectiveEntryRule.startsWith("ENTER_") &&
    (features.blockedReason === "INSUFFICIENT_SIMILAR_CASES" ||
      (features.blockedReason === undefined && (features.similarCases ?? 5) < 5)) &&
    (features.historicalWinRate ?? 0) >= 0.6 &&
    (features.historicalProfit ?? 0) > 0 &&
    entryPrice > 0.05 &&
    entryPrice < 0.95 &&
    secondsToClose !== undefined &&
    secondsToClose >= 20 &&
    secondsToClose <= 210 &&
    features.spread !== undefined &&
    features.spread <= 0.05 &&
    features.liquidity !== undefined &&
    features.liquidity >= 100
  );
}

function parseFeatures(value: string | null): Features {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Features;
  } catch {
    return {};
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
