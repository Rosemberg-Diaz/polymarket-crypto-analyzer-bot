import { IncomingMessage, ServerResponse } from "node:http";
import { Prisma } from "@prisma/client";

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(toJsonSafe(payload)));
}

export function sendOptions(res: ServerResponse): void {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end();
}

export function parseRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

export function getStringParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value === null || value.trim() === "" ? undefined : value.trim();
}

export function getBooleanParam(url: URL, key: string): boolean | undefined {
  const value = getStringParam(url, key);
  if (value === undefined) return undefined;

  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

export function getNumberParam(url: URL, key: string, fallback: number, max = 500): number {
  const value = Number(getStringParam(url, key));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

export function getDateParam(url: URL, key: string): Date | undefined {
  const value = getStringParam(url, key);
  if (!value) return undefined;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toJsonSafe(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Prisma.Decimal) {
    return Number(value);
  }

  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonSafe(entry)])
    );
  }

  return value;
}
