import fs from "node:fs/promises";
import path from "node:path";
import { DIRECTORIES } from "../../config/constants";
import { LogLevel } from "../../config/env";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export type LogContext = Record<string, unknown> | unknown;

export class LoggerService {
  constructor(private readonly level: LogLevel = "info") {}

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }

  error(message: string, errorOrContext?: LogContext, context?: LogContext): void {
    const errorContext =
      errorOrContext instanceof Error
        ? { ...this.serializeContext(context), error: errorOrContext.message, stack: errorOrContext.stack }
        : errorOrContext;

    this.write("error", message, errorContext);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (levels[level] < levels[this.level]) {
      return;
    }

    const timestamp = new Date();
    const line = this.formatLine(timestamp, level, message, context);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }

    void this.writeToDailyFile(timestamp, line);
  }

  private formatLine(timestamp: Date, level: LogLevel, message: string, context?: LogContext): string {
    const contextText = context === undefined ? "" : ` ${this.safeStringify(context)}`;
    return `[${timestamp.toISOString()}] [${level.toUpperCase()}] ${message}${contextText}`;
  }

  private async writeToDailyFile(timestamp: Date, line: string): Promise<void> {
    try {
      await fs.mkdir(DIRECTORIES.logs, { recursive: true });
      const fileName = `${timestamp.toISOString().slice(0, 10)}.log`;
      await fs.appendFile(path.join(DIRECTORIES.logs, fileName), `${line}\n`, "utf8");
    } catch {
      // Logging must never stop the bot.
    }
  }

  private serializeContext(context?: LogContext): Record<string, unknown> {
    if (context && typeof context === "object" && !Array.isArray(context)) {
      return context as Record<string, unknown>;
    }

    return context === undefined ? {} : { context };
  }

  private safeStringify(value: LogContext): string {
    try {
      return JSON.stringify(value);
    } catch {
      return JSON.stringify({ context: "[unserializable]" });
    }
  }
}
