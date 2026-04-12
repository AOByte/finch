import { describe, it, expect, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

describe('AppModule', () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  it('should compile the module with all imports', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
  });

  it('should resolve the HealthController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    expect(app).toBeDefined();
    await app.close();
  });

  it('should handle HTTP requests (exercises pino customProps)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    // Making a real HTTP request triggers pino-http middleware,
    // which calls the customProps function on line 29 of app.module.ts
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');

    await app.close();
  });
});
