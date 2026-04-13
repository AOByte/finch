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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../persistence/prisma.service';

@Controller('api/connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('harnessId') harnessId?: string,
    @Query('category') category?: string,
  ) {
    if (!harnessId) {
      return { data: [], meta: { total: 0 } };
    }
    const where: Record<string, unknown> = { harnessId };
    if (category) where['category'] = category;

    const connectors = await this.prisma.connector.findMany({ where });
    return { data: connectors, meta: { total: connectors.length } };
  }

  @Get(':connectorId')
  async getById(@Param('connectorId') connectorId: string) {
    const connector = await this.prisma.connector.findUnique({
      where: { connectorId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }
    return { data: connector };
  }

  @Post()
  async create(
    @Body() body: {
      harnessId: string;
      connectorType: string;
      category: string;
      configEncrypted: string;
    },
  ) {
    if (!body.harnessId || !body.connectorType || !body.category) {
      throw new BadRequestException('harnessId, connectorType, and category are required');
    }
    const connector = await this.prisma.connector.create({
      data: {
        harnessId: body.harnessId,
        connectorType: body.connectorType,
        category: body.category,
        configEncrypted: body.configEncrypted ?? '',
      },
    });
    return { data: connector };
  }

  @Patch(':connectorId')
  async update(
    @Param('connectorId') connectorId: string,
    @Body() body: { configEncrypted?: string; isActive?: boolean },
  ) {
    const existing = await this.prisma.connector.findUnique({
      where: { connectorId },
    });
    if (!existing) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }
    const updated = await this.prisma.connector.update({
      where: { connectorId },
      data: body,
    });
    return { data: updated };
  }

  @Delete(':connectorId')
  async remove(@Param('connectorId') connectorId: string) {
    const existing = await this.prisma.connector.findUnique({
      where: { connectorId },
    });
    if (!existing) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }
    await this.prisma.connector.delete({ where: { connectorId } });
    return { data: { connectorId, deleted: true } };
  }
}
