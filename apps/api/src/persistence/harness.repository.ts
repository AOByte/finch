import { Injectable } from '@nestjs/common';
import { Harness, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class HarnessRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.HarnessCreateInput): Promise<Harness> {
    return this.prisma.harness.create({ data });
  }

  async findById(harnessId: string): Promise<Harness | null> {
    return this.prisma.harness.findUnique({ where: { harnessId } });
  }

  async findAll(): Promise<Harness[]> {
    return this.prisma.harness.findMany();
  }

  async update(
    harnessId: string,
    data: Prisma.HarnessUpdateInput,
  ): Promise<Harness> {
    return this.prisma.harness.update({
      where: { harnessId },
      data,
    });
  }
}
