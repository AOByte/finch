import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GateControllerService } from '../../src/orchestrator/gate-controller.service';
import { GateEvent } from '../../src/agents/gate-event';

describe('GateControllerService', () => {
  const mockGateRepository = {
    create: vi.fn().mockResolvedValue({}),
    findById: vi.fn(),
    saveResolution: vi.fn().mockResolvedValue(undefined),
  };
  const mockRunRepository = {
    updateStatus: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn(),
  };
  const mockAuditLogger = {
    log: vi.fn().mockResolvedValue(undefined),
  };
  const mockLLMRegistry = {
    get: vi.fn().mockReturnValue({ complete: vi.fn() }),
  };
  const mockGateTimeoutQueue = {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
  };

  let service: GateControllerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GateControllerService(
      mockGateRepository as never,
      mockRunRepository as never,
      mockAuditLogger as never,
      mockLLMRegistry as never,
      mockGateTimeoutQueue as never,
    );
  });

  describe('setTriggerConnector', () => {
    it('sets the trigger connector', () => {
      const connector = { sendMessage: vi.fn() };
      service.setTriggerConnector(connector as never);
      // No throw means success
    });
  });

  describe('dispatch', () => {
    it('dispatches a gate event with all audit and persistence', async () => {
      const gateEvent = new GateEvent({
        phase: 'ACQUIRE', runId: 'r1', harnessId: 'h1',
        gapDescription: 'missing', question: 'what?',
        source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
        agentId: 'a1', pipelinePosition: 0, temporalWorkflowId: 'wf-1',
      });

      await service.dispatch(gateEvent);

      expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'gate_fired' }));
      expect(mockGateRepository.create).toHaveBeenCalled();
      expect(mockRunRepository.updateStatus).toHaveBeenCalledWith('r1', 'WAITING_FOR_HUMAN');
      expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'gate_question_sent' }));
      expect(mockGateTimeoutQueue.add).toHaveBeenCalled();
    });

    it('sends message via trigger connector when set', async () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      service.setTriggerConnector({ sendMessage } as never);

      const gateEvent = new GateEvent({
        phase: 'ACQUIRE', runId: 'r1', harnessId: 'h1',
        gapDescription: 'missing', question: 'what?',
        source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
        agentId: 'a1', pipelinePosition: 0,
      });

      await service.dispatch(gateEvent);
      expect(sendMessage).toHaveBeenCalledWith({
        channelId: 'c', threadTs: 't', message: 'what?',
      });
    });

    it('handles dispatch without trigger connector', async () => {
      const gateEvent = new GateEvent({
        phase: 'PLAN', runId: 'r2', harnessId: 'h2',
        gapDescription: 'gap', question: 'q',
        source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
        agentId: 'a2', pipelinePosition: 1,
      });

      await service.dispatch(gateEvent);
      expect(mockGateRepository.create).toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('throws NotFoundException when gate not found', async () => {
      mockGateRepository.findById.mockResolvedValue(null);
      await expect(service.resolve('g1', 'answer')).rejects.toThrow(NotFoundException);
    });

    it('resolves ACQUIRE gate without LLM call', async () => {
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE',
      });

      const result = await service.resolve('g1', 'The answer is here');
      expect(result.gateId).toBe('g1');
      expect(result.requiresPhase).toBe('ACQUIRE');
      expect(result.answer).toBe('The answer is here');
      expect(mockLLMRegistry.get).not.toHaveBeenCalled();
      expect(mockGateRepository.saveResolution).toHaveBeenCalled();
      expect(mockRunRepository.updateStatus).toHaveBeenCalledWith('r1', 'RUNNING');
    });

    it('resolves PLAN gate with LLM classification', async () => {
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'PLAN',
      });
      const mockLLM = { complete: vi.fn().mockResolvedValue({ text: 'ACQUIRE' }) };
      mockLLMRegistry.get.mockReturnValue(mockLLM);

      const result = await service.resolve('g1', 'need more context');
      expect(result.requiresPhase).toBe('ACQUIRE');
      expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'gate_traversal_backward' }));
    });

    it('resolves PLAN gate staying in PLAN phase', async () => {
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'PLAN',
      });
      const mockLLM = { complete: vi.fn().mockResolvedValue({ text: 'PLAN' }) };
      mockLLMRegistry.get.mockReturnValue(mockLLM);

      const result = await service.resolve('g1', 'here is the plan detail');
      expect(result.requiresPhase).toBe('PLAN');
    });

    it('resolves EXECUTE gate with valid classification', async () => {
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'EXECUTE',
      });
      const mockLLM = { complete: vi.fn().mockResolvedValue({ text: 'EXECUTE' }) };
      mockLLMRegistry.get.mockReturnValue(mockLLM);

      const result = await service.resolve('g1', 'proceed with execution');
      expect(result.requiresPhase).toBe('EXECUTE');
    });

    it('falls back to current phase on invalid LLM response', async () => {
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'PLAN',
      });
      const mockLLM = { complete: vi.fn().mockResolvedValue({ text: 'INVALID' }) };
      mockLLMRegistry.get.mockReturnValue(mockLLM);

      const result = await service.resolve('g1', 'answer');
      expect(result.requiresPhase).toBe('PLAN');
    });

    it('falls back to current phase on LLM error', async () => {
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'EXECUTE',
      });
      const mockLLM = { complete: vi.fn().mockRejectedValue(new Error('LLM error')) };
      mockLLMRegistry.get.mockReturnValue(mockLLM);

      const result = await service.resolve('g1', 'answer');
      expect(result.requiresPhase).toBe('EXECUTE');
    });

    it('cancels timeout job if exists', async () => {
      const mockJob = { remove: vi.fn().mockResolvedValue(undefined) };
      mockGateTimeoutQueue.getJob.mockResolvedValue(mockJob);
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE',
      });

      await service.resolve('g1', 'answer');
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('handles missing timeout job gracefully', async () => {
      mockGateTimeoutQueue.getJob.mockResolvedValue(null);
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE',
      });

      await service.resolve('g1', 'answer');
      // No throw means success
    });

    it('does not log backward traversal when staying in same phase', async () => {
      mockGateRepository.findById.mockResolvedValue({
        gateId: 'g1', runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE',
      });

      await service.resolve('g1', 'answer');
      const backwardCalls = mockAuditLogger.log.mock.calls.filter(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === 'gate_traversal_backward',
      );
      expect(backwardCalls).toHaveLength(0);
    });
  });
});
