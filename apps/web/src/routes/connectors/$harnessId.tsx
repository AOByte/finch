import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { apiGet, apiDelete } from '../../api/client';
import { ConnectorHealthBadge } from '../../components/ConnectorHealthBadge';

interface Connector {
  connectorId: string;
  type: string;
  name: string;
  status: string;
  lastCheckedAt: string | null;
}

interface ConnectorsResponse {
  data: Connector[];
}

export function ConnectorsPage() {
  const { harnessId } = useParams({ strict: false }) as { harnessId: string };
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['connectors', harnessId],
    queryFn: () => apiGet<ConnectorsResponse>(`/api/connectors?harnessId=${harnessId}`),
    refetchInterval: 10000,
  });

  const connectors = data?.data ?? [];

  const handleDelete = async (connectorId: string) => {
    await apiDelete(`/api/connectors/${connectorId}`);
    queryClient.invalidateQueries({ queryKey: ['connectors', harnessId] });
  };

  if (isLoading) return <div style={{ padding: 24 }}>Loading connectors...</div>;
  if (error) return <div style={{ padding: 24, color: '#dc2626' }}>Error: {(error as Error).message}</div>;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Connectors — {harnessId}</h1>

      {connectors.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No connectors configured.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {connectors.map((c) => (
            <div
              key={c.connectorId}
              style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{c.type}</div>
              </div>
              <ConnectorHealthBadge isActive={c.status === 'ACTIVE'} lastHealthCheck={c.lastCheckedAt} />
              <button
                onClick={() => handleDelete(c.connectorId)}
                style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
