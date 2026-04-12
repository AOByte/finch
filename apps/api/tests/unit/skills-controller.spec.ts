import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SkillsController } from '../../src/api/skills.controller';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('SkillsController', () => {
  let controller: SkillsController;
  let prisma: {
    skill: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      skill: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    controller = new SkillsController(prisma as unknown as PrismaService);
  });

  it('list returns { data, meta } envelope', async () => {
    const skills = [{ skillId: 's1' }];
    prisma.skill.findMany.mockResolvedValue(skills);
    const result = await controller.list('h1');
    expect(result).toEqual({ data: skills, meta: { total: 1 } });
  });

  it('list returns empty when no harnessId', async () => {
    const result = await controller.list();
    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('getById returns { data } envelope', async () => {
    const skill = { skillId: 's1', name: 'test-skill' };
    prisma.skill.findUnique.mockResolvedValue(skill);
    const result = await controller.getById('s1');
    expect(result).toEqual({ data: skill });
  });

  it('getById throws NotFoundException', async () => {
    prisma.skill.findUnique.mockResolvedValue(null);
    await expect(controller.getById('x')).rejects.toThrow(NotFoundException);
  });

  it('create returns { data } envelope', async () => {
    const created = { skillId: 's1' };
    prisma.skill.create.mockResolvedValue(created);
    const result = await controller.create({
      harnessId: 'h1',
      name: 'test-skill',
      description: 'A test skill',
      applicablePhases: ['ACQUIRE'],
      content: 'skill content',
    });
    expect(result).toEqual({ data: created });
  });

  it('update returns { data } envelope', async () => {
    prisma.skill.findUnique.mockResolvedValue({ skillId: 's1' });
    prisma.skill.update.mockResolvedValue({ skillId: 's1', name: 'updated' });
    const result = await controller.update('s1', { name: 'updated' });
    expect(result).toHaveProperty('data');
  });

  it('update throws NotFoundException when not found', async () => {
    prisma.skill.findUnique.mockResolvedValue(null);
    await expect(controller.update('x', { name: 'y' })).rejects.toThrow(NotFoundException);
  });

  it('remove returns { data } envelope', async () => {
    prisma.skill.findUnique.mockResolvedValue({ skillId: 's1' });
    prisma.skill.delete.mockResolvedValue({});
    const result = await controller.remove('s1');
    expect(result).toEqual({ data: { skillId: 's1', deleted: true } });
  });

  it('remove throws NotFoundException when not found', async () => {
    prisma.skill.findUnique.mockResolvedValue(null);
    await expect(controller.remove('x')).rejects.toThrow(NotFoundException);
  });

  it('create throws BadRequestException when fields missing', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    await expect(controller.create({ harnessId: '', name: '', description: '', applicablePhases: [], content: '' })).rejects.toThrow(BadRequestException);
  });

  it('list filters by phase when provided', async () => {
    prisma.skill.findMany.mockResolvedValue([]);
    await controller.list('h1', 'ACQUIRE');
    expect(prisma.skill.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ harnessId: 'h1' }),
    }));
  });
});
