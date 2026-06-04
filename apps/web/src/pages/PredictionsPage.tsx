import { FormControl, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField } from "@mui/material";
import { useCallback, useState } from "react";
import { DataState } from "../components/DataState";
import { PageHeader } from "../components/PageHeader";
import { api } from "../services/api";
import { formatDate, formatNumber, formatPercent } from "../services/format";
import { useApiResource } from "../components/useApiResource";

export function PredictionsPage() {
  const [assetSymbol, setAssetSymbol] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const loader = useCallback(() => api.predictions({ assetSymbol, recommendation, limit: 300 }), [assetSymbol, recommendation]);
  const { data, loading, error, refresh } = useApiResource(loader);
  const rows = data?.predictions ?? [];
  const pageRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Stack spacing={3}>
      <PageHeader title="Predictions" subtitle="Senales generadas por el motor local" onRefresh={refresh} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField size="small" label="Asset" value={assetSymbol} onChange={(event) => setAssetSymbol(event.target.value.toUpperCase())} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <Select value={recommendation} displayEmpty onChange={(event) => setRecommendation(event.target.value)}>
            <MenuItem value="">Todas</MenuItem>
            <MenuItem value="ENTER_SMALL">ENTER_SMALL</MenuItem>
            <MenuItem value="ENTER_MODERATE">ENTER_MODERATE</MenuItem>
            <MenuItem value="WAIT">WAIT</MenuItem>
            <MenuItem value="AVOID">AVOID</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      <DataState loading={loading} error={error} />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>fecha</TableCell>
              <TableCell>activo</TableCell>
              <TableCell>mercado</TableCell>
              <TableCell>estrategia</TableCell>
              <TableCell>outcome</TableCell>
              <TableCell>entry</TableCell>
              <TableCell>impl</TableCell>
              <TableCell>bot</TableCell>
              <TableCell>edge</TableCell>
              <TableCell>recommendation</TableCell>
              <TableCell>confidence</TableCell>
              <TableCell>reason</TableCell>
              <TableCell>historicalSummary</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell>{row.assetSymbol}</TableCell>
                <TableCell>{row.marketQuestion}</TableCell>
                <TableCell>{row.strategyName}</TableCell>
                <TableCell>{row.predictedOutcome}</TableCell>
                <TableCell>{formatNumber(row.entryPrice)}</TableCell>
                <TableCell>{formatPercent(row.impliedProbability)}</TableCell>
                <TableCell>{formatPercent(row.botProbability)}</TableCell>
                <TableCell>{formatPercent(row.edge)}</TableCell>
                <TableCell>{row.recommendation}</TableCell>
                <TableCell>{formatNumber(row.confidence)}</TableCell>
                <TableCell sx={{ minWidth: 320 }}>{row.reason}</TableCell>
                <TableCell sx={{ minWidth: 260 }}>{row.historicalSummary}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={rows.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number(event.target.value));
          setPage(0);
        }}
      />
    </Stack>
  );
}
