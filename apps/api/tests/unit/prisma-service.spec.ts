import { describe, it, expect, vi } from 'vitest';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('PrismaService', () => {
  it('should call $connect on onModuleInit', async () => {
    const service = new PrismaService();
    const connectSpy = vi.spyOn(service, '$connect').mockResolvedValue();
    await service.onModuleInit();
    expect(connectSpy).toHaveBeenCalledOnce();
  });

  it('should call $disconnect on onModuleDestroy', async () => {
    const service = new PrismaService();
    const disconnectSpy = vi.spyOn(service, '$disconnect').mockResolvedValue();
    await service.onModuleDestroy();
    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});
