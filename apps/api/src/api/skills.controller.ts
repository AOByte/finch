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

@Controller('api/skills')
export class SkillsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('harnessId') harnessId?: string,
    @Query('phase') phase?: string,
  ) {
    if (!harnessId) {
      return { data: [], meta: { total: 0 } };
    }
    const skills = await this.prisma.skill.findMany({
      where: {
        harnessId,
        ...(phase ? { applicablePhases: { has: phase } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: skills, meta: { total: skills.length } };
  }

  @Get(':skillId')
  async getById(@Param('skillId') skillId: string) {
    const skill = await this.prisma.skill.findUnique({
      where: { skillId },
    });
    if (!skill) {
      throw new NotFoundException(`Skill ${skillId} not found`);
    }
    return { data: skill };
  }

  @Post()
  async create(
    @Body() body: {
      harnessId: string;
      name: string;
      description: string;
      applicablePhases: string[];
      content: string;
    },
  ) {
    if (!body.harnessId || !body.name || !body.content) {
      throw new BadRequestException('harnessId, name, and content are required');
    }
    const skill = await this.prisma.skill.create({
      data: {
        harnessId: body.harnessId,
        name: body.name,
        description: body.description ?? '',
        applicablePhases: body.applicablePhases ?? [],
        content: body.content,
      },
    });
    return { data: skill };
  }

  @Patch(':skillId')
  async update(
    @Param('skillId') skillId: string,
    @Body() body: {
      name?: string;
      description?: string;
      content?: string;
      applicablePhases?: string[];
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.skill.findUnique({
      where: { skillId },
    });
    if (!existing) {
      throw new NotFoundException(`Skill ${skillId} not found`);
    }
    const updated = await this.prisma.skill.update({
      where: { skillId },
      data: body,
    });
    return { data: updated };
  }

  @Delete(':skillId')
  async remove(@Param('skillId') skillId: string) {
    const existing = await this.prisma.skill.findUnique({
      where: { skillId },
    });
    if (!existing) {
      throw new NotFoundException(`Skill ${skillId} not found`);
    }
    await this.prisma.skill.delete({ where: { skillId } });
    return { data: { skillId, deleted: true } };
  }
}
