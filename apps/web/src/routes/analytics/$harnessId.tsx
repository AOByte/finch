import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { apiGet } from '../../api/client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface AnalyticsData {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  averageDurationMs: number;
  gateFrequency: Array<{ phase: string; count: number }>;
  runsByDay: Array<{ date: string; count: number }>;
}

interface AnalyticsResponse {
  data: AnalyticsData;
}

export function AnalyticsPage() {
  const { harnessId } = useParams({ strict: false }) as { harnessId: string };

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', harnessId],
    queryFn: () => apiGet<AnalyticsResponse>(`/api/analytics/${harnessId}`),
    refetchInterval: 30000,
  });

  if (isLoading) return <div style={{ padding: 24 }}>Loading analytics...</div>;
  if (error) return <div style={{ padding: 24, color: '#dc2626' }}>Error: {(error as Error).message}</div>;

  const analytics = data?.data;
  if (!analytics) return <div style={{ padding: 24 }}>No analytics data</div>;

  const avgDurationSec = Math.round((analytics.averageDurationMs ?? 0) / 1000);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Analytics — {harnessId}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Runs" value={analytics.totalRuns} />
        <StatCard label="Completed" value={analytics.completedRuns} color="#16a34a" />
        <StatCard label="Failed" value={analytics.failedRuns} color="#dc2626" />
        <StatCard label="Avg Duration" value={`${avgDurationSec}s`} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Gate Frequency by Phase</h2>
        {analytics.gateFrequency && analytics.gateFrequency.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics.gateFrequency}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="phase" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: '#9ca3af' }}>No gate frequency data.</p>
        )}
      </div>

      {analytics.runsByDay && analytics.runsByDay.length > 0 && (
        <div>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Runs by Day</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics.runsByDay}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? '#111827' }}>{value}</div>
    </div>
  );
}
