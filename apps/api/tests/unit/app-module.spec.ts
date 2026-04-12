import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/persistence/prisma.service';
import { TemporalWorkerService } from '../../src/workflow/temporal-worker.service';
import { WorkflowClient } from '@temporalio/client';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
// Mock ioredis to prevent BullMQ from connecting to Redis
vi.mock('ioredis', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events');
  class MockRedis extends EventEmitter {
    status = 'ready';
    connect() { return Promise.resolve(); }
    disconnect() { return Promise.resolve(); }
    quit() { return Promise.resolve('OK'); }
    subscribe() { return Promise.resolve(); }
    duplicate() { return new MockRedis(); }
    defineCommand() { /* no-op */ }
    options = {};
  }
  return { default: MockRedis, Redis: MockRedis };
});

// Mock redis to prevent REDIS_PUBLISHER factory from connecting
vi.mock('redis', () => ({
  createClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }),
}));

const mockPrisma = {
  $connect: vi.fn(),
  $disconnect: vi.fn(),
  run: { findUnique: vi.fn() },
};

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});

describe('AppModule', () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  it('should compile the module with all imports', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(TemporalWorkerService)
      .useValue({})
      .overrideProvider(WorkflowClient)
      .useValue({})
      .compile();

    expect(moduleRef).toBeDefined();
  });

  it('should resolve the HealthController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(TemporalWorkerService)
      .useValue({})
      .overrideProvider(WorkflowClient)
      .useValue({})
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const { HealthController } = await import('../../src/api/health.controller');
    const controller = app.get(HealthController);
    expect(controller).toBeDefined();

    await app.close();
  });

  it('should compile in production mode (no pino-pretty transport)', async () => {
    process.env.NODE_ENV = 'production';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(TemporalWorkerService)
      .useValue({})
      .overrideProvider(WorkflowClient)
      .useValue({})
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    expect(app).toBeDefined();
    await app.close();
  });

  it('should handle HTTP requests (exercises pino customProps)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(TemporalWorkerService)
      .useValue({})
      .overrideProvider(WorkflowClient)
      .useValue({})
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');

    await app.close();
  });
});
