import fs from "node:fs/promises";
import path from "node:path";
import { DIRECTORIES } from "../../config/constants";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";

export class BackupService {
  constructor(private readonly logger: LoggerService) {}

  getStatus(): string {
    if (!config.backupEnabled) {
      return "disabled";
    }

    return "enabled with one rotating safety backup";
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
      await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
      await fs.mkdir(DIRECTORIES.backups, { recursive: true });
      const backupPath = path.join(DIRECTORIES.backups, `dev-${this.formatTimestamp(new Date())}.db`);
      await fs.copyFile(sourcePath, backupPath);
      await this.keepOnlyBackup(backupPath);
      this.logger.info("Database backup created.", { sourcePath, backupPath });
      return backupPath;
    } catch (error) {
      this.logger.error("Database backup failed.", error, { sourcePath });
      return null;
    }
  }

  async ensureRecentBackup(): Promise<boolean> {
    if (await this.hasAnyBackup()) {
      this.logger.info("Existing safety backup found; automatic backup creation skipped.");
      return true;
    }

    return (await this.createBackup()) !== null;
  }

  async hasAnyBackup(): Promise<boolean> {
    try {
      await fs.mkdir(DIRECTORIES.backups, { recursive: true });
      const entries = await fs.readdir(DIRECTORIES.backups, { withFileTypes: true });
      return entries.some((entry) => entry.isFile() && entry.name.endsWith(".db"));
    } catch (error) {
      this.logger.error("Could not inspect database backups.", error);
    }

    return false;
  }

  async cleanOldBackups(): Promise<number> {
    try {
      await fs.mkdir(DIRECTORIES.backups, { recursive: true });
      const entries = await fs.readdir(DIRECTORIES.backups, { withFileTypes: true });
      const backups: Array<{
        filePath: string;
        mtimeMs: number;
      }> = [];

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".db")) {
          continue;
        }

        const filePath = path.join(DIRECTORIES.backups, entry.name);
        const stat = await fs.stat(filePath);
        backups.push({ filePath, mtimeMs: stat.mtimeMs });
      }

      backups.sort((left, right) => right.mtimeMs - left.mtimeMs);
      const latest = backups[0];
      if (!latest) {
        return 0;
      }

      const deleted = await this.keepOnlyBackup(latest.filePath);
      this.logger.info("Backup rotation completed.", {
        policy: "KEEP_LATEST_ONLY",
        retainedBackup: latest.filePath,
        deleted
      });
      return deleted;
    } catch (error) {
      this.logger.error("Old backup cleanup failed.", error);
    }

    return 0;
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

  private async keepOnlyBackup(backupToKeep: string): Promise<number> {
    const intendedDirectory = path.resolve(DIRECTORIES.backups);
    const resolvedBackupToKeep = path.resolve(backupToKeep);
    if (path.dirname(resolvedBackupToKeep) !== intendedDirectory) {
      throw new Error("Refusing to rotate backups outside the backups directory.");
    }

    const entries = await fs.readdir(intendedDirectory, { withFileTypes: true });
    let deleted = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".db")) {
        continue;
      }

      const candidate = path.resolve(intendedDirectory, entry.name);
      if (
        path.dirname(candidate) !== intendedDirectory ||
        candidate === resolvedBackupToKeep
      ) {
        continue;
      }

      await fs.unlink(candidate);
      deleted += 1;
    }

    return deleted;
  }
}
