import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Seed Data', () => {
  describe('users', () => {
    it('should have exactly one user with email admin@finch.local', async () => {
      const result = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM users WHERE email = 'admin@finch.local'
      `;
      expect(Number(result[0].count)).toBe(1);
    });

    it('should have a bcrypt password hash ($2b$10$...)', async () => {
      const user = await prisma.user.findUnique({
        where: { email: 'admin@finch.local' },
      });
      expect(user).not.toBeNull();
      expect(user!.passwordHash).toMatch(/^\$2[ab]\$10\$/);
      // bcrypt hashes are always 60 characters
      expect(user!.passwordHash).toHaveLength(60);
    });

    it('should have a valid UUID for user_id', async () => {
      const user = await prisma.user.findUnique({
        where: { email: 'admin@finch.local' },
      });
      expect(user!.userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe('harnesses', () => {
    it('should have exactly one harness named "default"', async () => {
      const result = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM harnesses WHERE name = 'default'
      `;
      expect(Number(result[0].count)).toBe(1);
    });

    it('should have the well-known harness_id', async () => {
      const harness = await prisma.harness.findFirst({
        where: { name: 'default' },
      });
      expect(harness).not.toBeNull();
      expect(harness!.harnessId).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('should have default empty config', async () => {
      const harness = await prisma.harness.findFirst({
        where: { name: 'default' },
      });
      expect(harness!.config).toEqual({});
    });
  });

  describe('harness_members', () => {
    it('should have one harness_member linking admin user to default harness', async () => {
      const user = await prisma.user.findUnique({
        where: { email: 'admin@finch.local' },
      });
      const harness = await prisma.harness.findFirst({
        where: { name: 'default' },
      });

      const member = await prisma.harnessMember.findUnique({
        where: {
          userId_harnessId: {
            userId: user!.userId,
            harnessId: harness!.harnessId,
          },
        },
      });
      expect(member).not.toBeNull();
    });
  });

  describe('agent_configs', () => {
    it('should have exactly 5 agent_configs for the default harness', async () => {
      const result = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM agent_configs
        WHERE harness_id = (SELECT harness_id FROM harnesses WHERE name = 'default')
      `;
      expect(Number(result[0].count)).toBe(5);
    });

    it('should have one config per TAPES phase', async () => {
      const configs = await prisma.agentConfig.findMany({
        where: { harnessId: '00000000-0000-0000-0000-000000000001' },
        orderBy: { agentConfigId: 'asc' },
      });

      const phases = configs.map((c) => c.phase);
      expect(phases).toEqual(['TRIGGER', 'ACQUIRE', 'PLAN', 'EXECUTE', 'SHIP']);
    });

    it('should have position 0 for all configs (single agent per phase)', async () => {
      const configs = await prisma.agentConfig.findMany({
        where: { harnessId: '00000000-0000-0000-0000-000000000001' },
      });

      for (const config of configs) {
        expect(config.position).toBe(0);
      }
    });

    it('should have all configs active by default', async () => {
      const configs = await prisma.agentConfig.findMany({
        where: { harnessId: '00000000-0000-0000-0000-000000000001' },
      });

      for (const config of configs) {
        expect(config.isActive).toBe(true);
      }
    });

    it('should have agent_id matching phase name pattern', async () => {
      const configs = await prisma.agentConfig.findMany({
        where: { harnessId: '00000000-0000-0000-0000-000000000001' },
        orderBy: { agentConfigId: 'asc' },
      });

      for (const config of configs) {
        // agent_id should contain the phase name in lowercase
        expect(config.agentId.toLowerCase()).toContain(config.phase.toLowerCase());
      }
    });
  });
});
