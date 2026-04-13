import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HarnessRepository } from '../persistence/harness.repository';
import { Prisma } from '@prisma/client';

@Controller('api/harnesses')
@UseGuards(JwtAuthGuard)
export class HarnessesController {
  constructor(private readonly harnessRepository: HarnessRepository) {}

  @Get()
  async list() {
    const harnesses = await this.harnessRepository.findAll();
    return { data: harnesses, meta: { total: harnesses.length } };
  }

  @Get(':harnessId')
  async getById(@Param('harnessId') harnessId: string) {
    const harness = await this.harnessRepository.findById(harnessId);
    if (!harness) {
      throw new NotFoundException(`Harness ${harnessId} not found`);
    }
    return { data: harness };
  }

  @Post()
  async create(@Body() body: { name: string; config?: Prisma.InputJsonValue }) {
    if (!body.name) {
      throw new BadRequestException('name is required');
    }
    const harness = await this.harnessRepository.create({
      name: body.name,
      config: body.config ?? {},
    });
    return { data: harness };
  }

  @Patch(':harnessId')
  async update(
    @Param('harnessId') harnessId: string,
    @Body() body: { name?: string; config?: Prisma.InputJsonValue },
  ) {
    const existing = await this.harnessRepository.findById(harnessId);
    if (!existing) {
      throw new NotFoundException(`Harness ${harnessId} not found`);
    }
    const updated = await this.harnessRepository.update(harnessId, body);
    return { data: updated };
  }
}
