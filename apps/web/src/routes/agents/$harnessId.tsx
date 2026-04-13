import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { apiGet, apiPatch } from '../../api/client';
import { AgentPipelineEditor } from '../../components/AgentPipelineEditor';

interface AgentConfig {
  agentConfigId: string;
  phase: string;
  position: number;
  agentId: string;
  model: string;
  systemPromptBody: string;
  maxTokens: number;
  isActive: boolean;
}

interface AgentsResponse {
  data: AgentConfig[];
}

const TAPES_ORDER = ['TRIGGER', 'ACQUIRE', 'PLAN', 'EXECUTE', 'SHIP'];

export function AgentsPage() {
  const { harnessId } = useParams({ strict: false }) as { harnessId: string };
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents', harnessId],
    queryFn: () => apiGet<AgentsResponse>(`/api/agents?harnessId=${harnessId}`),
  });

  const agents = data?.data ?? [];
  const sorted = [...agents].sort((a, b) => {
    const phaseOrder = TAPES_ORDER.indexOf(a.phase) - TAPES_ORDER.indexOf(b.phase);
    if (phaseOrder !== 0) return phaseOrder;
    return a.position - b.position;
  });

  const handleSave = async (agentConfigId: string, updates: { model?: string; systemPromptBody?: string }) => {
    const agent = agents.find((a) => a.agentConfigId === agentConfigId);
    if (!agent) return;
    await apiPatch(`/api/agents/${agentConfigId}`, updates);
    queryClient.invalidateQueries({ queryKey: ['agents', harnessId] });
  };

  if (isLoading) return <div style={{ padding: 24 }}>Loading agents...</div>;
  if (error) return <div style={{ padding: 24, color: '#dc2626' }}>Error: {(error as Error).message}</div>;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Agent Pipeline — {harnessId}</h1>
      <AgentPipelineEditor agents={sorted} onSave={handleSave} />
    </div>
  );
}
