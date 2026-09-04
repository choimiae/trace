import { type DashboardSummary, issueTypeLabel } from "@trace/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../../ui/Card.js";

export function IssueTypeChart({ data }: { data: DashboardSummary["issueTypeDistribution"] }) {
  const supportsResponsiveContainer = typeof ResizeObserver !== "undefined";

  return (
    <Card as="section" className="chart-panel">
      <h2>이슈 유형 분포</h2>
      {data.length === 0 ? (
        <p className="empty-state">아직 표시할 이슈가 없습니다.</p>
      ) : supportsResponsiveContainer ? (
        <ResponsiveContainer width="100%" height={220}>
          <IssueTypeBarChart data={data} />
        </ResponsiveContainer>
      ) : (
        <IssueTypeBarChart data={data} width={420} height={220} />
      )}
    </Card>
  );
}

function IssueTypeBarChart({
  data,
  width,
  height,
}: {
  data: DashboardSummary["issueTypeDistribution"];
  width?: number;
  height?: number;
}) {
  const sizeProps = width === undefined || height === undefined ? {} : { width, height };

  return (
    <BarChart {...sizeProps} data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
      {/* 원시 enum(dead_click_cluster)은 좁은 폭에서 서로 겹쳐 라벨이 통째로 빠진다.
          화면의 나머지가 쓰는 한국어 이름을 그대로 써서 짧게 만든다. */}
      <XAxis
        dataKey="issueType"
        tickFormatter={issueTypeLabel}
        tick={{ fontSize: 12, fill: "var(--ink-faint)" }}
      />
      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--ink-faint)" }} width={32} />
      <Tooltip
        labelFormatter={issueTypeLabel}
        cursor={{ fill: "var(--surface-sunk)" }}
        contentStyle={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          fontSize: 12,
        }}
      />
      <Bar dataKey="count" name="이슈 수" fill="var(--accent)" radius={[4, 4, 0, 0]} />
    </BarChart>
  );
}
