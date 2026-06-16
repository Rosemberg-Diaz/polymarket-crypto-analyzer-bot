import { prisma } from "../src/database/client";
import { LoggerService } from "../src/modules/logger/logger.service";
import { ShortTermExitObservationService } from "../src/modules/simulations/short-term-exit-observation.service";

async function main(): Promise<void> {
  const service = new ShortTermExitObservationService(new LoggerService("info"));
  const observations = await service.backfillExitScenarios();
  const scenarios = await prisma.shortTermExitScenario.groupBy({
    by: ["thresholdSeconds", "status"],
    _count: { _all: true },
    orderBy: { thresholdSeconds: "desc" }
  });

  console.log({
    observations,
    scenarios: scenarios.map((row) => ({
      thresholdSeconds: row.thresholdSeconds,
      status: row.status,
      count: row._count._all
    }))
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
