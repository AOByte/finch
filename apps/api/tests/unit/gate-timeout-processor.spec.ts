import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GateTimeoutProcessor } from '../../src/orchestrator/gate-timeout.processor';
import { GateRepository } from '../../src/persistence/gate.repository';
import { RunRepository } from '../../src/persistence/run.repository';
import { ConnectorRegistryService } from '../../src/connectors/connector-registry.service';
import { AuditLoggerService } from '../../src/audit/audit-logger.service';
import { Job, Queue } from 'bullmq';

const mockGateRepo = {
  findById: vi.fn(),
} as unknown as GateRepository;

const mockRunRepo = {
  updateStatus: vi.fn().mockResolvedValue(undefined),
} as unknown as RunRepository;

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockRegistry = {
  getDefaultTriggerConnector: vi.fn().mockReturnValue({ sendMessage: mockSendMessage }),
} as unknown as ConnectorRegistryService;

const mockAuditLogger = {
  log: vi.fn().mockResolvedValue(undefined),
} as unknown as AuditLoggerService;

const mockQueue = {
  add: vi.fn().mockResolvedValue(undefined),
} as unknown as Queue;

function makeProcessor() {
  return new GateTimeoutProcessor(
    mockGateRepo,
    mockRunRepo,
    mockRegistry,
    mockAuditLogger,
    mockQueue,
  );
}

function makeJob(data: { gateId: string; runId: string }): Job<{ gateId: string; runId: string }> {
  return { data } as Job<{ gateId: string; runId: string }>;
}

describe('GateTimeoutProcessor', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns early if gate is already resolved (idempotency)', async () => {
    vi.mocked(mockGateRepo.findById).mockResolvedValue({
      gateId: 'g1', runId: 'r1', harnessId: 'h1', resolvedAt: new Date(),
      question: 'Q?', source: {},
    } as never);

    const processor = makeProcessor();
    await processor.process(makeJob({ gateId: 'g1', runId: 'r1' }));

    expect(mockRunRepo.updateStatus).not.toHaveBeenCalled();
    expect(mockAuditLogger.log).not.toHaveBeenCalled();
  });

  it('returns early if gate is not found', async () => {
    vi.mocked(mockGateRepo.findById).mockResolvedValue(null);

    const processor = makeProcessor();
    await processor.process(makeJob({ gateId: 'g1', runId: 'r1' }));

    expect(mockRunRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('sets run to STALLED, re-sends question, schedules retry, and audits', async () => {
    vi.mocked(mockGateRepo.findById).mockResolvedValue({
      gateId: 'g1', runId: 'r1', harnessId: 'h1', resolvedAt: null,
      question: 'What is the module?',
      source: { channelId: 'C123', threadTs: '1.1' },
    } as never);

    const processor = makeProcessor();
    await processor.process(makeJob({ gateId: 'g1', runId: 'r1' }));

    // Sets run to STALLED
    expect(mockRunRepo.updateStatus).toHaveBeenCalledWith('r1', 'STALLED');

    // Re-sends question
    expect(mockSendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      threadTs: '1.1',
      message: expect.stringContaining('Reminder'),
    });

    // Schedules 24h retry
    expect(mockQueue.add).toHaveBeenCalledWith(
      'gate-timeout',
      { gateId: 'g1', runId: 'r1' },
      { delay: 24 * 60 * 60 * 1000, jobId: 'gate-timeout:g1:retry' },
    );

    // Audits gate_stalled
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'r1',
      eventType: 'gate_stalled',
    }));
  });

  it('handles missing trigger connector gracefully', async () => {
    vi.mocked(mockGateRepo.findById).mockResolvedValue({
      gateId: 'g1', runId: 'r1', harnessId: 'h1', resolvedAt: null,
      question: 'Q?', source: { channelId: 'C1', threadTs: '1.1' },
    } as never);
    vi.mocked(mockRegistry.getDefaultTriggerConnector).mockReturnValue(undefined);

    const processor = makeProcessor();
    await processor.process(makeJob({ gateId: 'g1', runId: 'r1' }));

    // Should still set STALLED and schedule retry even without connector
    expect(mockRunRepo.updateStatus).toHaveBeenCalledWith('r1', 'STALLED');
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('handles null source gracefully', async () => {
    vi.mocked(mockGateRepo.findById).mockResolvedValue({
      gateId: 'g1', runId: 'r1', harnessId: 'h1', resolvedAt: null,
      question: 'Q?', source: null,
    } as never);
    vi.mocked(mockRegistry.getDefaultTriggerConnector).mockReturnValue({ sendMessage: mockSendMessage } as never);

    const processor = makeProcessor();
    await processor.process(makeJob({ gateId: 'g1', runId: 'r1' }));

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      channelId: '',
      threadTs: '',
    }));
  });
});
