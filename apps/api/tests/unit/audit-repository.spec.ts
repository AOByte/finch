import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditRepository } from '../../src/audit/audit.repository';

describe('AuditRepository', () => {
  const mockPrisma = {
    auditEvent: {
      create: vi.fn().mockResolvedValue({ auditEventId: 'ae-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  let repo: AuditRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new AuditRepository(mockPrisma as never);
  });

  it('create delegates to prisma', async () => {
    const data = { runId: 'r1', eventType: 'gate_fired', actor: {}, payload: {} };
    await repo.create(data as never);
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({ data });
  });

  it('findByRunId returns events ordered by createdAt asc', async () => {
    await repo.findByRunId('r1');
    expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith({
      where: { runId: 'r1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('findByGateIdAndEventType queries by payload path', async () => {
    await repo.findByGateIdAndEventType('g1', 'gate_fired');
    expect(mockPrisma.auditEvent.findFirst).toHaveBeenCalledWith({
      where: {
        eventType: 'gate_fired',
        payload: { path: ['gateId'], equals: 'g1' },
      },
    });
  });
});
