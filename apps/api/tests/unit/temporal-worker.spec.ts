import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Module from 'module';
import path from 'path';

const { mockRun, mockWorkerCreate, mockNativeConnect } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({
    catch: vi.fn().mockReturnThis(),
  });
  return {
    mockRun,
    mockWorkerCreate: vi.fn().mockResolvedValue({ run: mockRun }),
    mockNativeConnect: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('@temporalio/worker', () => ({
  Worker: { create: mockWorkerCreate },
  NativeConnection: { connect: mockNativeConnect },
}));

// Intercept require.resolve so it can find finch.workflow (.ts) in the test context
const origResolveFilename = (Module as Record<string, unknown>)._resolveFilename as Function;
(Module as Record<string, unknown>)._resolveFilename = function (request: string, parent: { filename?: string }, ...rest: unknown[]) {
  if (request === './finch.workflow' && parent?.filename?.includes('temporal-worker.service')) {
    return path.resolve(__dirname, '../../src/workflow/finch.workflow.ts');
  }
  return origResolveFilename.call(this, request, parent, ...rest);
};

import { TemporalWorkerService } from '../../src/workflow/temporal-worker.service';
import { GateEvent } from '../../src/agents/gate-event';

describe('TemporalWorkerService', () => {
  const mockRunRepository = {
    markCompleted: vi.fn().mockResolvedValue(undefined),
  };
  const mockAuditRepository = {
    findByGateIdAndEventType: vi.fn().mockResolvedValue(null),
  };
  const mockAuditLogger = {
    log: vi.fn().mockResolvedValue(undefined),
  };
  const mockHarnessRepository = {};
  const mockGateController = {
    dispatch: vi.fn().mockResolvedValue(undefined),
  };
  const mockAgentDispatcher = {};
  const mockMemoryConnector = {
    mergeRecords: vi.fn().mockResolvedValue(undefined),
  };
  const mockTriggerAgent = {
    runTrigger: vi.fn(),
  };
  const mockAcquireAgent = {
    runAcquire: vi.fn(),
  };
  const mockPlanAgent = {
    runPlan: vi.fn(),
  };
  const mockExecuteAgent = {
    runExecute: vi.fn(),
  };
  const mockShipAgent = {
    runShip: vi.fn(),
  };

  let service: TemporalWorkerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TemporalWorkerService(
      mockRunRepository as never,
      mockAuditRepository as never,
      mockAuditLogger as never,
      mockHarnessRepository as never,
      mockGateController as never,
      mockAgentDispatcher as never,
      mockMemoryConnector as never,
      mockTriggerAgent as never,
      mockAcquireAgent as never,
      mockPlanAgent as never,
      mockExecuteAgent as never,
      mockShipAgent as never,
    );
  });

  afterEach(() => {
    delete process.env.TEMPORAL_ADDRESS;
  });

  it('is injectable and has onModuleInit', () => {
    expect(service).toBeDefined();
    expect(typeof service.onModuleInit).toBe('function');
  });

  it('connects to default address and starts worker on onModuleInit', async () => {
    delete process.env.TEMPORAL_ADDRESS;
    await service.onModuleInit();

    expect(mockNativeConnect).toHaveBeenCalledWith({ address: 'localhost:7233' });
    expect(mockWorkerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ taskQueue: 'finch' }),
    );
    expect(mockRun).toHaveBeenCalled();
  });

  it('uses TEMPORAL_ADDRESS env var when set', async () => {
    process.env.TEMPORAL_ADDRESS = 'custom:9876';
    await service.onModuleInit();
    expect(mockNativeConnect).toHaveBeenCalledWith({ address: 'custom:9876' });
  });

  it('passes workflowsPath from resolveWorkflowsPath to Worker.create', async () => {
    await service.onModuleInit();
    const createCall = mockWorkerCreate.mock.calls[0][0];
    expect(createCall.workflowsPath).toContain('finch.workflow');
  });

  it('resolveWorkflowsPath returns path containing finch.workflow', () => {
    const resolved = service.resolveWorkflowsPath();
    expect(resolved).toContain('finch.workflow');
  });

  it('worker.run() is detached (not awaited, with error handler)', async () => {
    await service.onModuleInit();
    expect(mockRun).toHaveBeenCalled();
    const catchFn = mockRun.mock.results[0].value.catch;
    expect(catchFn).toHaveBeenCalledWith(expect.any(Function));
  });

  it('calls process.exit(1) when worker crashes', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorHandler = vi.fn();
    mockRun.mockReturnValue({
      catch: vi.fn((handler: (err: Error) => void) => {
        errorHandler.mockImplementation(handler);
        return undefined;
      }),
    });

    await service.onModuleInit();
    errorHandler(new Error('worker died'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  describe('createActivities', () => {
    let activities: Record<string, Function>;

    beforeEach(async () => {
      await service.onModuleInit();
      activities = mockWorkerCreate.mock.calls[0][0].activities;
    });

    it('runTriggerPhase calls triggerAgent.runTrigger', async () => {
      mockTriggerAgent.runTrigger.mockResolvedValue({
        runId: 'r1', harnessId: 'h1', normalizedPrompt: 'fix', intent: 'bug', scope: [],
      });

      const rawInput = {
        rawText: 'fix it', runId: 'r1', harnessId: 'h1',
        source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
      };

      const result = await activities.runTriggerPhase(rawInput);
      expect(result.normalizedPrompt).toBe('fix');
      expect(mockTriggerAgent.runTrigger).toHaveBeenCalled();
    });

    it('runTriggerPhase handles GateEvent gracefully', async () => {
      mockTriggerAgent.runTrigger.mockResolvedValue(
        new GateEvent({
          phase: 'TRIGGER', runId: 'r1', harnessId: 'h1',
          gapDescription: 'gap', question: 'q',
          source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
          agentId: 'trigger-default', pipelinePosition: 0,
        }),
      );

      const rawInput = {
        rawText: 'vague', runId: 'r1', harnessId: 'h1',
        source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
      };

      const result = await activities.runTriggerPhase(rawInput);
      expect(result.normalizedPrompt).toBe('vague');
      expect(result.intent).toBe('unknown');
    });

    it('runAcquirePhase calls acquireAgent.runAcquire', async () => {
      mockAcquireAgent.runAcquire.mockResolvedValue({
        runId: 'r1', harnessId: 'h1', hasGap: false, files: ['a.ts'], dependencies: [],
      });

      const td = { runId: 'r1', harnessId: 'h1', normalizedPrompt: 'fix', intent: 'bug', scope: [] };
      const result = await activities.runAcquirePhase(td);
      expect(result.files).toEqual(['a.ts']);
    });

    it('runAcquirePhase dispatches gate on GateEvent', async () => {
      const gate = new GateEvent({
        phase: 'ACQUIRE', runId: 'r1', harnessId: 'h1',
        gapDescription: 'gap', question: 'q',
        source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
        agentId: 'acquire-default', pipelinePosition: 0,
      });
      mockAcquireAgent.runAcquire.mockResolvedValue(gate);

      const td = { runId: 'r1', harnessId: 'h1', normalizedPrompt: 'fix', intent: 'bug', scope: [] };
      const result = await activities.runAcquirePhase(td);
      expect(result.hasGap).toBe(true);
      expect(result.gapDescription).toBe('gap');
      expect(mockGateController.dispatch).toHaveBeenCalledWith(gate);
    });

    it('resumeAcquirePhase returns context with hasGap=false and gate answer in dependencies', async () => {
      const context = { runId: 'r1', harnessId: 'h1', hasGap: true, gapDescription: 'missing info', question: 'what?', gateId: 'g1', files: [], dependencies: ['dep1'] };
      const result = await activities.resumeAcquirePhase(context, { gateId: 'g1', requiresPhase: 'ACQUIRE', answer: 'the answer' });
      expect(result.hasGap).toBe(false);
      expect(result.gapDescription).toBeUndefined();
      expect(result.question).toBeUndefined();
      expect(result.gateId).toBeUndefined();
      expect(result.dependencies).toEqual(['dep1', '[Gate Answer]: the answer']);
    });

    it('runPlanPhase calls planAgent.runPlan', async () => {
      mockPlanAgent.runPlan.mockResolvedValue({
        runId: 'r1', hasGap: false, steps: ['step1'],
      });

      const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
      const result = await activities.runPlanPhase(context);
      expect(result.steps).toEqual(['step1']);
    });

    it('runPlanPhase dispatches gate on GateEvent', async () => {
      const gate = new GateEvent({
        phase: 'PLAN', runId: 'r1', harnessId: 'h1',
        gapDescription: 'gap', question: 'q',
        source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
        agentId: 'plan-default', pipelinePosition: 0,
      });
      mockPlanAgent.runPlan.mockResolvedValue(gate);

      const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
      const result = await activities.runPlanPhase(context);
      expect(result.hasGap).toBe(true);
      expect(mockGateController.dispatch).toHaveBeenCalled();
    });

    it('resumePlanPhase returns plan with hasGap=false and gate answer in steps', async () => {
      const plan = { runId: 'r1', hasGap: true, gapDescription: 'missing', question: 'what?', gateId: 'g1', steps: ['step1'] };
      const result = await activities.resumePlanPhase(plan, { gateId: 'g1', requiresPhase: 'PLAN', answer: 'plan answer' });
      expect(result.hasGap).toBe(false);
      expect(result.gapDescription).toBeUndefined();
      expect(result.question).toBeUndefined();
      expect(result.gateId).toBeUndefined();
      expect(result.steps).toEqual(['step1', '[Gate Answer]: plan answer']);
    });

    it('runExecutePhase calls executeAgent.runExecute', async () => {
      mockExecuteAgent.runExecute.mockResolvedValue({
        runId: 'r1', hasGap: false, allPassing: true, results: ['ok'],
      });

      const plan = { runId: 'r1', hasGap: false, steps: ['step1'] };
      const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
      const result = await activities.runExecutePhase(plan, context);
      expect(result.allPassing).toBe(true);
    });

    it('runExecutePhase dispatches gate on GateEvent', async () => {
      const gate = new GateEvent({
        phase: 'EXECUTE', runId: 'r1', harnessId: 'h1',
        gapDescription: 'gap', question: 'q',
        source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
        agentId: 'execute-default', pipelinePosition: 0,
      });
      mockExecuteAgent.runExecute.mockResolvedValue(gate);

      const plan = { runId: 'r1', hasGap: false, steps: [] };
      const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
      const result = await activities.runExecutePhase(plan, context);
      expect(result.hasGap).toBe(true);
      expect(mockGateController.dispatch).toHaveBeenCalled();
    });

    it('resumeExecutePhase returns report with hasGap=false and gate answer in results', async () => {
      const report = { runId: 'r1', hasGap: true, gapDescription: 'gap', question: 'q?', gateId: 'g1', allPassing: false, results: ['result1'] };
      const result = await activities.resumeExecutePhase(report, { gateId: 'g1', requiresPhase: 'EXECUTE', answer: 'exec answer' });
      expect(result.hasGap).toBe(false);
      expect(result.gapDescription).toBeUndefined();
      expect(result.question).toBeUndefined();
      expect(result.gateId).toBeUndefined();
      expect(result.results).toEqual(['result1', '[Gate Answer]: exec answer']);
    });

    it('runShipPhase calls shipAgent.runShip', async () => {
      mockShipAgent.runShip.mockResolvedValue({ repoId: 'repo1', commitSha: 'abc123' });

      const plan = { runId: 'r1', hasGap: false, steps: [] };
      const report = { runId: 'r1', hasGap: false, allPassing: true, results: [] };
      const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
      const result = await activities.runShipPhase(plan, report, context, 'repo1');
      expect(result.commitSha).toBe('abc123');
    });

    it('runShipPhase throws when ShipAgent returns GateEvent (FF-06)', async () => {
      mockShipAgent.runShip.mockResolvedValue(
        new GateEvent({
          phase: 'SHIP', runId: 'r1', harnessId: 'h1',
          gapDescription: 'gap', question: 'q',
          source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
          agentId: 'ship-default', pipelinePosition: 0,
        }),
      );

      const plan = { runId: 'r1', hasGap: false, steps: [] };
      const report = { runId: 'r1', hasGap: false, allPassing: true, results: [] };
      const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
      await expect(activities.runShipPhase(plan, report, context, 'repo1'))
        .rejects.toThrow('ShipAgent returned GateEvent — this violates FF-06');
    });

    it('aggregateShipResults calls markCompleted', async () => {
      await activities.aggregateShipResults('r1', []);
      expect(mockRunRepository.markCompleted).toHaveBeenCalledWith('r1');
    });

    it('getRegisteredRepos returns default repo', async () => {
      const result = await activities.getRegisteredRepos('h1');
      expect(result).toEqual([{ repoId: 'default-repo' }]);
    });

    it('mergeRunMemory calls memoryConnector.mergeRecords', async () => {
      await activities.mergeRunMemory('r1');
      expect(mockMemoryConnector.mergeRecords).toHaveBeenCalledWith('r1');
    });

    it('markRunCompleted calls runRepository.markCompleted', async () => {
      await activities.markRunCompleted('r1');
      expect(mockRunRepository.markCompleted).toHaveBeenCalledWith('r1');
    });

    it('logTraversalEvent logs when no existing event', async () => {
      mockAuditRepository.findByGateIdAndEventType.mockResolvedValue(null);
      await activities.logTraversalEvent({
        gateId: 'g1', runId: 'r1', fromPhase: 'PLAN', toPhase: 'ACQUIRE',
      });
      expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'gate_traversal_backward',
      }));
    });

    it('logTraversalEvent deduplicates when event already exists', async () => {
      mockAuditRepository.findByGateIdAndEventType.mockResolvedValue({ id: 1 });
      await activities.logTraversalEvent({
        gateId: 'g1', runId: 'r1', fromPhase: 'PLAN', toPhase: 'ACQUIRE',
      });
      expect(mockAuditLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('buildDefaultSource', () => {
    it('returns a TriggerSource with webhook type', () => {
      const source = (service as never as Record<string, Function>).buildDefaultSource('r1');
      expect(source.type).toBe('webhook');
      expect(source.channelId).toBe('webhook');
      expect(source.messageId).toBe('r1');
    });
  });

  describe('buildAgentContext', () => {
    it('returns a valid AgentContext', () => {
      const source = { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' };
      const ctx = (service as never as Record<string, Function>).buildAgentContext('r1', 'h1', 'ACQUIRE', source);
      expect(ctx.runId).toBe('r1');
      expect(ctx.harnessId).toBe('h1');
      expect(ctx.phase).toBe('ACQUIRE');
      expect(ctx.agentConfig.agentId).toBe('acquire-default');
      expect(ctx.pipelinePosition).toBe(0);
    });
  });
});
