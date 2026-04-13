import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import styles from './GateFrequencyChart.module.css';

interface TrendPoint {
  runIndex: number;
  gateCount: number;
}

interface GateFrequencyChartProps {
  data: TrendPoint[];
}

export function GateFrequencyChart({ data }: GateFrequencyChartProps) {
  if (data.length === 0) {
    return <p className={styles.empty}>No gate frequency data available.</p>;
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Gate Frequency Trend</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="runIndex" label={{ value: 'Run', position: 'insideBottom', offset: -5 }} />
          <YAxis label={{ value: 'Gates', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Line type="monotone" dataKey="gateCount" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
