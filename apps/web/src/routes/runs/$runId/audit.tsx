import { useParams } from '@tanstack/react-router';
import { useRunAudit } from '../../../hooks/useRunAudit';
import { AuditTimeline } from '../../../components/AuditTimeline';
import { useRunStream } from '../../../hooks/useRunStream';

export function AuditPage() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  useRunStream('default', runId);

  const { data, isLoading, error } = useRunAudit(runId);

  if (isLoading) return <div style={{ padding: 24 }}>Loading audit events...</div>;
  if (error) return <div style={{ padding: 24, color: '#dc2626' }}>Error: {(error as Error).message}</div>;

  const events = data?.data ?? [];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href={`/runs/${runId}`} style={{ color: '#2563eb', fontSize: 14, textDecoration: 'none' }}>&larr; Back to Run</a>
        <h1 style={{ fontSize: 20, margin: 0 }}>Audit Timeline</h1>
        <span style={{ color: '#9ca3af', fontSize: 13 }}>{events.length} events</span>
      </div>
      <AuditTimeline events={events} />
    </div>
  );
}
