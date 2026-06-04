import { FormControl, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField } from "@mui/material";
import { useCallback, useState } from "react";
import { DataState } from "../components/DataState";
import { PageHeader } from "../components/PageHeader";
import { StatusChip } from "../components/StatusChip";
import { api } from "../services/api";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "../services/format";
import { useApiResource } from "../components/useApiResource";

export function TradesPage() {
  const [status, setStatus] = useState("");
  const [assetSymbol, setAssetSymbol] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const loader = useCallback(() => api.trades({ status, assetSymbol, limit: 300 }), [status, assetSymbol]);
  const { data, loading, error, refresh } = useApiResource(loader);
  const rows = data?.trades ?? [];
  const pageRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Stack spacing={3}>
      <PageHeader title="Trades" subtitle="Operaciones simuladas, nunca reales" onRefresh={refresh} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField size="small" label="Asset" value={assetSymbol} onChange={(event) => setAssetSymbol(event.target.value.toUpperCase())} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <Select value={status} displayEmpty onChange={(event) => setStatus(event.target.value)}>
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="PENDING">PENDING</MenuItem>
            <MenuItem value="RESOLVED">RESOLVED</MenuItem>
            <MenuItem value="CANCELLED">CANCELLED</MenuItem>
            <MenuItem value="ERROR">ERROR</MenuItem>
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
              <TableCell>prediccion</TableCell>
              <TableCell>stake</TableCell>
              <TableCell>entry</TableCell>
              <TableCell>shares</TableCell>
              <TableCell>status</TableCell>
              <TableCell>result</TableCell>
              <TableCell>isWin</TableCell>
              <TableCell>profit</TableCell>
              <TableCell>roi</TableCell>
              <TableCell>resolvedAt</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell>{row.assetSymbol}</TableCell>
                <TableCell>{row.marketQuestion}</TableCell>
                <TableCell>{row.prediction}</TableCell>
                <TableCell>{formatCurrency(row.stake)}</TableCell>
                <TableCell>{formatNumber(row.entryPrice)}</TableCell>
                <TableCell>{formatNumber(row.shares)}</TableCell>
                <TableCell><StatusChip value={row.status} /></TableCell>
                <TableCell>{row.result ?? "N/A"}</TableCell>
                <TableCell><StatusChip value={row.isWin} /></TableCell>
                <TableCell>{formatCurrency(row.profit)}</TableCell>
                <TableCell>{formatPercent(row.roi)}</TableCell>
                <TableCell>{formatDate(row.resolvedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination component="div" count={rows.length} page={page} rowsPerPage={rowsPerPage} onPageChange={(_, nextPage) => setPage(nextPage)} onRowsPerPageChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(0); }} />
    </Stack>
  );
}
