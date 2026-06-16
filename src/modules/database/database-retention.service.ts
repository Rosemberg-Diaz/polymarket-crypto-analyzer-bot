import fs from "node:fs/promises";
import path from "node:path";
import { DIRECTORIES } from "../../config/constants";
import { config } from "../../config/env";
import { prisma } from "../../database/client";
import { LoggerService } from "../logger/logger.service";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DatabaseRetentionResult {
  databaseBytesBefore: number;
  databaseBytesAfter: number;
  compactedSnapshots: number;
  thinnedSnapshots: number;
  deletedExpiredSnapshots: number;
  compactedMarkets: number;
  deletedWarnLogs: number;
  deletedErrorLogs: number;
  reusableBytes: number;
}

export interface RetentionCutoffs {
  compactSnapshotRawBefore: Date;
  thinSnapshotsBefore: Date;
  deleteSnapshotsBefore: Date;
  compactMarketRawBefore: Date;
  deleteWarnLogsBefore: Date;
  deleteErrorLogsBefore: Date;
}

export function buildRetentionCutoffs(now = new Date()): RetentionCutoffs {
  return {
    compactSnapshotRawBefore: daysBefore(now, config.snapshotRawRetentionDays),
    thinSnapshotsBefore: daysBefore(now, config.snapshotFullRetentionDays),
    deleteSnapshotsBefore: daysBefore(now, config.snapshotStructuredRetentionDays),
    compactMarketRawBefore: daysBefore(now, config.marketRawRetentionDays),
    deleteWarnLogsBefore: daysBefore(now, config.warnLogRetentionDays),
    deleteErrorLogsBefore: daysBefore(now, config.errorLogRetentionDays)
  };
}

export class DatabaseRetentionService {
  constructor(private readonly logger: LoggerService) {}

  async run(): Promise<DatabaseRetentionResult> {
    const databasePath = this.resolveDatabasePath();
    const databaseBytesBefore = await fileSize(databasePath);
    const cutoffs = buildRetentionCutoffs();

    const compactedSnapshots = await prisma.marketSnapshot.updateMany({
      where: {
        createdAt: { lt: cutoffs.compactSnapshotRawBefore },
        predictions: { none: {} },
        OR: [
          { rawOrderbook: { not: null } },
          { rawData: { not: null } }
        ]
      },
      data: {
        rawOrderbook: null,
        rawData: null
      }
    });

    const thinnedSnapshots = await prisma.$executeRaw`
      DELETE FROM "MarketSnapshot"
      WHERE "id" IN (
        SELECT "id"
        FROM (
          SELECT
            s."id",
            ROW_NUMBER() OVER (
              PARTITION BY s."marketId", CAST(s."createdAt" / 60000 AS INTEGER)
              ORDER BY s."createdAt" ASC
            ) AS row_number
          FROM "MarketSnapshot" s
          WHERE s."createdAt" < ${cutoffs.thinSnapshotsBefore}
            AND NOT EXISTS (
              SELECT 1
              FROM "BotPrediction" p
              WHERE p."snapshotId" = s."id"
            )
        )
        WHERE row_number > 1
      )
    `;

    const deletedExpiredSnapshots = await prisma.marketSnapshot.deleteMany({
      where: {
        createdAt: { lt: cutoffs.deleteSnapshotsBefore },
        predictions: { none: {} }
      }
    });

    const compactedMarkets = await prisma.market.updateMany({
      where: {
        closed: true,
        updatedAt: { lt: cutoffs.compactMarketRawBefore },
        rawData: { not: null }
      },
      data: { rawData: null }
    });

    const [deletedWarnLogs, deletedErrorLogs] = await Promise.all([
      prisma.botRunLog.deleteMany({
        where: {
          level: { not: "error" },
          createdAt: { lt: cutoffs.deleteWarnLogsBefore }
        }
      }),
      prisma.botRunLog.deleteMany({
        where: {
          level: "error",
          createdAt: { lt: cutoffs.deleteErrorLogsBefore }
        }
      })
    ]);

    await prisma.$executeRawUnsafe("PRAGMA optimize");
    const reusableBytes = await this.getReusableBytes();
    const databaseBytesAfter = await fileSize(databasePath);
    const result: DatabaseRetentionResult = {
      databaseBytesBefore,
      databaseBytesAfter,
      compactedSnapshots: compactedSnapshots.count,
      thinnedSnapshots,
      deletedExpiredSnapshots: deletedExpiredSnapshots.count,
      compactedMarkets: compactedMarkets.count,
      deletedWarnLogs: deletedWarnLogs.count,
      deletedErrorLogs: deletedErrorLogs.count,
      reusableBytes
    };

    this.logger.info("Database retention completed.", {
      ...result,
      policy: {
        snapshotRawRetentionDays: config.snapshotRawRetentionDays,
        snapshotFullRetentionDays: config.snapshotFullRetentionDays,
        snapshotStructuredRetentionDays: config.snapshotStructuredRetentionDays,
        marketRawRetentionDays: config.marketRawRetentionDays,
        warnLogRetentionDays: config.warnLogRetentionDays,
        errorLogRetentionDays: config.errorLogRetentionDays
      },
      note:
        "SQLite reuses freed pages. Run the manual vacuum command while the bot is stopped to shrink the file."
    });

    return result;
  }

  async vacuum(): Promise<void> {
    this.logger.info("SQLite VACUUM started. The bot should remain stopped.");
    await prisma.$executeRawUnsafe("VACUUM");
    this.logger.info("SQLite VACUUM finished.");
  }

  private async getReusableBytes(): Promise<number> {
    const [freeList, pageSize] = await Promise.all([
      prisma.$queryRaw<Array<{ freelist_count: bigint }>>`
        PRAGMA freelist_count
      `,
      prisma.$queryRaw<Array<{ page_size: bigint }>>`
        PRAGMA page_size
      `
    ]);

    return Number(freeList[0]?.freelist_count ?? 0) *
      Number(pageSize[0]?.page_size ?? 0);
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
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return 0;
  }
}
