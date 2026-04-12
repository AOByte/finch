/**
 * Thrown when an agent returns a GateEvent in a gate-free phase (TRIGGER or SHIP).
 * Added to nonRetryableErrorTypes in finch.workflow.ts — Temporal will not retry this.
 */
export class ForcedGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForcedGateError';
  }
}

/**
 * Thrown when parseOutput() fails to parse the LLM response as valid JSON
 * after exhausting retry attempts. Added to nonRetryableErrorTypes.
 */
export class ParseOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseOutputError';
  }
}
