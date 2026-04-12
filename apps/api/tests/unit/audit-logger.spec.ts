import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLoggerService } from '../../src/audit/audit-logger.service';

describe('AuditLoggerService', () => {
  let service: AuditLoggerService;
  const mockAuditRepository = {
    create: vi.fn().mockResolvedValue({}),
  };
  const mockQueue = {
    add: vi.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuditLoggerService(mockAuditRepository as never, mockQueue as never);
  });

  it('writes critical events synchronously', async () => {
    await service.log({
      runId: 'run-1',
      harnessId: 'harness-1',
      phase: 'TRIGGER',
      eventType: 'gate_fired',
      actor: { agentId: 'agent-1' },
      payload: { gateId: 'gate-1' },
    });
    expect(mockAuditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'gate_fired', runId: 'run-1' }),
    );
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('enqueues non-critical events via BullMQ', async () => {
    await service.log({
      runId: 'run-1',
      eventType: 'tool_call',
      actor: { agentId: 'agent-1' },
      payload: { toolName: 'fire_gate' },
    });
    expect(mockQueue.add).toHaveBeenCalledWith('audit-write', expect.objectContaining({ eventType: 'tool_call' }));
    expect(mockAuditRepository.create).not.toHaveBeenCalled();
  });

  it('handles missing optional fields', async () => {
    await service.log({
      runId: 'run-1',
      eventType: 'llm_call',
    });
    expect(mockQueue.add).toHaveBeenCalledWith('audit-write', expect.objectContaining({
      harnessId: null,
      phase: null,
      actor: {},
      payload: {},
    }));
  });

  it('writes phase_started synchronously (critical)', async () => {
    await service.log({
      runId: 'run-1',
      eventType: 'phase_started',
    });
    expect(mockAuditRepository.create).toHaveBeenCalled();
  });

  it('writes run_completed synchronously (critical)', async () => {
    await service.log({
      runId: 'run-1',
      eventType: 'run_completed',
    });
    expect(mockAuditRepository.create).toHaveBeenCalled();
  });

  it('writes run_failed synchronously (critical)', async () => {
    await service.log({
      runId: 'run-1',
      eventType: 'run_failed',
    });
    expect(mockAuditRepository.create).toHaveBeenCalled();
  });
});
