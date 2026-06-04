import {
  CryptoAsset,
  CryptoMarketType,
  SUPPORTED_CRYPTO_ASSETS
} from "../../config/assets";
import {
  CryptoTimeframe,
  NormalizedOutcomeName,
  SupportedInitialMarketInput
} from "./crypto-market.types";

const assetAliases: Record<Exclude<CryptoAsset, "OTHER">, string[]> = {
  BTC: ["BTC", "BITCOIN", "XBT"],
  ETH: ["ETH", "ETHEREUM", "ETHER"],
  SOL: ["SOL", "SOLANA"],
  XRP: ["XRP", "RIPPLE"],
  DOGE: ["DOGE", "DOGECOIN"],
  AVAX: ["AVAX", "AVALANCHE"],
  BNB: ["BNB", "BINANCE COIN", "BINANCE"]
};

const cryptoKeywords = [
  "CRYPTO",
  "CRYPTOCURRENCY",
  "BLOCKCHAIN",
  "BITCOIN",
  "ETHEREUM",
  "SOLANA",
  "RIPPLE",
  "DOGECOIN",
  "AVALANCHE",
  "BINANCE",
  "OPENSEA",
  "HYPERLIQUID",
  "MEGAETH",
  "KRAKEN",
  "AIR DROP",
  "AIRDROP",
  "TOKEN",
  "TOKENOMICS",
  "FDV",
  "DEFI",
  "NFT",
  "STABLECOIN",
  "USDC",
  "USDT",
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "AVAX",
  "BNB"
];

const excludedNonCryptoKeywords = [
  "NFL",
  "NBA",
  "MLB",
  "NHL",
  "SOCCER",
  "FOOTBALL",
  "TENNIS",
  "UFC",
  "ELECTION",
  "PRESIDENT",
  "SENATE",
  "CONGRESS",
  "DEMOCRAT",
  "REPUBLICAN",
  "TRUMP",
  "BIDEN",
  "POLITICS",
  "WORLD CUP",
  "FIFA",
  "STANLEY CUP",
  "FINALS"
];

export function inferAssetSymbol(
  question?: string | null,
  slug?: string | null,
  description?: string | null
): CryptoAsset {
  const text = normalizeSearchText(question, slug, description);

  for (const asset of SUPPORTED_CRYPTO_ASSETS) {
    if (asset === "OTHER") {
      continue;
    }

    const aliases = assetAliases[asset];
    if (aliases.some((alias) => containsToken(text, alias))) {
      return asset;
    }
  }

  return "OTHER";
}

export function inferCryptoMarketType(
  question?: string | null,
  slug?: string | null,
  description?: string | null
): CryptoMarketType {
  const text = normalizeSearchText(question, slug, description);

  if (/\bUP\b/.test(text) && /\bDOWN\b/.test(text)) {
    return "UP_DOWN_SHORT_TERM";
  }

  if (/\b(ABOVE|BELOW|OVER|UNDER)\b/.test(text)) {
    return "ABOVE_BELOW";
  }

  if (/\b(BETWEEN|RANGE|INSIDE|OUTSIDE)\b/.test(text)) {
    return "RANGE_MARKET";
  }

  if (/\$\s?\d|PRICE\s?(TARGET|OF)|HIT\s?\$|REACH\s?\$|TO\s?\$/.test(text)) {
    return "PRICE_TARGET";
  }

  return "CRYPTO_OTHER";
}

export function inferTimeframe(
  question?: string | null,
  slug?: string | null,
  description?: string | null
): CryptoTimeframe {
  const text = normalizeSearchText(question, slug, description);

  if (/\b(5\s?M|5\s?MIN|5\s?MINUTE|5\s?MINUTES|FIVE\s?MINUTE)\b/.test(text)) {
    return "5m";
  }

  if (/\b(15\s?M|15\s?MIN|15\s?MINUTE|15\s?MINUTES|FIFTEEN\s?MINUTE)\b/.test(text)) {
    return "15m";
  }

  if (/\b(1\s?H|1\s?HR|1\s?HOUR|ONE\s?HOUR|HOURLY)\b/.test(text)) {
    return "1h";
  }

  if (/\b(1\s?D|1\s?DAY|ONE\s?DAY|DAILY|TODAY|24\s?H|24\s?HOUR|ONE\s?DAY\s?AFTER|1\s?DAY\s?AFTER)\b/.test(text)) {
    return "1d";
  }

  return "unknown";
}

export function isCryptoMarket(
  question?: string | null,
  slug?: string | null,
  description?: string | null,
  tags?: string[] | null
): boolean {
  const tagText = tags?.join(" ") ?? "";
  const text = normalizeSearchText(question, slug, description, tagText);

  if (excludedNonCryptoKeywords.some((keyword) => containsToken(text, keyword))) {
    return false;
  }

  return cryptoKeywords.some((keyword) => containsToken(text, keyword));
}

export function looksLikeExcludedNonCryptoMarket(
  question?: string | null,
  slug?: string | null,
  description?: string | null,
  tags?: string[] | null
): boolean {
  const tagText = tags?.join(" ") ?? "";
  const text = normalizeSearchText(question, slug, description, tagText);

  return excludedNonCryptoKeywords.some((keyword) => containsToken(text, keyword));
}

export function extractTargetPrice(
  question?: string | null,
  description?: string | null,
  rawData?: unknown
): number | null {
  const rawText = typeof rawData === "string" ? rawData : safeStringify(rawData);
  const text = [question, description, rawText].filter(Boolean).join(" ");
  const patterns = [
    /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)(\s?[KMB])?/i,
    /\b(?:ABOVE|BELOW|OVER|UNDER|REACH|HIT|TARGET|PRICE)\s+([0-9][0-9,]*(?:\.[0-9]+)?)(\s?[KMB])?\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const value = parsePrice(match[1], match[2]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

export function normalizeOutcomeName(outcome: string): NormalizedOutcomeName {
  const normalized = outcome.trim().toUpperCase();

  if (["UP", "ABOVE", "OVER"].includes(normalized)) {
    return "UP";
  }

  if (["DOWN", "BELOW", "UNDER"].includes(normalized)) {
    return "DOWN";
  }

  if (normalized === "YES") {
    return "YES";
  }

  if (normalized === "NO") {
    return "NO";
  }

  return "OTHER";
}

export function isSupportedInitialMarket(market: SupportedInitialMarketInput): boolean {
  return (
    ["BTC", "ETH", "SOL"].includes(market.assetSymbol) &&
    market.marketType === "UP_DOWN_SHORT_TERM" &&
    ["5m", "15m", "1h"].includes(market.timeframe)
  );
}

function normalizeSearchText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .replace(/[-_/]+/g, " ")
    .toUpperCase();
}

function containsToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(text);
}

function parsePrice(value: string | undefined, suffix: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalizedSuffix = suffix?.trim().toUpperCase();
  const multiplier =
    normalizedSuffix === "K"
      ? 1_000
      : normalizedSuffix === "M"
        ? 1_000_000
        : normalizedSuffix === "B"
          ? 1_000_000_000
          : 1;

  return parsed * multiplier;
}

function safeStringify(value: unknown, maxLength = 20_000): string {
  if (value === undefined || value === null) {
    return "";
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= maxLength ? serialized : serialized.slice(0, maxLength);
  } catch {
    return "";
  }
}
