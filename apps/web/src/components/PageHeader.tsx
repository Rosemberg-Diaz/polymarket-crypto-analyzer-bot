import { Button, Stack, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
}

export function PageHeader({ title, subtitle, onRefresh }: PageHeaderProps) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2} alignItems={{ sm: "center" }}>
      <Stack spacing={0.5}>
        <Typography variant="h4" fontWeight={800}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography color="text.secondary">
            {subtitle}
          </Typography>
        ) : null}
      </Stack>
      {onRefresh ? (
        <Button startIcon={<RefreshIcon />} variant="outlined" onClick={onRefresh}>
          Refrescar
        </Button>
      ) : null}
    </Stack>
  );
}
