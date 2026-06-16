import { config } from "../../config/env";
import { BackupService } from "../backup/backup.service";
import { DatabaseRetentionService } from "../database/database-retention.service";
import { LoggerService } from "../logger/logger.service";

export class DailyMaintenanceJob {
  private readonly retentionService: DatabaseRetentionService;

  constructor(
    private readonly backupService: BackupService,
    private readonly logger: LoggerService
  ) {
    this.retentionService = new DatabaseRetentionService(logger);
  }

  async runManual(): Promise<void> {
    this.logger.info("Daily maintenance started.");

    if (config.backupEnabled) {
      const backupReady = await this.backupService.ensureRecentBackup();
      if (!backupReady) {
        this.logger.error("Database retention skipped because no recent backup is available.");
        return;
      }
      await this.backupService.cleanOldBackups();
    } else {
      this.logger.warn("Database retention skipped because BACKUP_ENABLED=false.");
      return;
    }

    try {
      await this.retentionService.run();
    } catch (error) {
      this.logger.error("Database retention failed.", error);
    }

    this.logger.info("Daily maintenance finished.");
  }
}
