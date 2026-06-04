import { Chip } from "@mui/material";

interface StatusChipProps {
  value: string | boolean | null;
}

export function StatusChip({ value }: StatusChipProps) {
  const label = value === null ? "N/A" : String(value);
  const normalized = label.toLowerCase();
  const color =
    normalized === "error" || normalized === "true" || normalized === "loss" || normalized === "resolved"
      ? "warning"
      : normalized === "ok" || normalized === "false" || normalized === "win"
        ? "success"
        : normalized === "pending"
          ? "info"
          : "default";

  return <Chip size="small" label={label} color={color} variant="outlined" />;
}
