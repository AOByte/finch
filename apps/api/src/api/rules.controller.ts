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

@Controller('api/rules')
export class RulesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('harnessId') harnessId?: string,
    @Query('enforcement') enforcement?: string,
  ) {
    if (!harnessId) {
      return { data: [], meta: { total: 0 } };
    }
    const where: Record<string, unknown> = { harnessId };
    if (enforcement) where['enforcement'] = enforcement;

    const rules = await this.prisma.rule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { data: rules, meta: { total: rules.length } };
  }

  @Get(':ruleId')
  async getById(@Param('ruleId') ruleId: string) {
    const rule = await this.prisma.rule.findUnique({
      where: { ruleId },
    });
    if (!rule) {
      throw new NotFoundException(`Rule ${ruleId} not found`);
    }
    return { data: rule };
  }

  @Post()
  async create(
    @Body() body: {
      harnessId: string;
      name: string;
      applicablePhases: string[];
      constraintText: string;
      enforcement: string;
      patternType: string;
      patterns?: string[];
    },
  ) {
    if (!body.harnessId || !body.name || !body.constraintText || !body.enforcement || !body.patternType) {
      throw new BadRequestException('harnessId, name, constraintText, enforcement, and patternType are required');
    }
    const rule = await this.prisma.rule.create({
      data: {
        harnessId: body.harnessId,
        name: body.name,
        applicablePhases: body.applicablePhases ?? [],
        constraintText: body.constraintText,
        enforcement: body.enforcement,
        patternType: body.patternType,
        patterns: body.patterns ?? [],
      },
    });
    return { data: rule };
  }

  @Patch(':ruleId')
  async update(
    @Param('ruleId') ruleId: string,
    @Body() body: {
      name?: string;
      constraintText?: string;
      enforcement?: string;
      applicablePhases?: string[];
      patterns?: string[];
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.rule.findUnique({
      where: { ruleId },
    });
    if (!existing) {
      throw new NotFoundException(`Rule ${ruleId} not found`);
    }
    const updated = await this.prisma.rule.update({
      where: { ruleId },
      data: body,
    });
    return { data: updated };
  }

  @Delete(':ruleId')
  async remove(@Param('ruleId') ruleId: string) {
    const existing = await this.prisma.rule.findUnique({
      where: { ruleId },
    });
    if (!existing) {
      throw new NotFoundException(`Rule ${ruleId} not found`);
    }
    await this.prisma.rule.delete({ where: { ruleId } });
    return { data: { ruleId, deleted: true } };
  }
}
