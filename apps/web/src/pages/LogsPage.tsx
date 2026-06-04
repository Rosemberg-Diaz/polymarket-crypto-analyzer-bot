import { Alert, Box, Button, FormControl, MenuItem, Select, Stack, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { DataState } from "../components/DataState";
import { PageHeader } from "../components/PageHeader";
import { api } from "../services/api";
import { formatDate } from "../services/format";
import { useApiResource } from "../components/useApiResource";

export function LogsPage() {
  const [level, setLevel] = useState("");
  const loader = useCallback(() => api.logs({ level, limit: 300 }), [level]);
  const { data, loading, error, refresh } = useApiResource(loader);

  return (
    <Stack spacing={3}>
      <PageHeader title="Logs" subtitle="Lectura de archivos locales en /logs" onRefresh={refresh} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <Select value={level} displayEmpty onChange={(event) => setLevel(event.target.value)}>
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="info">info</MenuItem>
            <MenuItem value="warn">warn</MenuItem>
            <MenuItem value="error">error</MenuItem>
            <MenuItem value="debug">debug</MenuItem>
          </Select>
        </FormControl>
        <Button variant="outlined" onClick={refresh}>Refrescar</Button>
      </Stack>
      <DataState loading={loading} error={error} />
      <Stack spacing={1}>
        {data?.logs.map((log, index) => (
          <Alert key={`${log.timestamp}-${index}`} severity={log.level === "error" ? "error" : log.level === "warn" ? "warning" : "info"}>
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                {log.level.toUpperCase()} · {formatDate(log.timestamp)}
              </Typography>
              <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{log.message}</Typography>
            </Box>
          </Alert>
        ))}
      </Stack>
    </Stack>
  );
}
