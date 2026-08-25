import type { DashboardSummary } from "@trace/shared";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

export function IssueTypeChart({ data }: { data: DashboardSummary["issueTypeDistribution"] }) {
  return (
    <section className="chart-panel">
      <h2>이슈 유형 분포</h2>
      <BarChart width={420} height={220} data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#d8e1e8" strokeDasharray="3 3" />
        <XAxis dataKey="issueType" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={32} />
        <Tooltip />
        <Bar dataKey="count" name="이슈 수" fill="#c4542d" radius={[4, 4, 0, 0]} />
      </BarChart>
    </section>
  );
}
