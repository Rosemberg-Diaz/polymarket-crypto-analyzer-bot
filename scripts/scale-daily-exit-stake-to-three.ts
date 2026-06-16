import { prisma } from "../src/database/client";
import { DAILY_EXIT_STRATEGY_VERSION } from "../src/modules/simulations/daily-exit-observation.service";

const SOURCE_STAKE_MIN = 0.99;
const SOURCE_STAKE_MAX = 1.01;
const SCALE = 3;

async function main(): Promise<void> {
  const before = await prisma.dailyExitCycle.aggregate({
    where: {
      strategyVersion: DAILY_EXIT_STRATEGY_VERSION,
      stake: {
        gte: SOURCE_STAKE_MIN,
        lte: SOURCE_STAKE_MAX
      }
    },
    _count: true,
    _sum: {
      stake: true,
      profit: true
    }
  });

  if (before._count === 0) {
    console.log("No daily $1 cycles require scaling.");
    return;
  }

  const updated = await prisma.$executeRaw`
    UPDATE "DailyExitCycle"
    SET
      "stake" = "stake" * ${SCALE},
      "shares" = "shares" * ${SCALE},
      "buyFee" = "buyFee" * ${SCALE},
      "entryCost" = "entryCost" * ${SCALE},
      "sellFee" = CASE
        WHEN "sellFee" IS NULL THEN NULL
        ELSE "sellFee" * ${SCALE}
      END,
      "finalValue" = CASE
        WHEN "finalValue" IS NULL THEN NULL
        ELSE "finalValue" * ${SCALE}
      END,
      "profit" = CASE
        WHEN "profit" IS NULL THEN NULL
        ELSE "profit" * ${SCALE}
      END
    WHERE
      "strategyVersion" = ${DAILY_EXIT_STRATEGY_VERSION}
      AND "stake" >= ${SOURCE_STAKE_MIN}
      AND "stake" <= ${SOURCE_STAKE_MAX}
  `;

  const after = await prisma.dailyExitCycle.aggregate({
    where: {
      strategyVersion: DAILY_EXIT_STRATEGY_VERSION
    },
    _count: true,
    _sum: {
      stake: true,
      profit: true
    }
  });

  console.log(`Scaled ${updated} daily cycles from $1 to $3.`);
  console.log(
    `Previous profit represented at $1: $${Number(before._sum.profit ?? 0).toFixed(6)}`
  );
  console.log(
    `Current total daily profit represented at $3: $${Number(after._sum.profit ?? 0).toFixed(6)}`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
