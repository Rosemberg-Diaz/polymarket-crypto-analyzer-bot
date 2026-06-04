export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
}

export function formatBytes(value: number | null | undefined): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}
