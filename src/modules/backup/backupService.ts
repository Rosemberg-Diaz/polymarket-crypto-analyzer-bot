import { config } from "../../config/env";

export class BackupService {
  getStatus(): string {
    if (!config.backupEnabled) {
      return "disabled";
    }

    return `enabled every ${config.backupIntervalHours} hours`;
  }
}
