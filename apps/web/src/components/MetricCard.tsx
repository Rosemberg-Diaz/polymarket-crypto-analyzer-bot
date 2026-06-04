import { Card, CardContent, Stack, Typography } from "@mui/material";
import { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  helper?: string;
}

export function MetricCard({ label, value, helper }: MetricCardProps) {
  return (
    <Card variant="outlined" sx={{ height: "100%", borderRadius: 2 }}>
      <CardContent>
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h5" fontWeight={700} component="div">
            {value}
          </Typography>
          {helper ? (
            <Typography variant="body2" color="text.secondary">
              {helper}
            </Typography>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
