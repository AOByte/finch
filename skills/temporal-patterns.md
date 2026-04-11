# Skill: Temporal Patterns

> Read this before implementing anything in `apps/api/src/workflow/` or any Temporal Activity.
> Temporal has sharp edges. The mistakes below are silent — the code compiles, tests pass, and then the system behaves incorrectly under replay or concurrent load.

---

## The fundamental rule: workflows are deterministic, activities are not

The Temporal workflow function (`finch.workflow.ts`) is replayed from scratch on every worker restart and on every activity retry. Temporal compares the replayed execution against the stored event history. Any non-determinism causes a **non-deterministic error** that stalls the workflow permanently.

**In the workflow function — never:**
- Call `Date.now()` or `new Date()` — use `workflow.now()` instead
- Call `Math.random()`
- Import or call NestJS services directly
- Make HTTP requests, database calls, or any I/O
- Use `setTimeout` or `setInterval` — use `workflow.sleep()` instead
- Use non-deterministic iteration over object keys (key order is not guaranteed)
- Add a new branch to existing workflow code after deployment without a version check

**In activities — always allowed:**
- Database calls via repositories
- HTTP calls via connectors
- LLM calls via the LLM registry
- File system operations
- Any I/O whatsoever

---

## Activity timeouts and retries

Every `proxyActivities` call in `finch.workflow.ts` specifies `startToCloseTimeout` and a `retry` policy. The defaults for Finch are:

```typescript
const acts = proxyActivities<FinchActivities>({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['GateRequiredError', 'ScopeViolationError'],
  },
});
```

`GateRequiredError` and `ScopeViolationError` must not be retried — they represent intentional control flow, not transient failures. If you add new error types that represent intentional outcomes (not transient failures), add them to `nonRetryableErrorTypes`.

---

## Signals

Signals are how external systems communicate with a running workflow. Finch uses two:

```typescript
export const gateResolvedSignal = defineSignal<[GateResolution]>('gate_resolved');
export const stopRunSignal = defineSignal('stop_run');
```

Signal handler registration via `setHandler` must happen **before** any `await` in the workflow that could cause the workflow to suspend. If you register a signal handler after an `await`, there is a race condition where the signal arrives before the handler is registered and is silently dropped.

**Correct pattern:**
```typescript
export async function finchWorkflow(rawInput: RawTriggerInput): Promise<RunResult> {
  let stopped = false;
  setHandler(stopRunSignal, () => { stopped = true; }); // register before first await

  const taskDescriptor = await acts.runTriggerPhase(rawInput); // first await
  // ...
}
```

---

## `condition()` and gate waiting

The workflow uses `condition()` to wait for gate resolution:

```typescript
async function waitForGateResolution(runId: string): Promise<GateResolution> {
  let resolution: GateResolution | null = null;
  setHandler(gateResolvedSignal, (r) => { resolution = r; });
  await condition(() => resolution !== null, '48 hours');
  if (!resolution) throw new Error(`Gate timeout for run ${runId}`);
  return resolution;
}
```

**`setHandler` is called inside `waitForGateResolution`, which is called multiple times (once per gate firing).** Calling `setHandler` twice on the same signal replaces the previous handler. This is safe in Finch because only one gate is active per run at any time — the workflow blocks on `condition()` until the gate resolves before the next gate becomes possible. The handler replacement is therefore always sequential, never concurrent. If you extend this pattern to support concurrent gates (multiple gates active simultaneously), you will need separate signal types per gate instance or a signal with a gate ID discriminator — otherwise the second handler registration silently drops responses intended for the first gate.

The `'48 hours'` timeout is a Temporal duration string — not a JavaScript timeout. If the condition is not met within 48 hours, `condition()` resolves to `false`. The null check after is therefore load-bearing and must not be removed.

Do not use `Promise.race()` or any JavaScript timing mechanism to implement gate waiting. Only `condition()` is replay-safe.

---

## Parallel activities with `Promise.all`

The Ship phase uses `Promise.all` over multiple `proxyActivities` calls for multi-repo fan-out:

```typescript
const shipPromises = repos.map(repo =>
  acts.runShipPhase(planArtifact, verificationReport, contextObject, repo.repoId)
    .then(result => ({ repoId: repo.repoId, status: 'success' as const, result }))
    .catch(err => ({ repoId: repo.repoId, status: 'failed' as const, error: err.message }))
);
const shipResults = await Promise.all(shipPromises);
```

**`Promise.all` over `proxyActivities` calls is deterministic and replay-safe in Temporal.** When Temporal encounters the parallel awaits, it schedules all activities upfront and records them in the event history. On replay, the resolved values are read from history — the activities are not re-executed. This is not non-determinism. Do not add `Promise.all` avoidance workarounds or serialise the fan-out into sequential calls thinking it is safer.

---

## Audit activities from inside the workflow

Some activities in Finch are called purely for their side effect (logging) rather than for their return value. `logTraversalEvent` is the primary example. These activities have a non-obvious requirement: **they must be idempotent**.

Temporal may replay the workflow and call `logTraversalEvent` again for the same traversal. Without idempotency, the audit timeline shows duplicate traversal events. The idempotency pattern is a deduplication check at the start of the activity:

```typescript
async logTraversalEvent(params: {
  runId: string;
  gateId: string;
  fromPhase: Phase;
  toPhase: Phase;
}): Promise<void> {
  // Idempotency guard — Temporal replay will call this again; prevent duplicate events
  const existing = await this.auditRepository.findByGateIdAndEventType(
    params.gateId,
    'gate_traversal_backward',
  );
  if (existing) return;

  await this.auditLogger.log({ ... });
}
```

The deduplication key is `gateId + eventType`. This combination is unique per traversal because each gate fires once and produces exactly one traversal event. Apply this pattern to any activity that writes a side effect that must appear exactly once regardless of how many times Temporal replays the workflow.

---

## Activities registration

All activities must be registered in `TemporalWorkerService.onModuleInit()` under their exact string key. The key used in `proxyActivities` type must match the key in the worker registration. They are matched by string, not by TypeScript type.

```typescript
// In TemporalWorkerService
activities: {
  runTriggerPhase: this.triggerAgent.runPhase.bind(this.triggerAgent),
  // 'runTriggerPhase' must match the property name in FinchActivities interface
}
```

If you add a new activity, update both: the `FinchActivities` interface in `finch.activities.ts` and the `activities` object in `TemporalWorkerService`.

---

## Workflow versioning

If you need to change the control flow of `finchWorkflow` after it has been deployed with live running workflows, use `patched()` to version the change. Changing deployed workflow control flow without versioning causes non-deterministic errors for all in-flight runs.

During initial development (before first production deployment), versioning is not required. Once the system is running in production with live workflows, any control flow change requires a version check.

---

## Testing Temporal code

Unit tests for workflow logic must use the Temporal test environment:

```typescript
import { TestWorkflowEnvironment } from '@temporalio/testing';
```

Do not unit test the workflow function by calling it directly. Temporal replay semantics are only available through the test environment. Activities can be unit tested by calling their functions directly against a real database (see Wave 2 integration tests in `TASKS.md`).
