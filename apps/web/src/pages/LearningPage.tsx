import { Alert, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";
import { useCallback } from "react";
import { ChartCard } from "../components/Charts";
import { DataState } from "../components/DataState";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { api } from "../services/api";
import { formatCurrency, formatDate, formatPercent } from "../services/format";
import { useApiResource } from "../components/useApiResource";

export function LearningPage() {
  const loader = useCallback(() => api.learning(), []);
  const { data, loading, error, refresh } = useApiResource(loader);

  return (
    <Stack spacing={3}>
      <PageHeader title="Learning" subtitle="Aprendizaje estadistico por casos similares, sin ML" onRefresh={refresh} />
      <DataState loading={loading} error={error} />
      {data ? (
        <>
          {!data.mlReady ? (
            <Alert severity="info">
              Aun no hay suficientes datos para ML. Minimo recomendado: {data.minResolvedTradesForMl} operaciones resueltas.
            </Alert>
          ) : null}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <MetricCard label="Casos similares acumulados" value={data.similarCasesAccumulated} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <MetricCard label="Resueltas para ML" value={`${data.resolvedTradesForMl}/${data.minResolvedTradesForMl}`} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <MetricCard label="ML listo" value={data.mlReady ? "Si" : "No"} />
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid item xs={12} lg={6}>
              <ChartCard title="Rendimiento por activo" data={data.byAsset.map((row) => ({ key: row.key, winRate: row.winRate }))} type="bar" xKey="key" yKey="winRate" />
            </Grid>
            <Grid item xs={12} lg={6}>
              <ChartCard title="Profit por estrategia" data={data.byStrategy.map((row) => ({ key: row.key, profit: row.totalProfit }))} type="bar" xKey="key" yKey="profit" />
            </Grid>
          </Grid>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>asset</TableCell>
                  <TableCell>strategy</TableCell>
                  <TableCell>marketType</TableCell>
                  <TableCell>outcome</TableCell>
                  <TableCell>cases</TableCell>
                  <TableCell>wins</TableCell>
                  <TableCell>losses</TableCell>
                  <TableCell>win rate</TableCell>
                  <TableCell>profit</TableCell>
                  <TableCell>avg ROI</TableCell>
                  <TableCell>updated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.learningStats.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.assetSymbol}</TableCell>
                    <TableCell>{row.strategyName}</TableCell>
                    <TableCell>{row.marketType}</TableCell>
                    <TableCell>{row.predictedOutcome}</TableCell>
                    <TableCell>{row.totalPredictions}</TableCell>
                    <TableCell>{row.wins}</TableCell>
                    <TableCell>{row.losses}</TableCell>
                    <TableCell>{formatPercent(row.winRate)}</TableCell>
                    <TableCell>{formatCurrency(row.totalProfit)}</TableCell>
                    <TableCell>{formatPercent(row.averageRoi)}</TableCell>
                    <TableCell>{formatDate(row.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : null}
    </Stack>
  );
}
