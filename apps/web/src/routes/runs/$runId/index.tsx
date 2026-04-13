import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from '@tanstack/react-router';
import { apiGet, apiPost } from '../../../api/client';
import { RunStatusBadge } from '../../../components/RunStatusBadge';
import { PhaseBadge } from '../../../components/PhaseBadge';
import { GateResponsePanel } from '../../../components/GateResponsePanel';
import { useRunStream } from '../../../hooks/useRunStream';

const TAPES_ORDER = ['TRIGGER', 'ACQUIRE', 'PLAN', 'EXECUTE', 'SHIP'] as const;

interface Run {
  runId: string;
  status: string;
  currentPhase: string;
  createdAt: string;
  updatedAt: string;
}

interface Gate {
  gateId: string;
  question: string;
  description?: string;
  phase?: string;
  status: string;
}

interface AuditEvent {
  auditEventId: string;
  eventType: string;
  phase: string;
  createdAt: string;
}

type PhaseStatus = 'not_started' | 'in_progress' | 'completed' | 'failed';

function getPhaseStatus(phase: string, currentPhase: string, runStatus: string, auditEvents: AuditEvent[]): PhaseStatus {
  const phaseEvents = auditEvents.filter((e) => e.phase === phase);
  const hasStarted = phaseEvents.some((e) => e.eventType === 'phase_started');
  const hasCompleted = phaseEvents.some((e) => e.eventType === 'phase_completed');

  if (hasCompleted) return 'completed';
  if (runStatus === 'FAILED' && currentPhase === phase) return 'failed';
  if (hasStarted || currentPhase === phase) return 'in_progress';
  return 'not_started';
}

export function RunDetailPage() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  const router = useRouter();
  useRunStream('default', runId);

  const { data: runData, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => apiGet<{ data: Run }>(`/api/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: 3000,
  });

  const { data: gatesData } = useQuery({
    queryKey: ['runGates', runId],
    queryFn: () => apiGet<{ data: Gate[] }>(`/api/runs/${runId}/gates`),
    enabled: !!runId,
    refetchInterval: 3000,
  });

  const { data: auditData } = useQuery({
    queryKey: ['runAudit', runId],
    queryFn: () => apiGet<{ data: AuditEvent[] }>(`/api/runs/${runId}/audit`),
    enabled: !!runId,
    refetchInterval: 5000,
  });

  if (isLoading) return <div style={{ padding: 24 }}>Loading run...</div>;

  const run = runData?.data;
  if (!run) return <div style={{ padding: 24 }}>Run not found</div>;

  const gates = gatesData?.data ?? [];
  const auditEvents = auditData?.data ?? [];
  const pendingGate = gates.find((g) => g.status === 'PENDING');

  const handleStop = async () => {
    await apiPost(`/api/runs/${runId}/stop`);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => router.navigate({ to: '/runs' })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>
          &larr; Back
        </button>
        <h1 style={{ fontSize: 20, margin: 0 }}>Run {run.runId.slice(0, 8)}</h1>
        <RunStatusBadge status={run.status} />
        {run.status === 'RUNNING' && (
          <button
            onClick={handleStop}
            style={{ marginLeft: 'auto', padding: '6px 12px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
          >
            Stop Run
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }} data-testid="audit-timeline">
        {TAPES_ORDER.map((phase) => (
          <PhaseBadge
            key={phase}
            phase={phase}
            status={getPhaseStatus(phase, run.currentPhase, run.status, auditEvents)}
          />
        ))}
      </div>

      {pendingGate && (
        <GateResponsePanel
          gate={{
            gateId: pendingGate.gateId,
            question: pendingGate.question ?? 'Please provide input',
            description: pendingGate.description,
            phase: pendingGate.phase,
          }}
          runStatus={run.status}
        />
      )}

      <div style={{ marginTop: 16 }}>
        <a
          href={`/runs/${runId}/audit`}
          style={{ color: '#2563eb', fontSize: 14 }}
        >
          View Audit Timeline &rarr;
        </a>
      </div>
    </div>
  );
}
