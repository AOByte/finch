import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

describe('AppModule', () => {
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

    // The health controller is registered in ApiModule which is imported by AppModule
    const { HealthController } = await import('../../src/api/health.controller');
    const controller = app.get(HealthController);
    expect(controller).toBeDefined();

    await app.close();
  });
});
