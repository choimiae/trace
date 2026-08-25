import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

export function FrictionTrendChart({ data }: { data: Array<{ date: string; score: number }> }) {
  return (
    <section className="chart-panel">
      <h2>기간별 막힘 추세</h2>
      <LineChart width={420} height={220} data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#d8e1e8" strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} width={32} />
        <Tooltip />
        <Line type="monotone" dataKey="score" name="막힘 점수" stroke="#117a7a" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </section>
  );
}
