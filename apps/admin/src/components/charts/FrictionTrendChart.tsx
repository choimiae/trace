import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../../ui/Card.js";

export function FrictionTrendChart({ data }: { data: Array<{ date: string; score: number }> }) {
  const supportsResponsiveContainer = typeof ResizeObserver !== "undefined";

  return (
    <Card as="section" className="chart-panel">
      <h2>기간별 막힘 추세</h2>
      {data.length === 0 ? (
        <p className="empty-state">아직 표시할 추세가 없습니다.</p>
      ) : supportsResponsiveContainer ? (
        <ResponsiveContainer width="100%" height={220}>
          <FrictionTrendLineChart data={data} />
        </ResponsiveContainer>
      ) : (
        <FrictionTrendLineChart data={data} width={420} height={220} />
      )}
    </Card>
  );
}

function FrictionTrendLineChart({
  data,
  width,
  height,
}: {
  data: Array<{ date: string; score: number }>;
  width?: number;
  height?: number;
}) {
  const sizeProps = width === undefined || height === undefined ? {} : { width, height };

  return (
    <LineChart {...sizeProps} data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
      <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--ink-faint)" }} />
      <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "var(--ink-faint)" }} width={32} />
      <Tooltip
        contentStyle={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          fontSize: 12,
        }}
      />
      <Line
        type="monotone"
        dataKey="score"
        name="막힘 점수"
        stroke="var(--accent)"
        strokeWidth={2}
        dot={{ r: 4 }}
        activeDot={{ r: 5 }}
      />
    </LineChart>
  );
}
