import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AgentsController } from '../../src/api/agents.controller';
import { PrismaService } from '../../src/persistence/prisma.service';
import { HarnessRepository } from '../../src/persistence/harness.repository';
import { AgentDispatcherService } from '../../src/orchestrator/agent-dispatcher.service';

describe('AgentsController', () => {
  let controller: AgentsController;
  let prisma: {
    agentConfig: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
  let harnessRepo: { findByName: ReturnType<typeof vi.fn> };
  let dispatcher: { getLockedPreamble: ReturnType<typeof vi.fn> };
  const H1 = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    prisma = {
      agentConfig: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    harnessRepo = { findByName: vi.fn() };
    dispatcher = { getLockedPreamble: vi.fn().mockReturnValue('locked preamble text') };
    controller = new AgentsController(
      prisma as unknown as PrismaService,
      harnessRepo as unknown as HarnessRepository,
      dispatcher as unknown as AgentDispatcherService,
    );
  });

  it('list returns { data, meta } envelope', async () => {
    const configs = [{ agentConfigId: 'a1' }];
    prisma.agentConfig.findMany.mockResolvedValue(configs);
    const result = await controller.list(H1);
    expect(result).toEqual({ data: configs, meta: { total: 1 } });
  });

  it('list returns empty when no harnessId', async () => {
    const result = await controller.list();
    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('getById returns { data } envelope', async () => {
    const config = { agentConfigId: 'a1', model: 'claude-sonnet-4-20250514' };
    prisma.agentConfig.findUnique.mockResolvedValue(config);
    const result = await controller.getById('a1');
    expect(result).toEqual({ data: config });
  });

  it('getById throws NotFoundException', async () => {
    prisma.agentConfig.findUnique.mockResolvedValue(null);
    await expect(controller.getById('x')).rejects.toThrow(NotFoundException);
  });

  it('create returns { data } envelope', async () => {
    const created = { agentConfigId: 'a1' };
    prisma.agentConfig.create.mockResolvedValue(created);
    const result = await controller.create({
      harnessId: 'h1',
      phase: 'ACQUIRE',
      position: 0,
      agentId: 'acquire-default',
      llmConnectorId: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });
    expect(result).toEqual({ data: created });
  });

  it('update returns { data } envelope', async () => {
    prisma.agentConfig.findUnique.mockResolvedValue({ agentConfigId: 'a1' });
    prisma.agentConfig.update.mockResolvedValue({ agentConfigId: 'a1', model: 'gpt-4' });
    const result = await controller.update('a1', { model: 'gpt-4' });
    expect(result).toHaveProperty('data');
  });

  it('update throws NotFoundException when not found', async () => {
    prisma.agentConfig.findUnique.mockResolvedValue(null);
    await expect(controller.update('x', { model: 'gpt-4' })).rejects.toThrow(NotFoundException);
  });

  it('remove returns { data } envelope', async () => {
    prisma.agentConfig.findUnique.mockResolvedValue({ agentConfigId: 'a1' });
    prisma.agentConfig.delete.mockResolvedValue({});
    const result = await controller.remove('a1');
    expect(result).toEqual({ data: { agentConfigId: 'a1', deleted: true } });
  });

  it('remove throws NotFoundException when not found', async () => {
    prisma.agentConfig.findUnique.mockResolvedValue(null);
    await expect(controller.remove('x')).rejects.toThrow(NotFoundException);
  });

  it('create throws BadRequestException when fields missing', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    await expect(controller.create({ harnessId: '', phase: '', position: 0, agentId: '', llmConnectorId: '', model: '' })).rejects.toThrow(BadRequestException);
  });

  it('getPreamble returns { data } envelope with preamble text', () => {
    const result = controller.getPreamble();
    expect(result).toEqual({ data: { preamble: 'locked preamble text' } });
    expect(dispatcher.getLockedPreamble).toHaveBeenCalled();
  });

  it('list filters by phase when provided', async () => {
    prisma.agentConfig.findMany.mockResolvedValue([]);
    await controller.list(H1, 'ACQUIRE');
    expect(prisma.agentConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { harnessId: H1, phase: 'ACQUIRE' },
    }));
  });
});
