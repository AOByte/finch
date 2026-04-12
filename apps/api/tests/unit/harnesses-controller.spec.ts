import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { HarnessesController } from '../../src/api/harnesses.controller';
import { HarnessRepository } from '../../src/persistence/harness.repository';

describe('HarnessesController', () => {
  let controller: HarnessesController;
  let harnessRepo: {
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    harnessRepo = {
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    controller = new HarnessesController(harnessRepo as unknown as HarnessRepository);
  });

  it('list returns { data, meta } envelope', async () => {
    const harnesses = [{ harnessId: 'h1', name: 'default' }];
    harnessRepo.findAll.mockResolvedValue(harnesses);
    const result = await controller.list();
    expect(result).toEqual({ data: harnesses, meta: { total: 1 } });
  });

  it('getById returns { data } envelope', async () => {
    const harness = { harnessId: 'h1', name: 'default' };
    harnessRepo.findById.mockResolvedValue(harness);
    const result = await controller.getById('h1');
    expect(result).toEqual({ data: harness });
  });

  it('getById throws NotFoundException', async () => {
    harnessRepo.findById.mockResolvedValue(null);
    await expect(controller.getById('x')).rejects.toThrow(NotFoundException);
  });

  it('create returns { data } envelope', async () => {
    const created = { harnessId: 'h1', name: 'new-harness' };
    harnessRepo.create.mockResolvedValue(created);
    const result = await controller.create({ name: 'new-harness' });
    expect(result).toEqual({ data: created });
  });

  it('update returns { data } envelope', async () => {
    harnessRepo.findById.mockResolvedValue({ harnessId: 'h1' });
    harnessRepo.update.mockResolvedValue({ harnessId: 'h1', name: 'updated' });
    const result = await controller.update('h1', { name: 'updated' });
    expect(result).toHaveProperty('data');
  });

  it('update throws NotFoundException when not found', async () => {
    harnessRepo.findById.mockResolvedValue(null);
    await expect(controller.update('x', { name: 'y' })).rejects.toThrow(NotFoundException);
  });

  it('create throws BadRequestException when name missing', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    await expect(controller.create({ name: '' })).rejects.toThrow(BadRequestException);
  });
});
