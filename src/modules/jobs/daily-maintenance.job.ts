import { config } from "../../config/env";
import { BackupService } from "../backup/backup.service";
import { LoggerService } from "../logger/logger.service";

export class DailyMaintenanceJob {
  constructor(
    private readonly backupService: BackupService,
    private readonly logger: LoggerService
  ) {}

  async runManual(): Promise<void> {
    this.logger.info("Daily maintenance started.");

    if (config.backupEnabled) {
      await this.backupService.createBackup();
      await this.backupService.cleanOldBackups();
    } else {
      this.logger.info("Daily backup skipped because BACKUP_ENABLED=false.");
    }

    this.logger.info("Daily maintenance finished.");
  }
}
