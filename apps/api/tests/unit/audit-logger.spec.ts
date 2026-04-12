import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLoggerService } from '../../src/audit/audit-logger.service';
import type { RedisPublisher } from '../../src/audit/audit-logger.service';

describe('AuditLoggerService', () => {
  let service: AuditLoggerService;
  const mockAuditRepository = {
    create: vi.fn().mockResolvedValue({}),
  };
  const mockQueue = {
    add: vi.fn().mockResolvedValue({}),
  };
  const mockRedisPublisher: RedisPublisher = {
    publish: vi.fn().mockResolvedValue(1),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuditLoggerService(mockAuditRepository as never, mockQueue as never, mockRedisPublisher);
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

  describe('Redis pub/sub (W4-10)', () => {
    it('publishes to Redis channel when harnessId is present', async () => {
      await service.log({
        runId: 'run-1',
        harnessId: 'harness-1',
        eventType: 'phase_started',
      });
      expect(mockRedisPublisher.publish).toHaveBeenCalledWith(
        'audit-events:harness-1',
        expect.stringContaining('"eventType":"phase_started"'),
      );
    });

    it('does not publish when harnessId is missing', async () => {
      await service.log({
        runId: 'run-1',
        eventType: 'tool_call',
      });
      expect(mockRedisPublisher.publish).not.toHaveBeenCalled();
    });

    it('works without Redis publisher (optional dependency)', async () => {
      const serviceNoRedis = new AuditLoggerService(mockAuditRepository as never, mockQueue as never);
      await serviceNoRedis.log({
        runId: 'run-1',
        harnessId: 'harness-1',
        eventType: 'phase_started',
      });
      // Should not throw — Redis is optional
      expect(mockAuditRepository.create).toHaveBeenCalled();
    });

    it('handles Redis publish failure gracefully', async () => {
      vi.mocked(mockRedisPublisher.publish).mockRejectedValueOnce(new Error('Connection lost'));
      await service.log({
        runId: 'run-1',
        harnessId: 'harness-1',
        eventType: 'phase_started',
      });
      // Should not throw — error is caught and logged
      expect(mockAuditRepository.create).toHaveBeenCalled();
    });

    it('published message includes createdAt timestamp', async () => {
      await service.log({
        runId: 'run-1',
        harnessId: 'harness-1',
        eventType: 'gate_fired',
      });
      const publishCall = vi.mocked(mockRedisPublisher.publish).mock.calls[0];
      const parsed = JSON.parse(publishCall[1]);
      expect(parsed.createdAt).toBeDefined();
      expect(new Date(parsed.createdAt).getTime()).toBeGreaterThan(0);
    });
  });
});
