import { describe, it, expect } from 'vitest';
import { MemoryConnectorService } from '../../src/memory/memory-connector.service';

describe('MemoryConnectorService', () => {
  it('query returns empty array (stub)', async () => {
    const service = new MemoryConnectorService();
    const result = await service.query('h1', 'search text');
    expect(result).toEqual([]);
  });

  it('stageRecord resolves without error (stub)', async () => {
    const service = new MemoryConnectorService();
    await expect(
      service.stageRecord({
        runId: 'r1',
        harnessId: 'h1',
        type: 'decision',
        content: 'chose option A',
        relevanceTags: ['tag1'],
      }),
    ).resolves.toBeUndefined();
  });

  it('mergeRecords resolves without error (stub)', async () => {
    const service = new MemoryConnectorService();
    await expect(service.mergeRecords('r1')).resolves.toBeUndefined();
  });
});
