/**
 * All audit event types that must have at least one emit site in the codebase (AU-01).
 * Critical events are written synchronously; non-critical via BullMQ (AU-03).
 */
export const CRITICAL_AUDIT_EVENT_TYPES = [
  'gate_fired',
  'gate_question_sent',
  'phase_started',
  'phase_completed',
  'run_completed',
  'run_failed',
  'run_stopped',
  'gate_traversal_backward',
] as const;

export const NON_CRITICAL_AUDIT_EVENT_TYPES = [
  'agent_skipped_on_resume',
  'tool_call',
  'llm_call',
  'memory_staged',
  'memory_read',
  'memory_merged',
  'ship_completed',
  'ship_failed',
  'connector_queried',
  'verification_run',
  'verification_result',
  'rule_deviation',
  'skill_applied',
  'artifact_handoff',
  'agent_invoked',
  'agent_completed',
  'gate_resumed',
  'agent_anomaly',
  'parse_output_fallback',
  'mcp_tool_call',
] as const;

export const REQUIRED_AUDIT_EVENT_TYPES = [
  ...CRITICAL_AUDIT_EVENT_TYPES,
  ...NON_CRITICAL_AUDIT_EVENT_TYPES,
] as const;

export type AuditEventType = (typeof REQUIRED_AUDIT_EVENT_TYPES)[number];

export function isCriticalEvent(eventType: string): boolean {
  return (CRITICAL_AUDIT_EVENT_TYPES as readonly string[]).includes(eventType);
}
