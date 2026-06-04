import { Grid, Stack } from "@mui/material";
import { useCallback } from "react";
import { DataState } from "../components/DataState";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { api } from "../services/api";
import { formatBytes, formatDate } from "../services/format";
import { useApiResource } from "../components/useApiResource";

export function HealthPage() {
  const loader = useCallback(() => api.health(), []);
  const { data, loading, error, refresh } = useApiResource(loader);

  return (
    <Stack spacing={3}>
      <PageHeader title="Health" subtitle="Estado interno del proceso local" onRefresh={refresh} />
      <DataState loading={loading} error={error} />
      {data ? (
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}><MetricCard label="DB" value={data.databaseStatus} /></Grid>
          <Grid item xs={12} sm={6} md={3}><MetricCard label="Uptime" value={`${data.uptime}s`} /></Grid>
          <Grid item xs={12} sm={6} md={3}><MetricCard label="Ultimo snapshot" value={formatDate(data.lastSnapshotAt)} /></Grid>
          <Grid item xs={12} sm={6} md={3}><MetricCard label="Ultima prediccion" value={formatDate(data.lastPredictionAt)} /></Grid>
          <Grid item xs={12} sm={6} md={3}><MetricCard label="Ultimo error" value={formatDate(data.lastErrorAt)} helper={data.lastErrorMessage ?? "Sin errores"} /></Grid>
          <Grid item xs={12} sm={6} md={3}><MetricCard label="Backups" value={data.backupCount} /></Grid>
          <Grid item xs={12} sm={6} md={3}><MetricCard label="SQLite" value={formatBytes(data.databaseSizeBytes)} /></Grid>
          <Grid item xs={12} sm={6} md={3}><MetricCard label="Trading real" value={data.enableRealTrading ? "Activado" : "Desactivado"} /></Grid>
        </Grid>
      ) : null}
    </Stack>
  );
}
