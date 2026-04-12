import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditWriteProcessor } from '../../src/audit/audit-write.processor';

describe('AuditWriteProcessor', () => {
  let processor: AuditWriteProcessor;
  const mockAuditRepository = {
    create: vi.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new AuditWriteProcessor(mockAuditRepository as never);
  });

  it('processes a job by creating audit event', async () => {
    const job = {
      data: {
        runId: 'run-1',
        harnessId: 'harness-1',
        phase: 'TRIGGER',
        eventType: 'tool_call',
        actor: { agentId: 'agent-1' },
        payload: { toolName: 'test' },
      },
    };

    await processor.process(job as never);
    expect(mockAuditRepository.create).toHaveBeenCalledWith({
      runId: 'run-1',
      harnessId: 'harness-1',
      phase: 'TRIGGER',
      eventType: 'tool_call',
      actor: { agentId: 'agent-1' },
      payload: { toolName: 'test' },
    });
  });
});
