import { Alert, Box, CircularProgress } from "@mui/material";

interface DataStateProps {
  loading: boolean;
  error: string | null;
}

export function DataState({ loading, error }: DataStateProps) {
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return null;
}
