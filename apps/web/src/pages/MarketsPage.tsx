import { Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField } from "@mui/material";
import { useCallback, useState } from "react";
import { DataState } from "../components/DataState";
import { PageHeader } from "../components/PageHeader";
import { StatusChip } from "../components/StatusChip";
import { api } from "../services/api";
import { formatDate, formatNumber } from "../services/format";
import { useApiResource } from "../components/useApiResource";

export function MarketsPage() {
  const [assetSymbol, setAssetSymbol] = useState("");
  const loader = useCallback(() => api.markets({ assetSymbol, limit: 200 }), [assetSymbol]);
  const { data, loading, error, refresh } = useApiResource(loader);

  return (
    <Stack spacing={3}>
      <PageHeader title="Markets" subtitle="Mercados crypto guardados localmente" onRefresh={refresh} />
      <TextField size="small" label="Asset" value={assetSymbol} onChange={(event) => setAssetSymbol(event.target.value.toUpperCase())} sx={{ maxWidth: 220 }} />
      <DataState loading={loading} error={error} />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>activo</TableCell>
              <TableCell>pregunta</TableCell>
              <TableCell>tipo</TableCell>
              <TableCell>timeframe</TableCell>
              <TableCell>active</TableCell>
              <TableCell>closed</TableCell>
              <TableCell>endDate</TableCell>
              <TableCell>ultimo snapshot</TableCell>
              <TableCell>precio actual</TableCell>
              <TableCell>spread</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data?.markets ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.assetSymbol}</TableCell>
                <TableCell>{row.question}</TableCell>
                <TableCell>{row.marketType}</TableCell>
                <TableCell>{row.timeframe ?? "unknown"}</TableCell>
                <TableCell><StatusChip value={row.active} /></TableCell>
                <TableCell><StatusChip value={row.closed} /></TableCell>
                <TableCell>{formatDate(row.endDate)}</TableCell>
                <TableCell>{formatDate(row.lastSnapshot?.createdAt)}</TableCell>
                <TableCell>{formatNumber(row.lastSnapshot?.currentAssetPrice)}</TableCell>
                <TableCell>{formatNumber(row.lastSnapshot?.spread)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
