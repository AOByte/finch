import { describe, it, expect } from 'vitest';
import {
  CRITICAL_AUDIT_EVENT_TYPES,
  NON_CRITICAL_AUDIT_EVENT_TYPES,
  REQUIRED_AUDIT_EVENT_TYPES,
  isCriticalEvent,
} from '../../src/audit/audit-event-types';

describe('audit-event-types', () => {
  it('REQUIRED_AUDIT_EVENT_TYPES contains all critical and non-critical types', () => {
    expect(REQUIRED_AUDIT_EVENT_TYPES.length).toBe(
      CRITICAL_AUDIT_EVENT_TYPES.length + NON_CRITICAL_AUDIT_EVENT_TYPES.length,
    );
    for (const t of CRITICAL_AUDIT_EVENT_TYPES) {
      expect(REQUIRED_AUDIT_EVENT_TYPES).toContain(t);
    }
    for (const t of NON_CRITICAL_AUDIT_EVENT_TYPES) {
      expect(REQUIRED_AUDIT_EVENT_TYPES).toContain(t);
    }
  });

  it('isCriticalEvent returns true for critical events', () => {
    expect(isCriticalEvent('gate_fired')).toBe(true);
    expect(isCriticalEvent('phase_started')).toBe(true);
    expect(isCriticalEvent('run_completed')).toBe(true);
  });

  it('isCriticalEvent returns false for non-critical events', () => {
    expect(isCriticalEvent('tool_call')).toBe(false);
    expect(isCriticalEvent('llm_call')).toBe(false);
    expect(isCriticalEvent('memory_read')).toBe(false);
  });

  it('isCriticalEvent returns false for unknown events', () => {
    expect(isCriticalEvent('unknown_event')).toBe(false);
  });

  it('has expected critical event types', () => {
    expect(CRITICAL_AUDIT_EVENT_TYPES).toContain('gate_fired');
    expect(CRITICAL_AUDIT_EVENT_TYPES).toContain('gate_question_sent');
    expect(CRITICAL_AUDIT_EVENT_TYPES).toContain('phase_started');
    expect(CRITICAL_AUDIT_EVENT_TYPES).toContain('phase_completed');
    expect(CRITICAL_AUDIT_EVENT_TYPES).toContain('run_completed');
    expect(CRITICAL_AUDIT_EVENT_TYPES).toContain('run_failed');
    expect(CRITICAL_AUDIT_EVENT_TYPES).toContain('gate_traversal_backward');
  });

  it('has expected non-critical event types', () => {
    expect(NON_CRITICAL_AUDIT_EVENT_TYPES).toContain('tool_call');
    expect(NON_CRITICAL_AUDIT_EVENT_TYPES).toContain('llm_call');
    expect(NON_CRITICAL_AUDIT_EVENT_TYPES).toContain('memory_read');
    expect(NON_CRITICAL_AUDIT_EVENT_TYPES).toContain('memory_staged');
    expect(NON_CRITICAL_AUDIT_EVENT_TYPES).toContain('rule_deviation');
    expect(NON_CRITICAL_AUDIT_EVENT_TYPES).toContain('agent_skipped_on_resume');
    expect(NON_CRITICAL_AUDIT_EVENT_TYPES).toContain('gate_resumed');
  });
});
