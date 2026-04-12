import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

@Controller('api/agents')
export class AgentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('harnessId') harnessId?: string,
    @Query('phase') phase?: string,
  ) {
    if (!harnessId) {
      return { data: [], meta: { total: 0 } };
    }
    const where: Record<string, unknown> = { harnessId };
    if (phase) where['phase'] = phase;

    const configs = await this.prisma.agentConfig.findMany({
      where,
      orderBy: { position: 'asc' },
    });
    return { data: configs, meta: { total: configs.length } };
  }

  @Get(':agentConfigId')
  async getById(@Param('agentConfigId') agentConfigId: string) {
    const config = await this.prisma.agentConfig.findUnique({
      where: { agentConfigId },
    });
    if (!config) {
      throw new NotFoundException(`AgentConfig ${agentConfigId} not found`);
    }
    return { data: config };
  }

  @Post()
  async create(
    @Body() body: {
      harnessId: string;
      phase: string;
      position: number;
      agentId: string;
      llmConnectorId: string;
      model: string;
      maxTokens?: number;
      systemPromptBody?: string;
    },
  ) {
    if (!body.harnessId || !body.phase || !body.agentId || !body.llmConnectorId || !body.model) {
      throw new BadRequestException('harnessId, phase, agentId, llmConnectorId, and model are required');
    }
    const config = await this.prisma.agentConfig.create({
      data: {
        harnessId: body.harnessId,
        phase: body.phase,
        position: body.position ?? 0,
        agentId: body.agentId,
        llmConnectorId: body.llmConnectorId,
        model: body.model,
        maxTokens: body.maxTokens ?? 4096,
        systemPromptBody: body.systemPromptBody ?? '',
      },
    });
    return { data: config };
  }

  @Patch(':agentConfigId')
  async update(
    @Param('agentConfigId') agentConfigId: string,
    @Body() body: {
      model?: string;
      maxTokens?: number;
      systemPromptBody?: string;
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.agentConfig.findUnique({
      where: { agentConfigId },
    });
    if (!existing) {
      throw new NotFoundException(`AgentConfig ${agentConfigId} not found`);
    }
    const updated = await this.prisma.agentConfig.update({
      where: { agentConfigId },
      data: body,
    });
    return { data: updated };
  }

  @Delete(':agentConfigId')
  async remove(@Param('agentConfigId') agentConfigId: string) {
    const existing = await this.prisma.agentConfig.findUnique({
      where: { agentConfigId },
    });
    if (!existing) {
      throw new NotFoundException(`AgentConfig ${agentConfigId} not found`);
    }
    await this.prisma.agentConfig.delete({ where: { agentConfigId } });
    return { data: { agentConfigId, deleted: true } };
  }
}
