import { config } from "../src/config/env";
import { connectDatabase, disconnectDatabase } from "../src/database/client";
import { BackupService } from "../src/modules/backup/backup.service";
import { DatabaseRetentionService } from "../src/modules/database/database-retention.service";
import { LoggerService } from "../src/modules/logger/logger.service";

async function main(): Promise<void> {
  const logger = new LoggerService(config.logLevel);
  const backupService = new BackupService(logger);
  const retentionService = new DatabaseRetentionService(logger);
  const vacuum = process.argv.includes("--vacuum");

  await connectDatabase();
  const backupPath = await backupService.createBackup();
  if (!backupPath) {
    throw new Error("Database cleanup cancelled because the safety backup failed.");
  }

  const result = await retentionService.run();
  if (vacuum) {
    await retentionService.vacuum();
  }

  console.log(JSON.stringify({ backupPath, vacuum, result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
