import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';

interface AuditEvent {
  auditEventId: string;
  runId: string;
  eventType: string;
  phase: string;
  agentId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface AuditResponse {
  data: AuditEvent[];
}

export function useRunAudit(runId: string) {
  return useQuery({
    queryKey: ['runAudit', runId],
    queryFn: () => apiGet<AuditResponse>(`/api/runs/${runId}/audit`),
    enabled: !!runId,
    refetchInterval: 5000,
  });
}
