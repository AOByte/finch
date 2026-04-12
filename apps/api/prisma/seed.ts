import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 1. Default user
  const user = await prisma.user.upsert({
    where: { email: 'admin@finch.local' },
    update: {},
    create: {
      email: 'admin@finch.local',
      passwordHash: hashSync('finch-dev-password', 10),
    },
  });

  // 2. Default harness
  const harness = await prisma.harness.upsert({
    where: { harnessId: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      harnessId: '00000000-0000-0000-0000-000000000001',
      name: 'default',
    },
  });

  // 3. Add user to harness
  await prisma.harnessMember.upsert({
    where: {
      userId_harnessId: {
        userId: user.userId,
        harnessId: harness.harnessId,
      },
    },
    update: {},
    create: {
      userId: user.userId,
      harnessId: harness.harnessId,
    },
  });

  // 4. One AgentConfig per phase
  const phases = ['TRIGGER', 'ACQUIRE', 'PLAN', 'EXECUTE', 'SHIP'];
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    await prisma.agentConfig.upsert({
      where: {
        agentConfigId: `00000000-0000-0000-0000-00000000010${i + 1}`,
      },
      update: {},
      create: {
        agentConfigId: `00000000-0000-0000-0000-00000000010${i + 1}`,
        harnessId: harness.harnessId,
        phase: phase,
        position: 0,
        agentId: `${phase.toLowerCase()}-agent`,
        llmConnectorId: 'default-llm',
        model: 'claude-sonnet-4-5',
        systemPromptBody: '',
      },
    });
  }

  console.log('Seed complete: user, harness, harness_member, 5 agent_configs');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
