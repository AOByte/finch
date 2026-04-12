import { describe, it, expect, vi } from 'vitest';
import { createStubActivities } from '../../src/workflow/stub-activities';

describe('createStubActivities', () => {
  const markRunCompletedInDb = vi.fn().mockResolvedValue(undefined);
  const activities = createStubActivities({ markRunCompletedInDb });

  it('runTriggerPhase returns TaskDescriptor from rawInput', async () => {
    const rawInput = {
      rawText: 'fix bug',
      source: {
        type: 'slack',
        channelId: 'C1',
        messageId: 'M1',
        threadTs: 'T1',
        authorId: 'U1',
        timestamp: '2026-01-01T00:00:00Z',
      },
      harnessId: 'h1',
      runId: 'r1',
    };
    const result = await activities.runTriggerPhase(rawInput);
    expect(result.runId).toBe('r1');
    expect(result.harnessId).toBe('h1');
    expect(result.normalizedPrompt).toBe('fix bug');
    expect(result.intent).toBe('stub-intent');
    expect(result.scope).toEqual(['stub-scope']);
  });

  it('runAcquirePhase returns ContextObject with hasGap false', async () => {
    const td = {
      runId: 'r1',
      harnessId: 'h1',
      normalizedPrompt: 'test',
      intent: 'fix',
      scope: [],
    };
    const result = await activities.runAcquirePhase(td);
    expect(result.hasGap).toBe(false);
    expect(result.runId).toBe('r1');
    expect(result.files).toEqual([]);
  });

  it('resumeAcquirePhase returns context with hasGap false', async () => {
    const ctx = {
      runId: 'r1',
      harnessId: 'h1',
      hasGap: true,
      files: [],
      dependencies: [],
    };
    const resolution = {
      gateId: 'g1',
      requiresPhase: 'ACQUIRE' as const,
      answer: 'yes',
    };
    const result = await activities.resumeAcquirePhase(ctx, resolution);
    expect(result.hasGap).toBe(false);
  });

  it('runPlanPhase returns PlanArtifact with hasGap false', async () => {
    const ctx = {
      runId: 'r1',
      harnessId: 'h1',
      hasGap: false,
      files: [],
      dependencies: [],
    };
    const result = await activities.runPlanPhase(ctx);
    expect(result.hasGap).toBe(false);
    expect(result.runId).toBe('r1');
    expect(result.steps).toEqual(['stub-step']);
  });

  it('resumePlanPhase returns plan with hasGap false', async () => {
    const plan = { runId: 'r1', hasGap: true, steps: [] };
    const resolution = {
      gateId: 'g1',
      requiresPhase: 'PLAN' as const,
      answer: 'yes',
    };
    const result = await activities.resumePlanPhase(plan, resolution);
    expect(result.hasGap).toBe(false);
  });

  it('runExecutePhase returns VerificationReport with hasGap false and allPassing true', async () => {
    const plan = { runId: 'r1', hasGap: false, steps: [] };
    const ctx = {
      runId: 'r1',
      harnessId: 'h1',
      hasGap: false,
      files: [],
      dependencies: [],
    };
    const result = await activities.runExecutePhase(plan, ctx);
    expect(result.hasGap).toBe(false);
    expect(result.allPassing).toBe(true);
    expect(result.runId).toBe('r1');
  });

  it('resumeExecutePhase returns report with hasGap false', async () => {
    const report = {
      runId: 'r1',
      hasGap: true,
      allPassing: false,
      results: [],
    };
    const resolution = {
      gateId: 'g1',
      requiresPhase: 'EXECUTE' as const,
      answer: 'yes',
    };
    const result = await activities.resumeExecutePhase(report, resolution);
    expect(result.hasGap).toBe(false);
  });

  it('runShipPhase returns ShipResult', async () => {
    const plan = { runId: 'r1', hasGap: false, steps: [] };
    const report = {
      runId: 'r1',
      hasGap: false,
      allPassing: true,
      results: [],
    };
    const ctx = {
      runId: 'r1',
      harnessId: 'h1',
      hasGap: false,
      files: [],
      dependencies: [],
    };
    const result = await activities.runShipPhase(plan, report, ctx, 'my-repo');
    expect(result.repoId).toBe('my-repo');
    expect(result.prUrl).toBe('https://stub-pr-url');
    expect(result.commitSha).toBe('stub-sha');
  });

  it('aggregateShipResults calls markRunCompletedInDb', async () => {
    markRunCompletedInDb.mockClear();
    await activities.aggregateShipResults('r1', []);
    expect(markRunCompletedInDb).toHaveBeenCalledWith('r1');
  });

  it('getRegisteredRepos returns stub repo', async () => {
    const result = await activities.getRegisteredRepos('h1');
    expect(result).toEqual([{ repoId: 'stub-repo' }]);
  });

  it('mergeRunMemory is a no-op', async () => {
    await expect(activities.mergeRunMemory('r1')).resolves.toBeUndefined();
  });

  it('markRunCompleted calls markRunCompletedInDb', async () => {
    markRunCompletedInDb.mockClear();
    await activities.markRunCompleted('r1');
    expect(markRunCompletedInDb).toHaveBeenCalledWith('r1');
  });

  it('logTraversalEvent is a no-op', async () => {
    await expect(
      activities.logTraversalEvent({
        runId: 'r1',
        gateId: 'g1',
        fromPhase: 'PLAN',
        toPhase: 'ACQUIRE',
      }),
    ).resolves.toBeUndefined();
  });
});
