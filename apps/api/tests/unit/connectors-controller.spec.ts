import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ConnectorsController } from '../../src/api/connectors.controller';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('ConnectorsController', () => {
  let controller: ConnectorsController;
  let prisma: {
    connector: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      connector: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    controller = new ConnectorsController(prisma as unknown as PrismaService);
  });

  it('list returns { data, meta } envelope', async () => {
    const connectors = [{ connectorId: 'c1' }];
    prisma.connector.findMany.mockResolvedValue(connectors);
    const result = await controller.list('h1');
    expect(result).toEqual({ data: connectors, meta: { total: 1 } });
  });

  it('list returns empty when no harnessId', async () => {
    const result = await controller.list();
    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('getById returns { data } envelope', async () => {
    const connector = { connectorId: 'c1', connectorType: 'jira' };
    prisma.connector.findUnique.mockResolvedValue(connector);
    const result = await controller.getById('c1');
    expect(result).toEqual({ data: connector });
  });

  it('getById throws NotFoundException', async () => {
    prisma.connector.findUnique.mockResolvedValue(null);
    await expect(controller.getById('x')).rejects.toThrow(NotFoundException);
  });

  it('create returns { data } envelope', async () => {
    const created = { connectorId: 'c1' };
    prisma.connector.create.mockResolvedValue(created);
    const result = await controller.create({
      harnessId: 'h1',
      connectorType: 'jira',
      category: 'acquire',
      configEncrypted: 'enc',
    });
    expect(result).toEqual({ data: created });
  });

  it('update returns { data } envelope', async () => {
    prisma.connector.findUnique.mockResolvedValue({ connectorId: 'c1' });
    prisma.connector.update.mockResolvedValue({ connectorId: 'c1', isActive: false });
    const result = await controller.update('c1', { isActive: false });
    expect(result).toHaveProperty('data');
  });

  it('update throws NotFoundException when not found', async () => {
    prisma.connector.findUnique.mockResolvedValue(null);
    await expect(controller.update('x', {})).rejects.toThrow(NotFoundException);
  });

  it('remove returns { data } envelope', async () => {
    prisma.connector.findUnique.mockResolvedValue({ connectorId: 'c1' });
    prisma.connector.delete.mockResolvedValue({});
    const result = await controller.remove('c1');
    expect(result).toEqual({ data: { connectorId: 'c1', deleted: true } });
  });

  it('remove throws NotFoundException when not found', async () => {
    prisma.connector.findUnique.mockResolvedValue(null);
    await expect(controller.remove('x')).rejects.toThrow(NotFoundException);
  });

  it('create throws BadRequestException when fields missing', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    await expect(controller.create({ harnessId: '', connectorType: '', category: '', configEncrypted: '' })).rejects.toThrow(BadRequestException);
  });

  it('list filters by category when provided', async () => {
    prisma.connector.findMany.mockResolvedValue([]);
    await controller.list('h1', 'acquire');
    expect(prisma.connector.findMany).toHaveBeenCalledWith({ where: { harnessId: 'h1', category: 'acquire' } });
  });
});
