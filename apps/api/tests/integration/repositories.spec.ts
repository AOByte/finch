import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { RunRepository } from '../../src/persistence/run.repository';
import { GateRepository } from '../../src/persistence/gate.repository';
import { ArtifactRepository } from '../../src/persistence/artifact.repository';
import { HarnessRepository } from '../../src/persistence/harness.repository';
import { PrismaService } from '../../src/persistence/prisma.service';

const WELL_KNOWN_HARNESS_ID = '00000000-0000-0000-0000-000000000001';

let prisma: PrismaClient;
let runRepo: RunRepository;
let gateRepo: GateRepository;
let artifactRepo: ArtifactRepository;
let harnessRepo: HarnessRepository;

beforeAll(async () => {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DATABASE_URL ??
          'postgresql://finch:finch@localhost:5432/finch',
      },
    },
  });
  await prisma.$connect();
  runRepo = new RunRepository(prisma as unknown as PrismaService);
  gateRepo = new GateRepository(prisma as unknown as PrismaService);
  artifactRepo = new ArtifactRepository(prisma as unknown as PrismaService);
  harnessRepo = new HarnessRepository(prisma as unknown as PrismaService);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('HarnessRepository integration', () => {
  it('reads the well-known default harness', async () => {
    const harness = await harnessRepo.findById(WELL_KNOWN_HARNESS_ID);
    expect(harness).not.toBeNull();
    expect(harness!.name).toBe('default');
  });

  it('findAll returns at least the default harness', async () => {
    const all = await harnessRepo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some((h) => h.harnessId === WELL_KNOWN_HARNESS_ID)).toBe(true);
  });

  it('create → findById → update → verify', async () => {
    const id = uuidv4();
    const created = await harnessRepo.create({
      harnessId: id,
      name: 'test-harness',
    } as Parameters<typeof harnessRepo.create>[0]);
    expect(created.harnessId).toBe(id);
    expect(created.name).toBe('test-harness');

    const found = await harnessRepo.findById(id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('test-harness');

    const updated = await harnessRepo.update(id, { name: 'updated-harness' });
    expect(updated.name).toBe('updated-harness');

    const verified = await harnessRepo.findById(id);
    expect(verified!.name).toBe('updated-harness');

    // Cleanup
    await prisma.harness.delete({ where: { harnessId: id } });
  });
});

describe('RunRepository integration', () => {
  let testRunId: string;

  it('create → findById → updateStatus → updatePhase → verify', async () => {
    testRunId = uuidv4();
    const created = await runRepo.create({
      runId: testRunId,
      harnessId: WELL_KNOWN_HARNESS_ID,
      temporalWorkflowId: `test-wf-${testRunId}`,
      status: 'RUNNING',
      currentPhase: 'TRIGGER',
    });
    expect(created.runId).toBe(testRunId);
    expect(created.status).toBe('RUNNING');

    const found = await runRepo.findById(testRunId);
    expect(found).not.toBeNull();
    expect(found!.status).toBe('RUNNING');

    const statusUpdated = await runRepo.updateStatus(testRunId, 'COMPLETED');
    expect(statusUpdated.status).toBe('COMPLETED');

    const phaseUpdated = await runRepo.updatePhase(testRunId, 'PLAN');
    expect(phaseUpdated.currentPhase).toBe('PLAN');

    const verified = await runRepo.findById(testRunId);
    expect(verified!.status).toBe('COMPLETED');
    expect(verified!.currentPhase).toBe('PLAN');
  });

  it('findByHarnessId returns runs in descending order', async () => {
    const runs = await runRepo.findByHarnessId(WELL_KNOWN_HARNESS_ID, {
      take: 10,
    });
    expect(Array.isArray(runs)).toBe(true);
    if (runs.length >= 2) {
      expect(runs[0].startedAt.getTime()).toBeGreaterThanOrEqual(
        runs[1].startedAt.getTime(),
      );
    }
  });

  it('markCompleted sets status and completedAt', async () => {
    const id = uuidv4();
    await runRepo.create({
      runId: id,
      harnessId: WELL_KNOWN_HARNESS_ID,
      temporalWorkflowId: `test-wf-${id}`,
      status: 'RUNNING',
      currentPhase: 'SHIP',
    });

    const completed = await runRepo.markCompleted(id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();

    // Cleanup
    await prisma.run.delete({ where: { runId: id } });
  });

  it('updatePipelinePosition → getPipelineState → getPersistedPipelineArtifact with correct (runId, phase, position) signature', async () => {
    const runId1 = uuidv4();
    const runId2 = uuidv4();

    await runRepo.create({
      runId: runId1,
      harnessId: WELL_KNOWN_HARNESS_ID,
      temporalWorkflowId: `wf-${runId1}`,
      status: 'RUNNING',
      currentPhase: 'TRIGGER',
    });
    await runRepo.create({
      runId: runId2,
      harnessId: WELL_KNOWN_HARNESS_ID,
      temporalWorkflowId: `wf-${runId2}`,
      status: 'RUNNING',
      currentPhase: 'TRIGGER',
    });

    // Write pipeline position for run1
    const artifact1 = { result: 'run1-artifact', position: 3 };
    await runRepo.updatePipelinePosition(runId1, 'EXECUTE', 3, artifact1);

    // Write pipeline position for run2 at same position number
    const artifact2 = { result: 'run2-artifact', position: 3 };
    await runRepo.updatePipelinePosition(runId2, 'EXECUTE', 3, artifact2);

    // Verify getPipelineState
    const state1 = await runRepo.getPipelineState(runId1, 'EXECUTE');
    expect(state1).not.toBeNull();
    expect(state1!.pipelinePosition).toBe(3);
    expect(state1!.pipelineArtifact).toEqual(artifact1);

    const state2 = await runRepo.getPipelineState(runId2, 'EXECUTE');
    expect(state2).not.toBeNull();
    expect(state2!.pipelineArtifact).toEqual(artifact2);

    // Verify getPersistedPipelineArtifact returns correct artifact per run
    const persisted1 = await runRepo.getPersistedPipelineArtifact(
      runId1,
      'EXECUTE',
      3,
    );
    expect(persisted1).toEqual(artifact1);

    const persisted2 = await runRepo.getPersistedPipelineArtifact(
      runId2,
      'EXECUTE',
      3,
    );
    expect(persisted2).toEqual(artifact2);

    // Wrong position returns null
    const wrongPos = await runRepo.getPersistedPipelineArtifact(
      runId1,
      'EXECUTE',
      999,
    );
    expect(wrongPos).toBeNull();

    // Wrong runId returns null
    const wrongRun = await runRepo.getPersistedPipelineArtifact(
      uuidv4(),
      'EXECUTE',
      3,
    );
    expect(wrongRun).toBeNull();

    // Cleanup
    await prisma.run.deleteMany({
      where: { runId: { in: [runId1, runId2] } },
    });
  });

  afterAll(async () => {
    // Cleanup test run if it wasn't cleaned above
    if (testRunId) {
      await prisma.run
        .delete({ where: { runId: testRunId } })
        .catch(() => {});
    }
  });
});

describe('GateRepository integration', () => {
  let testRunId: string;
  let testGateId: string;

  beforeAll(async () => {
    testRunId = uuidv4();
    await prisma.run.create({
      data: {
        runId: testRunId,
        harnessId: WELL_KNOWN_HARNESS_ID,
        temporalWorkflowId: `gate-test-wf-${testRunId}`,
        status: 'RUNNING',
        currentPhase: 'PLAN',
      },
    });
  });

  it('create → findById → findByRunId → saveResolution → verify', async () => {
    const gate = await gateRepo.create({
      runId: testRunId,
      harnessId: WELL_KNOWN_HARNESS_ID,
      phase: 'PLAN',
      agentId: 'plan-agent',
      pipelinePosition: 0,
      gapDescription: 'Need clarification',
      question: 'What framework?',
      source: { channelId: 'C123', threadTs: 'T456' },
      snapshot: { context: 'test' },
      temporalWorkflowId: `gate-test-wf-${testRunId}`,
    });
    testGateId = gate.gateId;
    expect(gate.gateId).toBeDefined();
    expect(gate.phase).toBe('PLAN');

    const found = await gateRepo.findById(testGateId);
    expect(found).not.toBeNull();
    expect(found!.question).toBe('What framework?');

    const byRun = await gateRepo.findByRunId(testRunId);
    expect(byRun.length).toBe(1);
    expect(byRun[0].gateId).toBe(testGateId);

    const resolved = await gateRepo.saveResolution(testGateId, {
      answer: 'Use React',
    });
    expect(resolved.resolution).toEqual({ answer: 'Use React' });
    expect(resolved.resolvedAt).not.toBeNull();

    const verified = await gateRepo.findById(testGateId);
    expect(verified!.resolvedAt).not.toBeNull();
  });

  it('markResolved sets resolvedAt', async () => {
    const gate = await gateRepo.create({
      runId: testRunId,
      harnessId: WELL_KNOWN_HARNESS_ID,
      phase: 'ACQUIRE',
      agentId: 'acquire-agent',
      pipelinePosition: 1,
      gapDescription: 'Missing info',
      question: 'Which repo?',
      source: { channelId: 'C789', threadTs: 'T012' },
      snapshot: {},
      temporalWorkflowId: `gate-test-wf-${testRunId}`,
    });

    const resolved = await gateRepo.markResolved(gate.gateId);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('findOpenGateByThread finds unresolved gate', async () => {
    const gate = await gateRepo.create({
      runId: testRunId,
      harnessId: WELL_KNOWN_HARNESS_ID,
      phase: 'EXECUTE',
      agentId: 'execute-agent',
      pipelinePosition: 2,
      gapDescription: 'Open gate',
      question: 'Approve deploy?',
      source: { channelId: 'COPEN', threadTs: 'TOPEN' },
      snapshot: {},
      temporalWorkflowId: `gate-test-wf-${testRunId}`,
    });

    const found = await gateRepo.findOpenGateByThread({
      channelId: 'COPEN',
      threadTs: 'TOPEN',
    });
    expect(found).not.toBeNull();
    expect(found!.gateId).toBe(gate.gateId);
  });

  afterAll(async () => {
    await prisma.gateEvent
      .deleteMany({ where: { runId: testRunId } })
      .catch(() => {});
    await prisma.run
      .delete({ where: { runId: testRunId } })
      .catch(() => {});
  });
});

describe('ArtifactRepository integration', () => {
  let testRunId: string;

  beforeAll(async () => {
    testRunId = uuidv4();
    await prisma.run.create({
      data: {
        runId: testRunId,
        harnessId: WELL_KNOWN_HARNESS_ID,
        temporalWorkflowId: `artifact-test-wf-${testRunId}`,
        status: 'RUNNING',
        currentPhase: 'TRIGGER',
      },
    });
  });

  it('save → findByRunIdAndPhase returns latest version', async () => {
    await artifactRepo.save({
      runId: testRunId,
      phase: 'TRIGGER',
      artifactType: 'task_descriptor',
      content: { version: 1 },
      version: 1,
    });
    await artifactRepo.save({
      runId: testRunId,
      phase: 'TRIGGER',
      artifactType: 'task_descriptor',
      content: { version: 2 },
      version: 2,
    });

    const latest = await artifactRepo.findByRunIdAndPhase(
      testRunId,
      'TRIGGER',
    );
    expect(latest).not.toBeNull();
    expect(latest!.version).toBe(2);
    expect(latest!.content).toEqual({ version: 2 });
  });

  it('findByRunIdAndPhase returns null for nonexistent', async () => {
    const result = await artifactRepo.findByRunIdAndPhase(
      testRunId,
      'NONEXISTENT',
    );
    expect(result).toBeNull();
  });

  afterAll(async () => {
    await prisma.phaseArtifact
      .deleteMany({ where: { runId: testRunId } })
      .catch(() => {});
    await prisma.run
      .delete({ where: { runId: testRunId } })
      .catch(() => {});
  });
});
