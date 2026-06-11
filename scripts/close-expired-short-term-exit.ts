import { prisma } from "../src/database/client";
import { LoggerService } from "../src/modules/logger/logger.service";
import { ShortTermExitObservationService } from "../src/modules/simulations/short-term-exit-observation.service";

async function main(): Promise<void> {
  const service = new ShortTermExitObservationService(new LoggerService("info"));
  const processed = await service.closeExpiredObservations();
  const statuses = await prisma.shortTermExitObservation.groupBy({
    by: ["status"],
    _count: {
      _all: true
    }
  });

  console.log({
    processed,
    statuses: Object.fromEntries(statuses.map((row) => [row.status, row._count._all]))
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
