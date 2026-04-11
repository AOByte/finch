# Skill: NestJS Patterns

> Read this before implementing any NestJS module, service, guard, or controller.
> The mistakes below produce runtime errors that only surface when the app boots, or subtler bugs that only appear under load.

---

## Module structure

Every module in Finch has the same shape:

```typescript
@Module({
  imports: [],      // other modules this module depends on
  providers: [],    // services, guards, processors registered in this module
  exports: [],      // services that other modules can inject
  controllers: [],  // HTTP controllers (ApiModule only)
})
export class SomeModule {}
```

**Export only what other modules need to inject.** If a service is only used internally within its module, do not export it. Exporting everything is a smell that leads to hidden coupling.

**Import the module, not the service.** When module A needs a service from module B, module A imports `ModuleB` — not `SomeService` directly. NestJS resolves the provider from the imported module.

---

## Circular dependencies

Circular imports (`ModuleA` imports `ModuleB` which imports `ModuleA`) cause NestJS to throw at boot time. The module tree in `AGENTS.md` section 7 is the authoritative dependency graph — follow it.

**Specific risk in Finch:** `GateControllerService` and `AgentDispatcherService` are both in `OrchestratorModule`. The dispatcher needs the gate controller (to call `dispatch()` when a gate fires) and the gate controller needs the dispatcher indirectly. Both services are in the same module — they share a provider scope without any cross-module import, so there is no circular dependency. **Do not move `GateControllerService` into its own module.** If you do, `OrchestratorModule` would need to import the new module while the new module needs services back from `OrchestratorModule`, creating a circular import. Keep all orchestration services co-located in `OrchestratorModule`.

If you encounter a genuine circular dependency elsewhere, the correct resolution is:
1. Extract the shared dependency into a new leaf module
2. Use `forwardRef()` as a last resort — acceptable but fragile

`PersistenceModule` and `AuditModule` are leaf nodes. They must never import any module above them in the tree.

---

## Dependency injection and `@Injectable()`

Every service that is injected elsewhere must be decorated with `@Injectable()` and declared in a module's `providers` array. If other modules need to inject it, it must also be in `exports`.

Constructor injection is the only pattern used in Finch:

```typescript
@Injectable()
export class AcquireAgentService {
  constructor(
    private readonly llmRegistry: LLMRegistryService,
    private readonly memoryConnector: MemoryConnectorService,
    private readonly dispatcher: AgentDispatcherService,
  ) {}
}
```

Do not use property injection (`@Inject()` on a property). Do not use `ModuleRef.get()` at runtime to resolve services dynamically — this bypasses the DI container's lifecycle management and makes services untestable.

---

## Injecting the Temporal `WorkflowClient`

`GateControllerService` needs a `WorkflowClient` to signal running workflows. The correct pattern is a custom provider in `WorkflowModule`:

```typescript
// workflow/workflow.module.ts
import { WorkflowClient } from '@temporalio/client';

@Module({
  providers: [
    TemporalWorkerService,
    {
      provide: WorkflowClient,
      useFactory: () => new WorkflowClient({
        address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      }),
    },
  ],
  exports: [WorkflowClient, TemporalWorkerService],
})
export class WorkflowModule {}
```

`OrchestratorModule` imports `WorkflowModule`, so `GateControllerService` can inject `WorkflowClient` normally via constructor injection. Do not instantiate `new WorkflowClient()` inside a service method — it bypasses DI and creates a new connection on every call. Do not use `ModuleRef.get(WorkflowClient)` at runtime.

---

## Temporal worker lifetime inside NestJS

`TemporalWorkerService` starts the Temporal worker in `onModuleInit`. The critical rule: **`worker.run()` must never be awaited inside `onModuleInit`**.

`worker.run()` is a long-running process that does not resolve while the worker is healthy. Awaiting it inside `onModuleInit` blocks the NestJS bootstrap process entirely — the API server never starts, no HTTP routes become available, and the app appears to hang with no error.

**Correct pattern:**
```typescript
@Injectable()
export class TemporalWorkerService implements OnModuleInit {
  async onModuleInit() {
    const worker = await Worker.create({
      workflowsPath: require.resolve('./finch.workflow'),
      activities: { ... },
      taskQueue: 'finch',
    });

    // Detached — does not block NestJS bootstrap
    worker.run().catch(err => {
      this.logger.error({ err }, 'Temporal worker crashed');
      process.exit(1);
    });
  }
}
```

The `.catch(err => process.exit(1))` is intentional. A crashed worker should bring down the process so the container orchestrator restarts it cleanly rather than leaving a silent zombie process.

---

## Lifecycle hooks for connector self-registration

Connectors register themselves in `onModuleInit()`. This fires after the module is fully initialised, meaning all injected dependencies are ready.

```typescript
@Injectable()
export class SlackConnectorService implements TriggerConnector, OnModuleInit {
  constructor(private readonly registry: ConnectorRegistryService) {}

  async onModuleInit() {
    this.registry.register('trigger', 'slack', this);
    await this.initializeBoltApp();
  }
}
```

Do not do connector initialisation in the constructor — injected dependencies may not be ready yet. Do not use `OnModuleDestroy` for cleanup unless you have a specific reason; ephemeral resources like git workspaces are cleaned up in `finally` blocks at the call site, not in lifecycle hooks.

---

## Guards

Guards implement `CanActivate` and return `true` (allow) or throw an `HttpException` (deny). They must not return `false` — returning false causes a generic 403 with no meaningful error message.

```typescript
@Injectable()
export class HarnessAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!authorised) throw new ForbiddenException();
    return true;
  }
}
```

Apply guards at the controller or route level with `@UseGuards()`. The `LockedPreambleGuard` applies only to agent configuration update routes — do not apply it globally.

---

## Controllers and DTOs

All request bodies use class-validator DTOs with decorators like `@IsString()`, `@IsNotEmpty()`, `@MaxLength()`. The global `ValidationPipe` is configured in `main.ts`.

All responses use the envelope shape `{ data, meta?, error? }`. Controllers return `{ data: result }` — they never return raw entities.

Controllers must not contain business logic. Validate the request, call a service, return the result. Anything beyond that belongs in the service.

---

## BullMQ processors

Queue processors are decorated with `@Processor('queue-name')`. The queue name must match the name used when enqueueing. Processors are declared as providers in the relevant module.

```typescript
@Processor('gate-timeout')
export class GateTimeoutProcessor {
  @Process('gate-timeout')
  async handle(job: Job<{ gateId: string; runId: string }>) {
    // ...
  }
}
```

Processors must be idempotent — BullMQ retries on failure. Check for already-resolved state at the start of the handler before doing any work.

---

## Configuration

Environment variables are accessed via NestJS `ConfigService`, injected through `ConfigModule.forRoot()`. Do not use `process.env` directly inside services. The exception is `main.ts` and custom provider `useFactory` functions where `ConfigService` is not yet available.

```typescript
// Good
this.config.get<string>('ANTHROPIC_API_KEY')

// Bad — inside a service method
process.env.ANTHROPIC_API_KEY
```
