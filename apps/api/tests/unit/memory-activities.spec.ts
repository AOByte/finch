import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryActivities } from '../../src/memory/memory.activities';
import { MemoryConnectorService } from '../../src/memory/memory-connector.service';
import { AuditLoggerService } from '../../src/audit/audit-logger.service';

describe('MemoryActivities', () => {
  let activities: MemoryActivities;
  let memoryConnector: {
    getStagingRecords: ReturnType<typeof vi.fn>;
    mergeRecord: ReturnType<typeof vi.fn>;
    clearStaging: ReturnType<typeof vi.fn>;
  };
  let auditLogger: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    memoryConnector = {
      getStagingRecords: vi.fn(),
      mergeRecord: vi.fn().mockResolvedValue(undefined),
      clearStaging: vi.fn().mockResolvedValue(undefined),
    };
    auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
    activities = new MemoryActivities(
      memoryConnector as unknown as MemoryConnectorService,
      auditLogger as unknown as AuditLoggerService,
    );
  });

  it('mergeRunMemory calls mergeRecord for each staging record + clearStaging + emits memory_merged', async () => {
    const records = [
      { stagingId: 's1', runId: 'r1', harnessId: 'h1', type: 'TaskPattern', content: 'c1', embedding: [0.1], relevanceTags: ['t1'], contentHash: 'hash1', createdAt: new Date() },
      { stagingId: 's2', runId: 'r1', harnessId: 'h1', type: 'FileConvention', content: 'c2', embedding: [0.2], relevanceTags: ['t2'], contentHash: 'hash2', createdAt: new Date() },
    ];
    memoryConnector.getStagingRecords.mockResolvedValue(records);

    await activities.mergeRunMemory('r1');

    // FF-07: mergeRecord called for each staging record
    expect(memoryConnector.mergeRecord).toHaveBeenCalledTimes(2);
    // ME-03: clearStaging called after merge
    expect(memoryConnector.clearStaging).toHaveBeenCalledWith('r1');
    // memory_merged audit event emitted
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'memory_merged',
        payload: { recordCount: 2 },
      }),
    );
  });

  it('mergeRunMemory skips when no staging records', async () => {
    memoryConnector.getStagingRecords.mockResolvedValue([]);
    await activities.mergeRunMemory('r1');
    expect(memoryConnector.mergeRecord).not.toHaveBeenCalled();
    expect(memoryConnector.clearStaging).not.toHaveBeenCalled();
    expect(auditLogger.log).not.toHaveBeenCalled();
  });
});
