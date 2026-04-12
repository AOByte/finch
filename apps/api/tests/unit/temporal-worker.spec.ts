import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRun, mockWorkerCreate, mockNativeConnect, mockCreateStubActivities } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({
    catch: vi.fn().mockReturnThis(),
  });
  return {
    mockRun,
    mockWorkerCreate: vi.fn().mockResolvedValue({ run: mockRun }),
    mockNativeConnect: vi.fn().mockResolvedValue({}),
    mockCreateStubActivities: vi.fn((deps: Record<string, unknown>) => ({ ...deps, stubbed: true })),
  };
});

vi.mock('@temporalio/worker', () => ({
  Worker: { create: mockWorkerCreate },
  NativeConnection: { connect: mockNativeConnect },
}));

vi.mock('../../src/workflow/stub-activities', () => ({
  createStubActivities: mockCreateStubActivities,
}));

import { TemporalWorkerService } from '../../src/workflow/temporal-worker.service';
import { RunRepository } from '../../src/persistence/run.repository';

describe('TemporalWorkerService', () => {
  let service: TemporalWorkerService;
  let runRepo: { markCompleted: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    runRepo = { markCompleted: vi.fn() };
    service = new TemporalWorkerService(runRepo as unknown as RunRepository);
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
      expect.objectContaining({
        taskQueue: 'finch',
      }),
    );
    expect(mockRun).toHaveBeenCalled();
  });

  it('uses TEMPORAL_ADDRESS env var when set', async () => {
    process.env.TEMPORAL_ADDRESS = 'custom:9876';
    await service.onModuleInit();

    expect(mockNativeConnect).toHaveBeenCalledWith({ address: 'custom:9876' });
  });

  it('creates activities with markRunCompletedInDb callback', async () => {
    await service.onModuleInit();

    expect(mockCreateStubActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        markRunCompletedInDb: expect.any(Function),
      }),
    );

    // Exercise the callback
    const call = mockCreateStubActivities.mock.calls[0][0];
    await call.markRunCompletedInDb('test-run-id');
    expect(runRepo.markCompleted).toHaveBeenCalledWith('test-run-id');
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
});
