import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { apiGet } from '../../api/client';
import { RunStatusBadge } from '../../components/RunStatusBadge';
import { useRunStream } from '../../hooks/useRunStream';

interface Run {
  runId: string;
  status: string;
  currentPhase: string;
  createdAt: string;
}

interface RunsResponse {
  data: Run[];
  meta: { total: number; hasMore: boolean };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function RunListPage() {
  const router = useRouter();
  useRunStream('default');

  const { data, isLoading, error } = useQuery({
    queryKey: ['runs'],
    queryFn: () => apiGet<RunsResponse>('/api/runs?harnessId=default'),
    refetchInterval: 5000,
  });

  if (isLoading) return <div style={{ padding: 24 }}>Loading runs...</div>;
  if (error) return <div style={{ padding: 24, color: '#dc2626' }}>Error: {(error as Error).message}</div>;

  const runs = data?.data ?? [];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Runs</h1>
      {runs.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No runs yet. Trigger a run via Slack or the webhook endpoint.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Run ID</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Phase</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.runId}
                style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                onClick={() => router.navigate({ to: '/runs/$runId', params: { runId: run.runId } })}
              >
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 13 }}>
                  {run.runId.slice(0, 8)}
                </td>
                <td style={{ padding: 8 }}>
                  <RunStatusBadge status={run.status} />
                </td>
                <td style={{ padding: 8, color: '#6b7280' }}>{run.currentPhase}</td>
                <td style={{ padding: 8, color: '#9ca3af' }}>{timeAgo(run.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
