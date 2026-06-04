import fs from "node:fs/promises";
import path from "node:path";
import { DIRECTORIES } from "../../../config/constants";
import { ApiRoute } from "../api.types";
import { getNumberParam, getStringParam } from "../api.utils";

interface ParsedLogLine {
  timestamp: string | null;
  level: string;
  message: string;
  raw: string;
}

export const logsRoutes: ApiRoute[] = [
  {
    method: "GET",
    path: "/api/logs",
    handler: async ({ url }) => {
      const level = getStringParam(url, "level")?.toLowerCase();
      const limit = getNumberParam(url, "limit", 200, 1000);
      const lines = await readRecentLogLines();
      const logs = lines
        .map(parseLogLine)
        .filter((log) => !level || log.level.toLowerCase() === level)
        .slice(-limit)
        .reverse();

      return { logs };
    }
  }
];

async function readRecentLogLines(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DIRECTORIES.logs, { withFileTypes: true });
    const logFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
      .map((entry) => entry.name)
      .sort()
      .slice(-5);

    const contents = await Promise.all(
      logFiles.map((fileName) => fs.readFile(path.join(DIRECTORIES.logs, fileName), "utf8"))
    );

    return contents
      .flatMap((content) => content.split(/\r?\n/))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseLogLine(raw: string): ParsedLogLine {
  const match = raw.match(/^\[(.+?)] \[(\w+)] (.*)$/);
  if (!match) {
    return {
      timestamp: null,
      level: "unknown",
      message: raw,
      raw
    };
  }

  return {
    timestamp: match[1],
    level: match[2].toLowerCase(),
    message: match[3],
    raw
  };
}
