import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock reflect-metadata before anything else
vi.mock('reflect-metadata', () => ({}));

const mockListen = vi.fn().mockResolvedValue(undefined);
const mockUseLogger = vi.fn();
const mockGet = vi.fn().mockReturnValue('mock-logger');

vi.mock('@nestjs/core', () => ({
  NestFactory: {
    create: vi.fn().mockResolvedValue({
      useLogger: mockUseLogger,
      get: mockGet,
      listen: mockListen,
    }),
  },
}));

vi.mock('nestjs-pino', () => ({
  Logger: class MockLogger {},
}));

vi.mock('../../src/app.module', () => ({
  AppModule: class MockAppModule {},
}));

describe('main.ts bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create the NestJS app, set logger, and listen on port 3001', async () => {
    await import('../../src/main');

    const { NestFactory } = await import('@nestjs/core');
    expect(NestFactory.create).toHaveBeenCalledOnce();
    expect(mockUseLogger).toHaveBeenCalledOnce();
    expect(mockGet).toHaveBeenCalledOnce();
    expect(mockListen).toHaveBeenCalledWith(3001);
  });
});
