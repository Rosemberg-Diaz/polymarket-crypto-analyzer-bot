import { Grid, Stack } from "@mui/material";
import { useCallback } from "react";
import { api } from "../services/api";
import { ChartCard } from "../components/Charts";
import { DataState } from "../components/DataState";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { StatusChip } from "../components/StatusChip";
import { useApiResource } from "../components/useApiResource";
import { formatCurrency, formatPercent } from "../services/format";

export function DashboardPage() {
  const loader = useCallback(async () => {
    const [health, performance] = await Promise.all([api.health(), api.performance()]);
    return { health, performance };
  }, []);
  const { data, loading, error, refresh } = useApiResource(loader);

  return (
    <Stack spacing={3}>
      <PageHeader title="Dashboard" subtitle="Monitoreo local del bot en modo simulacion" onRefresh={refresh} />
      <DataState loading={loading} error={error} />
      {data ? (
        <>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Estado DB" value={<StatusChip value={data.health.databaseStatus} />} helper="SQLite local" />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Modo actual" value={data.health.appMode} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Trading real" value={data.health.enableRealTrading ? "Activado" : "Desactivado"} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Preparacion ML" value={data.performance.mlReady ? "Lista" : "No lista"} helper={`${data.performance.resolvedTradesForMl}/${data.performance.minResolvedTradesForMl}`} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Total predicciones" value={data.performance.totalPredictions} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Total simulaciones" value={data.performance.totalTrades} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Win rate" value={formatPercent(data.performance.winRate)} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Profit simulado" value={formatCurrency(data.performance.totalProfit)} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="ROI promedio" value={formatPercent(data.performance.averageRoi)} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Pendientes" value={data.health.totalPendingTrades} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Resueltas" value={data.health.totalResolvedTrades} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="Mejor asset" value={data.performance.bestAsset ?? "N/A"} />
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid item xs={12} lg={6}>
              <ChartCard title="Profit acumulado" data={data.performance.charts.cumulativeProfit} type="line" xKey="date" yKey="profit" />
            </Grid>
            <Grid item xs={12} lg={6}>
              <ChartCard title="Senales por dia" data={data.performance.charts.signalsByDay} type="bar" xKey="date" yKey="count" />
            </Grid>
            <Grid item xs={12} lg={6}>
              <ChartCard title="Win rate por activo" data={data.performance.charts.winRateByAsset.map((row) => ({ asset: row.key, winRate: row.winRate }))} type="bar" xKey="asset" yKey="winRate" />
            </Grid>
            <Grid item xs={12} lg={6}>
              <ChartCard title="Profit por estrategia" data={data.performance.charts.profitByStrategy.map((row) => ({ strategy: row.key, profit: row.totalProfit }))} type="bar" xKey="strategy" yKey="profit" />
            </Grid>
          </Grid>
        </>
      ) : null}
    </Stack>
  );
}
