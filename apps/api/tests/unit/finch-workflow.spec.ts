import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @temporalio/workflow before importing the workflow
let signalHandlers: Record<string, (...args: unknown[]) => void> = {};
let conditionResolver: (() => boolean) | null = null;

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(() => mockActivities),
  defineSignal: vi.fn((name: string) => name),
  setHandler: vi.fn((signal: string, handler: (...args: unknown[]) => void) => {
    signalHandlers[signal] = handler;
  }),
  condition: vi.fn(async (fn: () => boolean) => {
    conditionResolver = fn;
    fn(); // exercise the predicate to ensure coverage
    return true;
  }),
}));

import { finchWorkflow } from '../../src/workflow/finch.workflow';
import type { RawTriggerInput } from '../../src/workflow/types';

const mockActivities = {
  runTriggerPhase: vi.fn(),
  runAcquirePhase: vi.fn(),
  resumeAcquirePhase: vi.fn(),
  runPlanPhase: vi.fn(),
  resumePlanPhase: vi.fn(),
  runExecutePhase: vi.fn(),
  resumeExecutePhase: vi.fn(),
  runShipPhase: vi.fn(),
  aggregateShipResults: vi.fn(),
  getRegisteredRepos: vi.fn(),
  mergeRunMemory: vi.fn(),
  markRunCompleted: vi.fn(),
  logTraversalEvent: vi.fn(),
};

const rawInput: RawTriggerInput = {
  rawText: 'test task',
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

describe('finchWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signalHandlers = {};
    conditionResolver = null;
  });

  it('completes all five phases with single repo (happy path)', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1',
      harnessId: 'h1',
      normalizedPrompt: 'test',
      intent: 'fix',
      scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1',
      harnessId: 'h1',
      hasGap: false,
      files: [],
      dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({
      runId: 'r1',
      hasGap: false,
      steps: ['step1'],
    });
    mockActivities.runExecutePhase.mockResolvedValue({
      runId: 'r1',
      hasGap: false,
      allPassing: true,
      results: [],
    });
    mockActivities.getRegisteredRepos.mockResolvedValue([
      { repoId: 'repo1' },
    ]);
    mockActivities.runShipPhase.mockResolvedValue({
      repoId: 'repo1',
      prUrl: 'url',
      commitSha: 'sha',
    });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    expect(mockActivities.runTriggerPhase).toHaveBeenCalledWith(rawInput);
    expect(mockActivities.runAcquirePhase).toHaveBeenCalled();
    expect(mockActivities.runPlanPhase).toHaveBeenCalled();
    expect(mockActivities.runExecutePhase).toHaveBeenCalled();
    expect(mockActivities.getRegisteredRepos).toHaveBeenCalledWith('h1');
    expect(mockActivities.runShipPhase).toHaveBeenCalled();
    expect(mockActivities.mergeRunMemory).toHaveBeenCalledWith('r1');
    expect(mockActivities.aggregateShipResults).toHaveBeenCalledWith('r1', [
      { repoId: 'repo1', status: 'success', result: { repoId: 'repo1', prUrl: 'url', commitSha: 'sha' } },
    ]);
  });

  it('completes with multi-repo fan-out', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({
      runId: 'r1', hasGap: false, steps: [],
    });
    mockActivities.runExecutePhase.mockResolvedValue({
      runId: 'r1', hasGap: false, allPassing: true, results: [],
    });
    mockActivities.getRegisteredRepos.mockResolvedValue([
      { repoId: 'repo1' },
      { repoId: 'repo2' },
    ]);
    mockActivities.runShipPhase.mockResolvedValue({
      repoId: 'repo1', prUrl: 'url', commitSha: 'sha',
    });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    expect(mockActivities.runShipPhase).toHaveBeenCalledTimes(2);
    expect(mockActivities.aggregateShipResults).toHaveBeenCalled();
  });

  it('handles multi-repo fan-out with failed ship', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({
      runId: 'r1', hasGap: false, steps: [],
    });
    mockActivities.runExecutePhase.mockResolvedValue({
      runId: 'r1', hasGap: false, allPassing: true, results: [],
    });
    mockActivities.getRegisteredRepos.mockResolvedValue([
      { repoId: 'repo1' },
      { repoId: 'repo2' },
    ]);
    // First repo succeeds, second fails
    mockActivities.runShipPhase
      .mockResolvedValueOnce({ repoId: 'repo1', prUrl: 'url', commitSha: 'sha' })
      .mockRejectedValueOnce(new Error('deploy failed'));
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    const call = mockActivities.aggregateShipResults.mock.calls[0];
    expect(call[0]).toBe('r1');
    expect(call[1]).toHaveLength(2);
    expect(call[1][0].status).toBe('success');
    expect(call[1][1].status).toBe('failed');
    expect(call[1][1].error).toBe('deploy failed');
  });

  it('returns STOPPED after TRIGGER when stopRunSignal is fired', async () => {
    mockActivities.runTriggerPhase.mockImplementation(async () => {
      // Fire stop signal during trigger
      signalHandlers['stop_run']();
      return {
        runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
      };
    });

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'STOPPED', phase: 'TRIGGER' });
  });

  it('returns STOPPED during ACQUIRE gap loop', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: true, files: [], dependencies: [],
    });

    // Stop before gate resolution
    mockActivities.runAcquirePhase.mockImplementation(async () => {
      signalHandlers['stop_run']();
      return { runId: 'r1', harnessId: 'h1', hasGap: true, files: [], dependencies: [] };
    });

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'STOPPED', phase: 'ACQUIRE' });
  });

  it('handles ACQUIRE gate with ACQUIRE resolution (same-phase traversal)', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });

    let acquireCallCount = 0;
    mockActivities.runAcquirePhase.mockImplementation(async () => {
      acquireCallCount++;
      return { runId: 'r1', harnessId: 'h1', hasGap: acquireCallCount === 1, files: [], dependencies: [] };
    });

    // Mock condition to resolve gate immediately — also call fn() to cover the predicate
    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async (fn: () => boolean) => {
      fn(); // exercise the predicate for coverage
      signalHandlers['gate_resolved']({
        gateId: 'g1', requiresPhase: 'ACQUIRE', answer: 'yes',
      });
      return true;
    });

    mockActivities.resumeAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.logTraversalEvent.mockResolvedValue(undefined);
    mockActivities.runPlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: [] });
    mockActivities.runExecutePhase.mockResolvedValue({ runId: 'r1', hasGap: false, allPassing: true, results: [] });
    mockActivities.getRegisteredRepos.mockResolvedValue([{ repoId: 'repo1' }]);
    mockActivities.runShipPhase.mockResolvedValue({ repoId: 'repo1' });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    expect(mockActivities.logTraversalEvent).toHaveBeenCalledWith({
      runId: 'r1', gateId: 'g1', fromPhase: 'ACQUIRE', toPhase: 'ACQUIRE',
    });
    expect(mockActivities.resumeAcquirePhase).toHaveBeenCalled();
  });

  it('handles ACQUIRE gate with non-ACQUIRE resolution (no traversal log)', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });

    let acquireCallCount = 0;
    mockActivities.runAcquirePhase.mockImplementation(async () => {
      acquireCallCount++;
      return { runId: 'r1', harnessId: 'h1', hasGap: acquireCallCount === 1, files: [], dependencies: [] };
    });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      signalHandlers['gate_resolved']({
        gateId: 'g1', requiresPhase: 'PLAN', answer: 'skip to plan',
      });
      return true;
    });

    mockActivities.resumeAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.logTraversalEvent.mockResolvedValue(undefined);
    mockActivities.runPlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: [] });
    mockActivities.runExecutePhase.mockResolvedValue({ runId: 'r1', hasGap: false, allPassing: true, results: [] });
    mockActivities.getRegisteredRepos.mockResolvedValue([{ repoId: 'repo1' }]);
    mockActivities.runShipPhase.mockResolvedValue({ repoId: 'repo1' });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    // logTraversalEvent should NOT have been called because requiresPhase !== 'ACQUIRE'
    expect(mockActivities.logTraversalEvent).not.toHaveBeenCalled();
    expect(mockActivities.resumeAcquirePhase).toHaveBeenCalled();
  });

  it('handles PLAN gate with ACQUIRE backward traversal', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValueOnce({
      runId: 'r1', hasGap: true, steps: [],
    });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      signalHandlers['gate_resolved']({
        gateId: 'g2', requiresPhase: 'ACQUIRE', answer: 'more context',
      });
      return true;
    });

    mockActivities.logTraversalEvent.mockResolvedValue(undefined);
    mockActivities.resumeAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    // After backward traversal, re-run plan with no gap
    mockActivities.runPlanPhase.mockResolvedValueOnce({
      runId: 'r1', hasGap: false, steps: ['new-step'],
    });
    mockActivities.runExecutePhase.mockResolvedValue({ runId: 'r1', hasGap: false, allPassing: true, results: [] });
    mockActivities.getRegisteredRepos.mockResolvedValue([{ repoId: 'repo1' }]);
    mockActivities.runShipPhase.mockResolvedValue({ repoId: 'repo1' });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    expect(mockActivities.logTraversalEvent).toHaveBeenCalledWith({
      runId: 'r1', gateId: 'g2', fromPhase: 'PLAN', toPhase: 'ACQUIRE',
    });
  });

  it('handles PLAN gate with PLAN same-phase resolution', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValueOnce({ runId: 'r1', hasGap: true, steps: [] });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      signalHandlers['gate_resolved']({
        gateId: 'g3', requiresPhase: 'PLAN', answer: 'revised plan',
      });
      return true;
    });

    mockActivities.logTraversalEvent.mockResolvedValue(undefined);
    mockActivities.resumePlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: ['revised'] });
    mockActivities.runExecutePhase.mockResolvedValue({ runId: 'r1', hasGap: false, allPassing: true, results: [] });
    mockActivities.getRegisteredRepos.mockResolvedValue([{ repoId: 'repo1' }]);
    mockActivities.runShipPhase.mockResolvedValue({ repoId: 'repo1' });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    expect(mockActivities.logTraversalEvent).toHaveBeenCalledWith({
      runId: 'r1', gateId: 'g3', fromPhase: 'PLAN', toPhase: 'PLAN',
    });
    expect(mockActivities.resumePlanPhase).toHaveBeenCalled();
  });

  it('returns STOPPED during PLAN gap loop', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockImplementation(async () => {
      signalHandlers['stop_run']();
      return { runId: 'r1', hasGap: true, steps: [] };
    });

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'STOPPED', phase: 'PLAN' });
  });

  it('handles EXECUTE gate with ACQUIRE backward traversal', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: [] });
    mockActivities.runExecutePhase.mockResolvedValueOnce({ runId: 'r1', hasGap: true, allPassing: false, results: [] });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      signalHandlers['gate_resolved']({
        gateId: 'g4', requiresPhase: 'ACQUIRE', answer: 'need more info',
      });
      return true;
    });

    mockActivities.logTraversalEvent.mockResolvedValue(undefined);
    mockActivities.resumeAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValueOnce({ runId: 'r1', hasGap: false, steps: [] });
    mockActivities.runExecutePhase.mockResolvedValueOnce({ runId: 'r1', hasGap: false, allPassing: true, results: [] });
    mockActivities.getRegisteredRepos.mockResolvedValue([{ repoId: 'repo1' }]);
    mockActivities.runShipPhase.mockResolvedValue({ repoId: 'repo1' });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    expect(mockActivities.logTraversalEvent).toHaveBeenCalledWith({
      runId: 'r1', gateId: 'g4', fromPhase: 'EXECUTE', toPhase: 'ACQUIRE',
    });
  });

  it('handles EXECUTE gate with PLAN backward traversal', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: [] });
    mockActivities.runExecutePhase.mockResolvedValueOnce({ runId: 'r1', hasGap: true, allPassing: false, results: [] });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      signalHandlers['gate_resolved']({
        gateId: 'g5', requiresPhase: 'PLAN', answer: 'revise plan',
      });
      return true;
    });

    mockActivities.logTraversalEvent.mockResolvedValue(undefined);
    mockActivities.resumePlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: ['new'] });
    mockActivities.runExecutePhase.mockResolvedValueOnce({ runId: 'r1', hasGap: false, allPassing: true, results: [] });
    mockActivities.getRegisteredRepos.mockResolvedValue([{ repoId: 'repo1' }]);
    mockActivities.runShipPhase.mockResolvedValue({ repoId: 'repo1' });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    expect(mockActivities.logTraversalEvent).toHaveBeenCalledWith({
      runId: 'r1', gateId: 'g5', fromPhase: 'EXECUTE', toPhase: 'PLAN',
    });
  });

  it('handles EXECUTE gate with EXECUTE same-phase resolution', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: [] });
    mockActivities.runExecutePhase.mockResolvedValueOnce({ runId: 'r1', hasGap: true, allPassing: false, results: [] });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      signalHandlers['gate_resolved']({
        gateId: 'g6', requiresPhase: 'EXECUTE', answer: 're-execute',
      });
      return true;
    });

    mockActivities.logTraversalEvent.mockResolvedValue(undefined);
    mockActivities.resumeExecutePhase.mockResolvedValue({ runId: 'r1', hasGap: false, allPassing: true, results: [] });
    mockActivities.getRegisteredRepos.mockResolvedValue([{ repoId: 'repo1' }]);
    mockActivities.runShipPhase.mockResolvedValue({ repoId: 'repo1' });
    mockActivities.mergeRunMemory.mockResolvedValue(undefined);
    mockActivities.aggregateShipResults.mockResolvedValue(undefined);

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'COMPLETED' });
    expect(mockActivities.logTraversalEvent).toHaveBeenCalledWith({
      runId: 'r1', gateId: 'g6', fromPhase: 'EXECUTE', toPhase: 'EXECUTE',
    });
    expect(mockActivities.resumeExecutePhase).toHaveBeenCalled();
  });

  it('returns STOPPED during EXECUTE gap loop', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: [] });
    mockActivities.runExecutePhase.mockImplementation(async () => {
      signalHandlers['stop_run']();
      return { runId: 'r1', hasGap: true, allPassing: false, results: [] };
    });

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'STOPPED', phase: 'EXECUTE' });
  });

  it('handles gate timeout (null resolution)', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: true, files: [], dependencies: [],
    });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockResolvedValue(false);

    await expect(finchWorkflow(rawInput)).rejects.toThrow('Gate timeout for run r1');
  });

  it('returns STOPPED after ACQUIRE gate resolution when stop fired during wait', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: true, files: [], dependencies: [],
    });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      // Fire stop and gate resolved simultaneously
      signalHandlers['stop_run']();
      signalHandlers['gate_resolved']({
        gateId: 'g1', requiresPhase: 'ACQUIRE', answer: 'yes',
      });
      return true;
    });

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'STOPPED', phase: 'ACQUIRE' });
  });

  it('returns STOPPED after PLAN gate resolution when stop fired during wait', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({ runId: 'r1', hasGap: true, steps: [] });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      signalHandlers['stop_run']();
      signalHandlers['gate_resolved']({
        gateId: 'g1', requiresPhase: 'PLAN', answer: 'yes',
      });
      return true;
    });

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'STOPPED', phase: 'PLAN' });
  });

  it('returns STOPPED after EXECUTE gate resolution when stop fired during wait', async () => {
    mockActivities.runTriggerPhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'test', intent: 'fix', scope: [],
    });
    mockActivities.runAcquirePhase.mockResolvedValue({
      runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [],
    });
    mockActivities.runPlanPhase.mockResolvedValue({ runId: 'r1', hasGap: false, steps: [] });
    mockActivities.runExecutePhase.mockResolvedValue({ runId: 'r1', hasGap: true, allPassing: false, results: [] });

    const { condition: mockCondition } = await import('@temporalio/workflow');
    vi.mocked(mockCondition).mockImplementation(async () => {
      signalHandlers['stop_run']();
      signalHandlers['gate_resolved']({
        gateId: 'g1', requiresPhase: 'EXECUTE', answer: 'yes',
      });
      return true;
    });

    const result = await finchWorkflow(rawInput);
    expect(result).toEqual({ status: 'STOPPED', phase: 'EXECUTE' });
  });
});
