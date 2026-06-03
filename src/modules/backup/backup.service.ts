import fs from "node:fs/promises";
import path from "node:path";
import { BACKUP_RETENTION_DAYS, DIRECTORIES } from "../../config/constants";
import { config } from "../../config/env";
import { LoggerService } from "../logger/logger.service";

export class BackupService {
  constructor(private readonly logger: LoggerService) {}

  getStatus(): string {
    if (!config.backupEnabled) {
      return "disabled";
    }

    return `enabled every ${config.backupIntervalHours} hours`;
  }

  async createBackup(): Promise<string | null> {
    const sourcePath = this.resolveDatabasePath();

    try {
      await fs.access(sourcePath);
    } catch {
      this.logger.warn("Database file not found. Backup skipped.", { sourcePath });
      return null;
    }

    try {
      await fs.mkdir(DIRECTORIES.backups, { recursive: true });
      const backupPath = path.join(DIRECTORIES.backups, `dev-${this.formatTimestamp(new Date())}.db`);
      await fs.copyFile(sourcePath, backupPath);
      this.logger.info("Database backup created.", { sourcePath, backupPath });
      return backupPath;
    } catch (error) {
      this.logger.error("Database backup failed.", error, { sourcePath });
      return null;
    }
  }

  async cleanOldBackups(retentionDays = BACKUP_RETENTION_DAYS): Promise<number> {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    try {
      await fs.mkdir(DIRECTORIES.backups, { recursive: true });
      const entries = await fs.readdir(DIRECTORIES.backups, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".db")) {
          continue;
        }

        const filePath = path.join(DIRECTORIES.backups, entry.name);
        const stat = await fs.stat(filePath);

        if (stat.mtimeMs < cutoffMs) {
          await fs.unlink(filePath);
          deleted += 1;
        }
      }

      this.logger.info("Old backup cleanup completed.", { retentionDays, deleted });
    } catch (error) {
      this.logger.error("Old backup cleanup failed.", error);
    }

    return deleted;
  }

  private resolveDatabasePath(): string {
    if (config.databaseUrl.startsWith("file:")) {
      const databasePath = config.databaseUrl.replace(/^file:/, "");
      return path.isAbsolute(databasePath)
        ? databasePath
        : path.resolve(DIRECTORIES.prisma, databasePath);
    }

    return path.resolve(DIRECTORIES.prisma, "dev.db");
  }

  private formatTimestamp(date: Date): string {
    const parts = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      "-",
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0")
    ];

    return parts.join("");
  }
}
