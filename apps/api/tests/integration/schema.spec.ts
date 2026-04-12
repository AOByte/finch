import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Database Schema', () => {
  describe('pgvector extension', () => {
    it('should have the vector extension installed', async () => {
      const result = await prisma.$queryRaw<{ extname: string }[]>`
        SELECT extname FROM pg_extension WHERE extname = 'vector'
      `;
      expect(result).toHaveLength(1);
      expect(result[0].extname).toBe('vector');
    });

    it('should have the pgcrypto extension installed', async () => {
      const result = await prisma.$queryRaw<{ extname: string }[]>`
        SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
      `;
      expect(result).toHaveLength(1);
      expect(result[0].extname).toBe('pgcrypto');
    });
  });

  describe('tables', () => {
    it('should have all expected tables', async () => {
      const result = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT LIKE '_prisma_%'
        ORDER BY tablename
      `;
      const tableNames = result.map((r) => r.tablename);
      const expectedTables = [
        'agent_configs',
        'audit_events',
        'connectors',
        'gate_events',
        'harness_members',
        'harnesses',
        'memory_records',
        'memory_staging',
        'phase_artifacts',
        'rules',
        'runs',
        'skills',
        'users',
      ];
      for (const table of expectedTables) {
        expect(tableNames).toContain(table);
      }
    });
  });

  describe('audit rules', () => {
    it('should have no_audit_update and no_audit_delete rules', async () => {
      const result = await prisma.$queryRaw<{ rulename: string }[]>`
        SELECT rulename FROM pg_rules
        WHERE tablename = 'audit_events'
        ORDER BY rulename
      `;
      expect(result).toHaveLength(2);
      const ruleNames = result.map((r) => r.rulename);
      expect(ruleNames).toContain('no_audit_delete');
      expect(ruleNames).toContain('no_audit_update');
    });

    it('should allow INSERT into audit_events', async () => {
      const inserted = await prisma.auditEvent.create({
        data: {
          eventType: 'test_insert',
          actor: { system: 'test' },
          payload: { action: 'schema_test' },
        },
      });
      expect(inserted.eventId).toBeDefined();
      expect(inserted.eventType).toBe('test_insert');
    });

    it('should silently block UPDATE on audit_events', async () => {
      // Insert a record first
      const inserted = await prisma.auditEvent.create({
        data: {
          eventType: 'test_update_target',
          actor: { system: 'test' },
          payload: { action: 'will_try_update' },
        },
      });

      // Attempt raw SQL UPDATE (Prisma's update would throw due to 0 rows affected)
      await prisma.$executeRaw`
        UPDATE audit_events SET event_type = 'modified' WHERE event_id = ${inserted.eventId}::uuid
      `;

      // Verify the record was NOT modified
      const afterUpdate = await prisma.auditEvent.findUnique({
        where: { eventId: inserted.eventId },
      });
      expect(afterUpdate?.eventType).toBe('test_update_target');
    });

    it('should silently block DELETE on audit_events', async () => {
      // Insert a record first
      const inserted = await prisma.auditEvent.create({
        data: {
          eventType: 'test_delete_target',
          actor: { system: 'test' },
          payload: { action: 'will_try_delete' },
        },
      });

      // Attempt raw SQL DELETE
      await prisma.$executeRaw`
        DELETE FROM audit_events WHERE event_id = ${inserted.eventId}::uuid
      `;

      // Verify the record still exists
      const afterDelete = await prisma.auditEvent.findUnique({
        where: { eventId: inserted.eventId },
      });
      expect(afterDelete).not.toBeNull();
      expect(afterDelete?.eventType).toBe('test_delete_target');
    });
  });

  describe('CHECK constraints', () => {
    let harnessId: string;

    beforeAll(async () => {
      // Create a test harness for constraint tests
      const harness = await prisma.harness.create({
        data: { name: 'check-constraint-test' },
      });
      harnessId = harness.harnessId;
    });

    it('should reject invalid run status', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO runs (run_id, harness_id, temporal_workflow_id, status, current_phase)
          VALUES (gen_random_uuid(), ${harnessId}::uuid, 'test-wf', 'INVALID_STATUS', 'TRIGGER')
        `,
      ).rejects.toThrow(/runs_status_check/);
    });

    it('should reject invalid run current_phase', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO runs (run_id, harness_id, temporal_workflow_id, status, current_phase)
          VALUES (gen_random_uuid(), ${harnessId}::uuid, 'test-wf', 'RUNNING', 'BOGUS_PHASE')
        `,
      ).rejects.toThrow(/runs_current_phase_check/);
    });

    it('should accept all valid run statuses', async () => {
      const validStatuses = ['RUNNING', 'WAITING_FOR_HUMAN', 'STALLED', 'COMPLETED', 'FAILED'];
      for (const status of validStatuses) {
        const result = await prisma.$executeRaw`
          INSERT INTO runs (run_id, harness_id, temporal_workflow_id, status, current_phase)
          VALUES (gen_random_uuid(), ${harnessId}::uuid, ${'wf-status-' + status}, ${status}, 'TRIGGER')
        `;
        expect(result).toBe(1);
      }
    });

    it('should accept all valid run phases', async () => {
      const validPhases = ['TRIGGER', 'ACQUIRE', 'PLAN', 'EXECUTE', 'SHIP'];
      for (const phase of validPhases) {
        const result = await prisma.$executeRaw`
          INSERT INTO runs (run_id, harness_id, temporal_workflow_id, status, current_phase)
          VALUES (gen_random_uuid(), ${harnessId}::uuid, ${'wf-phase-' + phase}, 'RUNNING', ${phase})
        `;
        expect(result).toBe(1);
      }
    });

    it('should reject invalid rule enforcement', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO rules (rule_id, harness_id, name, constraint_text, enforcement, pattern_type)
          VALUES (gen_random_uuid(), ${harnessId}::uuid, 'bad-rule', 'test', 'maybe', 'path')
        `,
      ).rejects.toThrow(/rules_enforcement_check/);
    });

    it('should reject invalid rule pattern_type', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO rules (rule_id, harness_id, name, constraint_text, enforcement, pattern_type)
          VALUES (gen_random_uuid(), ${harnessId}::uuid, 'bad-rule', 'test', 'hard', 'wildcard')
        `,
      ).rejects.toThrow(/rules_pattern_type_check/);
    });

    it('should accept valid rule enforcement and pattern_type', async () => {
      const combos = [
        { enforcement: 'hard', patternType: 'path' },
        { enforcement: 'hard', patternType: 'regex' },
        { enforcement: 'hard', patternType: 'semantic' },
        { enforcement: 'soft', patternType: 'path' },
        { enforcement: 'soft', patternType: 'regex' },
        { enforcement: 'soft', patternType: 'semantic' },
      ];
      for (const { enforcement, patternType } of combos) {
        const result = await prisma.$executeRaw`
          INSERT INTO rules (rule_id, harness_id, name, constraint_text, enforcement, pattern_type)
          VALUES (gen_random_uuid(), ${harnessId}::uuid, ${'rule-' + enforcement + '-' + patternType}, 'test', ${enforcement}, ${patternType})
        `;
        expect(result).toBe(1);
      }
    });
  });

  describe('indexes', () => {
    it('should have HNSW index on memory_records.embedding', async () => {
      const result = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'memory_records' AND indexname = 'memory_embedding_hnsw'
      `;
      expect(result).toHaveLength(1);
    });

    it('should have partial index for open gate threads', async () => {
      const result = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'gate_events' AND indexname = 'gate_events_open_thread'
      `;
      expect(result).toHaveLength(1);
    });

    it('should have unique index on users.email', async () => {
      const result = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'users' AND indexname = 'users_email_key'
      `;
      expect(result).toHaveLength(1);
    });

    it('should have unique index on memory_records (harness_id, content_hash)', async () => {
      const result = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'memory_records' AND indexname = 'memory_records_harness_content_hash'
      `;
      expect(result).toHaveLength(1);
    });
  });

  describe('memory_type enum', () => {
    it('should have all expected enum values', async () => {
      const result = await prisma.$queryRaw<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
        WHERE pg_type.typname = 'memory_type'
        ORDER BY enumlabel
      `;
      const values = result.map((r) => r.enumlabel);
      expect(values).toEqual([
        'FileConvention',
        'GatePattern',
        'RepoMap',
        'RiskSignal',
        'TaskPattern',
        'TeamConvention',
      ]);
    });
  });
});
