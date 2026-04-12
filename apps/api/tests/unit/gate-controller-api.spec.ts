import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GateController } from '../../src/api/gate.controller';

describe('GateController', () => {
  const mockGateControllerService = {
    resolve: vi.fn(),
    runRepository: { findById: vi.fn() },
  };
  const mockGateRepository = {
    findById: vi.fn(),
  };
  const mockWorkflowClient = {
    getHandle: vi.fn(),
  };

  let controller: GateController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new GateController(
      mockGateControllerService as never,
      mockGateRepository as never,
      mockWorkflowClient as never,
    );
  });

  it('respond resolves gate and signals Temporal workflow', async () => {
    const resolution = { gateId: 'g1', requiresPhase: 'ACQUIRE', answer: 'the answer' };
    mockGateControllerService.resolve.mockResolvedValue(resolution);
    mockGateRepository.findById.mockResolvedValue({ gateId: 'g1', runId: 'r1' });
    mockGateControllerService.runRepository.findById.mockResolvedValue({
      runId: 'r1',
      temporalWorkflowId: 'finch-r1',
    });
    const mockHandle = { signal: vi.fn().mockResolvedValue(undefined) };
    mockWorkflowClient.getHandle.mockReturnValue(mockHandle);

    const result = await controller.respond('g1', { answer: 'the answer' });

    expect(mockGateControllerService.resolve).toHaveBeenCalledWith('g1', 'the answer');
    expect(mockWorkflowClient.getHandle).toHaveBeenCalledWith('finch-r1');
    expect(mockHandle.signal).toHaveBeenCalledWith('gateResolution', resolution);
    expect(result).toEqual({ data: resolution });
  });

  it('respond handles gate not found in repository after resolve', async () => {
    const resolution = { gateId: 'g1', requiresPhase: 'ACQUIRE', answer: 'ans' };
    mockGateControllerService.resolve.mockResolvedValue(resolution);
    mockGateRepository.findById.mockResolvedValue(null);

    const result = await controller.respond('g1', { answer: 'ans' });
    expect(result).toEqual({ data: resolution });
    expect(mockWorkflowClient.getHandle).not.toHaveBeenCalled();
  });

  it('respond handles run without temporalWorkflowId', async () => {
    const resolution = { gateId: 'g1', requiresPhase: 'PLAN', answer: 'ans' };
    mockGateControllerService.resolve.mockResolvedValue(resolution);
    mockGateRepository.findById.mockResolvedValue({ gateId: 'g1', runId: 'r1' });
    mockGateControllerService.runRepository.findById.mockResolvedValue({
      runId: 'r1',
      temporalWorkflowId: null,
    });

    const result = await controller.respond('g1', { answer: 'ans' });
    expect(result).toEqual({ data: resolution });
    expect(mockWorkflowClient.getHandle).not.toHaveBeenCalled();
  });

  it('respond handles run not found', async () => {
    const resolution = { gateId: 'g1', requiresPhase: 'ACQUIRE', answer: 'ans' };
    mockGateControllerService.resolve.mockResolvedValue(resolution);
    mockGateRepository.findById.mockResolvedValue({ gateId: 'g1', runId: 'r1' });
    mockGateControllerService.runRepository.findById.mockResolvedValue(null);

    const result = await controller.respond('g1', { answer: 'ans' });
    expect(result).toEqual({ data: resolution });
    expect(mockWorkflowClient.getHandle).not.toHaveBeenCalled();
  });
});
