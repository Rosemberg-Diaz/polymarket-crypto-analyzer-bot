import { connectDatabase, disconnectDatabase } from "../../database/client";
import { DailyReportService } from "./daily-report.service";
import { PerformanceReportService } from "./performance-report.service";

async function main(): Promise<void> {
  await connectDatabase();

  const dailyReport = await new DailyReportService().generate();
  const performanceReport = await new PerformanceReportService().generate();

  console.log(dailyReport);
  console.log("");
  console.log(performanceReport);
}

main()
  .catch((error: unknown) => {
    console.error("Failed to generate report.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
