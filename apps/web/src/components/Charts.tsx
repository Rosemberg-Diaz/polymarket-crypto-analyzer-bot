import { Card, CardContent, Typography } from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

interface ChartCardProps {
  title: string;
  data: Array<Record<string, string | number>>;
  type: "line" | "bar";
  xKey: string;
  yKey: string;
}

export function ChartCard({ title, data, type, xKey, yKey }: ChartCardProps) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
          {title}
        </Typography>
        <ResponsiveContainer width="100%" height={280}>
          {type === "line" ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} minTickGap={28} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey={yKey} stroke="#0f766e" strokeWidth={2} dot={false} />
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} minTickGap={16} />
              <YAxis />
              <Tooltip />
              <Bar dataKey={yKey} fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
