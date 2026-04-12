import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RulesController } from '../../src/api/rules.controller';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('RulesController', () => {
  let controller: RulesController;
  let prisma: {
    rule: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      rule: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    controller = new RulesController(prisma as unknown as PrismaService);
  });

  it('list returns { data, meta } envelope', async () => {
    const rules = [{ ruleId: 'r1' }];
    prisma.rule.findMany.mockResolvedValue(rules);
    const result = await controller.list('h1');
    expect(result).toEqual({ data: rules, meta: { total: 1 } });
  });

  it('list returns empty when no harnessId', async () => {
    const result = await controller.list();
    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('getById returns { data } envelope', async () => {
    const rule = { ruleId: 'r1', name: 'test-rule' };
    prisma.rule.findUnique.mockResolvedValue(rule);
    const result = await controller.getById('r1');
    expect(result).toEqual({ data: rule });
  });

  it('getById throws NotFoundException', async () => {
    prisma.rule.findUnique.mockResolvedValue(null);
    await expect(controller.getById('x')).rejects.toThrow(NotFoundException);
  });

  it('create returns { data } envelope', async () => {
    const created = { ruleId: 'r1' };
    prisma.rule.create.mockResolvedValue(created);
    const result = await controller.create({
      harnessId: 'h1',
      name: 'test-rule',
      applicablePhases: ['ACQUIRE'],
      constraintText: 'do not skip tests',
      enforcement: 'hard',
      patternType: 'semantic',
    });
    expect(result).toEqual({ data: created });
  });

  it('update returns { data } envelope', async () => {
    prisma.rule.findUnique.mockResolvedValue({ ruleId: 'r1' });
    prisma.rule.update.mockResolvedValue({ ruleId: 'r1', name: 'updated' });
    const result = await controller.update('r1', { name: 'updated' });
    expect(result).toHaveProperty('data');
  });

  it('update throws NotFoundException when not found', async () => {
    prisma.rule.findUnique.mockResolvedValue(null);
    await expect(controller.update('x', { name: 'y' })).rejects.toThrow(NotFoundException);
  });

  it('remove returns { data } envelope', async () => {
    prisma.rule.findUnique.mockResolvedValue({ ruleId: 'r1' });
    prisma.rule.delete.mockResolvedValue({});
    const result = await controller.remove('r1');
    expect(result).toEqual({ data: { ruleId: 'r1', deleted: true } });
  });

  it('remove throws NotFoundException when not found', async () => {
    prisma.rule.findUnique.mockResolvedValue(null);
    await expect(controller.remove('x')).rejects.toThrow(NotFoundException);
  });

  it('create throws BadRequestException when fields missing', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    await expect(controller.create({ harnessId: '', name: '', applicablePhases: [], constraintText: '', enforcement: '', patternType: '' })).rejects.toThrow(BadRequestException);
  });

  it('list filters by enforcement when provided', async () => {
    prisma.rule.findMany.mockResolvedValue([]);
    await controller.list('h1', 'hard');
    expect(prisma.rule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { harnessId: 'h1', enforcement: 'hard' },
    }));
  });
});
