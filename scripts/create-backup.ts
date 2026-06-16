import { connectDatabase, disconnectDatabase } from "../src/database/client";
import { BackupService } from "../src/modules/backup/backup.service";
import { LoggerService } from "../src/modules/logger/logger.service";

async function main(): Promise<void> {
  await connectDatabase();
  const backupPath = await new BackupService(
    new LoggerService("info")
  ).createBackup();
  if (!backupPath) {
    throw new Error("Database backup failed.");
  }
  console.log(backupPath);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
