import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRUSTED_TARGET_SOURCES = new Set([
  "POLYMARKET_CRYPTO_PRICE_API",
  "POLYMARKET_RTDS_CHAINLINK",
  "POLYMARKET_UMA_ANCILLARY"
]);
const TRUSTED_OUTCOME_SOURCES = new Set([
  "POLYMARKET_EXPLICIT",
  "GAMMA_OUTCOME_PRICES",
  "CLOB_FINAL_PRICE",
  "POLYMARKET_RTDS_CHAINLINK_CLOSE"
]);

interface Features {
  baseEntryRule?: string;
  finalEntryRule?: string;
  entryRule?: string;
  targetPriceTrustedForLearning?: boolean;
  targetPriceSource?: string;
  distanceToTargetPercent?: number;
  secondsToClose?: number;
  spread?: number;
  liquidity?: number;
  similarCases?: number;
  historicalWinRate?: number;
  historicalProfit?: number;
}

interface EvidenceRow {
  predictionId: string;
  createdAt: Date;
  day: string;
  source: "TRADE" | "OBSERVATION";
  asset: string;
  outcome: string;
  rule: string;
  entryPrice: number;
  edge: number;
  secondsToClose: number | null;
  similarCases: number | null;
  historicalWinRate: number | null;
  historicalProfit: number | null;
  isWin: boolean;
  stake: number;
  recordedProfit: number;
  profitAtOneDollar: number;
  trusted: boolean;
}

interface GateScenario {
  name: string;
  minSimilarCases: number;
  minWinRate: number;
  requirePositiveHistoricalProfit: boolean;
  includeModerate: boolean;
  includeStandard: boolean;
}

const SCENARIOS: GateScenario[] = [
  {
    name: "CURRENT_5_CASES_60_PERCENT",
    minSimilarCases: 5,
    minWinRate: 0.6,
    requirePositiveHistoricalProfit: true,
    includeModerate: true,
    includeStandard: true
  },
  {
    name: "RELAX_CASES_TO_4",
    minSimilarCases: 4,
    minWinRate: 0.6,
    requirePositiveHistoricalProfit: true,
    includeModerate: true,
    includeStandard: true
  },
  {
    name: "RELAX_CASES_TO_3",
    minSimilarCases: 3,
    minWinRate: 0.6,
    requirePositiveHistoricalProfit: true,
    includeModerate: true,
    includeStandard: true
  },
  {
    name: "RELAX_WIN_RATE_TO_55",
    minSimilarCases: 5,
    minWinRate: 0.55,
    requirePositiveHistoricalProfit: true,
    includeModerate: true,
    includeStandard: true
  },
  {
    name: "RELAX_CASES_4_AND_WIN_RATE_55",
    minSimilarCases: 4,
    minWinRate: 0.55,
    requirePositiveHistoricalProfit: true,
    includeModerate: true,
    includeStandard: true
  },
  {
    name: "STANDARD_ONLY_CASES_4_WIN_RATE_60",
    minSimilarCases: 4,
    minWinRate: 0.6,
    requirePositiveHistoricalProfit: true,
    includeModerate: false,
    includeStandard: true
  },
  {
    name: "MODERATE_ONLY_CASES_4_WIN_RATE_60",
    minSimilarCases: 4,
    minWinRate: 0.6,
    requirePositiveHistoricalProfit: true,
    includeModerate: true,
    includeStandard: false
  }
];

async function main(): Promise<void> {
  const [trades, observations, realOrders] = await Promise.all([
    prisma.simulatedTrade.findMany({
      where: {
        status: "RESOLVED",
        isWin: { not: null },
        roi: { not: null },
        resolvedAt: { not: null }
      },
      include: {
        prediction: true,
        market: { select: { resolutionSource: true } }
      }
    }),
    prisma.observationEvaluation.findMany({
      where: {
        status: "RESOLVED",
        wouldWin: { not: null },
        hypotheticalRoi: { not: null },
        resolvedAt: { not: null }
      },
      include: {
        prediction: true,
        market: { select: { resolutionSource: true } }
      }
    }),
    prisma.realOrder.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        status: true,
        externalOrderId: true,
        assetSymbol: true,
        entryRule: true,
        stake: true,
        errorMessage: true
      }
    })
  ]);

  const tradePredictionIds = new Set(trades.map((trade) => trade.predictionId));
  const evidence: EvidenceRow[] = [
    ...trades.map((trade) =>
      buildEvidenceRow({
        prediction: trade.prediction,
        marketResolutionSource: trade.market.resolutionSource,
        source: "TRADE",
        isWin: trade.isWin!,
        stake: Number(trade.stake),
        recordedProfit: Number(trade.profit),
        roi: Number(trade.roi),
        result: trade.result
      })
    ),
    ...observations
      .filter((observation) => !tradePredictionIds.has(observation.predictionId))
      .map((observation) =>
        buildEvidenceRow({
          prediction: observation.prediction,
          marketResolutionSource: observation.market.resolutionSource,
          source: "OBSERVATION",
          isWin: observation.wouldWin!,
          stake: Number(observation.hypotheticalStake),
          recordedProfit: Number(observation.hypotheticalProfit),
          roi: Number(observation.hypotheticalRoi),
          result: observation.result,
          resolutionSource: observation.resolutionSource
        })
      )
  ];

  const trusted = evidence.filter((row) => row.trusted);
  const directional = trusted.filter((row) => isStandardOrModerate(row.rule));
  const yesterdayStart = bogotaDayStartUtc("2026-06-10");
  const sinceYesterday = directional.filter((row) => row.createdAt >= yesterdayStart);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        definitions: {
          profit: "Normalized to $1 stake by summing ROI.",
          yesterday: "2026-06-10 00:00:00 America/Bogota",
          evidence:
            "Resolved SimulatedTrade plus resolved ObservationEvaluation when no trade exists for the prediction."
        },
        trustedTradeHistoryByDay: groupSummary(
          trusted.filter((row) => row.source === "TRADE"),
          (row) => row.day
        ),
        trustedStandardModerateByRule: groupSummary(directional, (row) => normalizeRule(row.rule)),
        trustedStandardModerateByDay: groupSummary(directional, (row) => row.day),
        realOrders: {
          total: realOrders.length,
          byStatus: countBy(realOrders, (row) => row.status),
          byDay: countBy(realOrders, (row) => bogotaDay(row.createdAt)),
          submitted: realOrders.filter((row) => row.status === "SUBMITTED"),
          failed: realOrders.filter((row) => row.status === "FAILED")
        },
        scenarioHistory: SCENARIOS.map((scenario) => ({
          scenario: scenario.name,
          ...summarize(directional.filter((row) => passesScenario(row, scenario)))
        })),
        scenarioSinceYesterday: SCENARIOS.map((scenario) => ({
          scenario: scenario.name,
          ...summarize(sinceYesterday.filter((row) => passesScenario(row, scenario)))
        })),
        incrementalVersusCurrentSinceYesterday: buildIncrementalComparison(sinceYesterday),
        currentGateCandidatesSinceYesterday: sinceYesterday
          .filter((row) => passesScenario(row, SCENARIOS[0]))
          .map(formatRow),
        relaxedToFourIncrementalCandidatesSinceYesterday: sinceYesterday
          .filter(
            (row) =>
              passesScenario(row, SCENARIOS[1]) &&
              !passesScenario(row, SCENARIOS[0])
          )
          .map(formatRow)
      },
      null,
      2
    )
  );
}

function buildEvidenceRow(params: {
  prediction: {
    id: string;
    createdAt: Date;
    assetSymbol: string;
    predictedOutcome: string;
    entryPrice: unknown;
    edge: unknown;
    features: string | null;
  };
  marketResolutionSource: string | null;
  source: "TRADE" | "OBSERVATION";
  isWin: boolean;
  stake: number;
  recordedProfit: number;
  roi: number;
  result: string | null;
  resolutionSource?: string | null;
}): EvidenceRow {
  const features = parseFeatures(params.prediction.features);
  const outcomeSource =
    params.resolutionSource ?? parseOutcomeSource(params.result) ?? "";

  return {
    predictionId: params.prediction.id,
    createdAt: params.prediction.createdAt,
    day: bogotaDay(params.prediction.createdAt),
    source: params.source,
    asset: params.prediction.assetSymbol,
    outcome: params.prediction.predictedOutcome,
    rule:
      features.baseEntryRule ??
      features.finalEntryRule ??
      features.entryRule ??
      "NONE",
    entryPrice: Number(params.prediction.entryPrice),
    edge: Number(params.prediction.edge ?? 0),
    secondsToClose: numberOrNull(features.secondsToClose),
    similarCases: numberOrNull(features.similarCases),
    historicalWinRate: numberOrNull(features.historicalWinRate),
    historicalProfit: numberOrNull(features.historicalProfit),
    isWin: params.isWin,
    stake: params.stake,
    recordedProfit: params.recordedProfit,
    profitAtOneDollar: params.roi,
    trusted:
      features.targetPriceTrustedForLearning === true &&
      TRUSTED_TARGET_SOURCES.has(features.targetPriceSource ?? "") &&
      typeof features.distanceToTargetPercent === "number" &&
      Math.abs(features.distanceToTargetPercent) <= 0.1 &&
      TRUSTED_OUTCOME_SOURCES.has(outcomeSource) &&
      params.marketResolutionSource !== "MOCK_LOCAL_SCANNER"
  };
}

function passesScenario(row: EvidenceRow, scenario: GateScenario): boolean {
  const rule = normalizeRule(row.rule);
  if (rule === "STANDARD" && !scenario.includeStandard) return false;
  if (rule === "MODERATE" && !scenario.includeModerate) return false;
  if (rule !== "STANDARD" && rule !== "MODERATE") return false;
  if (row.similarCases === null || row.similarCases < scenario.minSimilarCases) return false;
  if (row.historicalWinRate === null || row.historicalWinRate < scenario.minWinRate) return false;
  if (
    scenario.requirePositiveHistoricalProfit &&
    (row.historicalProfit === null || row.historicalProfit <= 0)
  ) {
    return false;
  }
  if (row.secondsToClose === null || row.secondsToClose < 20 || row.secondsToClose > 210) {
    return false;
  }
  if (row.entryPrice <= 0.05 || row.entryPrice >= 0.95) return false;
  if (row.outcome === "DOWN" && row.entryPrice < 0.6 && row.secondsToClose > 180) {
    return false;
  }
  if (
    row.outcome === "DOWN" &&
    row.secondsToClose >= 60 &&
    row.secondsToClose <= 119 &&
    row.entryPrice >= 0.75
  ) {
    return false;
  }
  if (rule === "MODERATE") {
    if (row.edge < 0.08) return false;
    if (row.secondsToClose > 180 && row.entryPrice < 0.65) return false;
    if (row.asset === "ETH" && row.entryPrice < 0.7) return false;
  }
  if (rule === "STANDARD" && row.edge < 0.03) return false;

  return true;
}

function buildIncrementalComparison(rows: EvidenceRow[]) {
  const current = rows.filter((row) => passesScenario(row, SCENARIOS[0]));

  return SCENARIOS.slice(1).map((scenario) => {
    const scenarioRows = rows.filter((row) => passesScenario(row, scenario));
    const currentIds = new Set(current.map((row) => row.predictionId));
    const incremental = scenarioRows.filter((row) => !currentIds.has(row.predictionId));
    return {
      scenario: scenario.name,
      total: summarize(scenarioRows),
      incremental: summarize(incremental)
    };
  });
}

function summarize(rows: EvidenceRow[]) {
  const wins = rows.filter((row) => row.isWin).length;
  return {
    cases: rows.length,
    trades: rows.filter((row) => row.source === "TRADE").length,
    observations: rows.filter((row) => row.source === "OBSERVATION").length,
    wins,
    losses: rows.length - wins,
    winRate: round6(rows.length === 0 ? 0 : wins / rows.length),
    totalStake: round6(rows.reduce((sum, row) => sum + row.stake, 0)),
    recordedProfit: round6(rows.reduce((sum, row) => sum + row.recordedProfit, 0)),
    profitAtOneDollarEach: round6(
      rows.reduce((sum, row) => sum + row.profitAtOneDollar, 0)
    ),
    averageRoi: round6(
      rows.length === 0
        ? 0
        : rows.reduce((sum, row) => sum + row.profitAtOneDollar, 0) / rows.length
    )
  };
}

function groupSummary(rows: EvidenceRow[], key: (row: EvidenceRow) => string) {
  const groups = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const value = key(row);
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }

  return Object.fromEntries(
    Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, items]) => [group, summarize(items)])
  );
}

function formatRow(row: EvidenceRow) {
  return {
    createdAt: row.createdAt.toISOString(),
    day: row.day,
    source: row.source,
    asset: row.asset,
    outcome: row.outcome,
    rule: row.rule,
    entryPrice: row.entryPrice,
    edge: row.edge,
    secondsToClose: row.secondsToClose,
    similarCases: row.similarCases,
    historicalWinRate: row.historicalWinRate,
    historicalProfit: row.historicalProfit,
    isWin: row.isWin,
    stake: row.stake,
    recordedProfit: round6(row.recordedProfit),
    profitAtOneDollar: round6(row.profitAtOneDollar)
  };
}

function parseFeatures(value: string | null): Features {
  if (!value) return {};
  try {
    return JSON.parse(value) as Features;
  } catch {
    return {};
  }
}

function parseOutcomeSource(result: string | null): string | null {
  if (!result) return null;
  const parts = result.split(":");
  return parts.length > 1 ? parts.at(-1) ?? null : null;
}

function isStandardOrModerate(rule: string): boolean {
  const normalized = normalizeRule(rule);
  return normalized === "STANDARD" || normalized === "MODERATE";
}

function normalizeRule(rule: string): "STANDARD" | "MODERATE" | "OTHER" {
  if (rule.includes("MODERATE_STANDARD")) return "MODERATE";
  if (rule.includes("SMALL_STANDARD")) return "STANDARD";
  return "OTHER";
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const value = key(row);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function bogotaDay(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function bogotaDayStartUtc(day: string): Date {
  return new Date(`${day}T05:00:00.000Z`);
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
