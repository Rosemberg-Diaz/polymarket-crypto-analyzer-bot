import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { BackupService } from "../backup/backup.service";
import { LoggerService } from "../logger/logger.service";

const ORPHAN_SNAPSHOT_RETENTION_DAYS = 3;
const BOT_RUN_LOG_RETENTION_DAYS = 14;

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

    await this.cleanDatabase();

    this.logger.info("Daily maintenance finished.");
  }

  private async cleanDatabase(): Promise<void> {
    const orphanSnapshotCutoff = new Date(Date.now() - ORPHAN_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const logCutoff = new Date(Date.now() - BOT_RUN_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    try {
      const [deletedSnapshots, deletedLogs] = await Promise.all([
        prisma.marketSnapshot.deleteMany({
          where: {
            createdAt: {
              lt: orphanSnapshotCutoff
            },
            predictions: {
              none: {}
            }
          }
        }),
        prisma.botRunLog.deleteMany({
          where: {
            createdAt: {
              lt: logCutoff
            }
          }
        })
      ]);

      this.logger.info("Database maintenance completed.", {
        orphanSnapshotRetentionDays: ORPHAN_SNAPSHOT_RETENTION_DAYS,
        deletedOrphanSnapshots: deletedSnapshots.count,
        botRunLogRetentionDays: BOT_RUN_LOG_RETENTION_DAYS,
        deletedBotRunLogs: deletedLogs.count
      });
    } catch (error) {
      this.logger.error("Database maintenance failed.", error);
    }
  }
}
