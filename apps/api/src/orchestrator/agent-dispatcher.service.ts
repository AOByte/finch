import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RunRepository } from '../persistence/run.repository';
import { AgentConfigService } from '../agents/agent-config.service';
import { RuleEnforcementService } from './rule-enforcement.service';
import { AuditLoggerService } from '../audit/audit-logger.service';
import { LLMRegistryService } from '../llm/llm-registry.service';
import { MemoryConnectorService } from '../memory/memory-connector.service';
import { MCPRegistryService } from '../mcp/mcp-registry.service';
import { GateEvent } from '../agents/gate-event';
import { ForcedGateError } from '../agents/errors';
import { finchPhaseDurationSeconds } from '../telemetry';
import type {
  Phase,
  AgentStepConfig,
  AgentContext,
  TriggerSource,
  GateSnapshot,
  GateASnapshot,
  GatePSnapshot,
  GateESnapshot,
  LLMConnector,
} from '@finch/types';

// Locked preamble — framework-owned, server-side injected, never user-editable
const LOCKED_PREAMBLE = `You are a TAPES framework agent. Your role is governed by the phase you are operating in.

CRITICAL GATE PROTOCOL:
When you identify a context gap — missing information that prevents you from completing your task —
you MUST use the fire_gate tool to request human clarification. Do NOT guess or fabricate information.

A context gap exists when:
- The task description is ambiguous or incomplete
- Required file paths, module names, or identifiers are unknown
- Business requirements are unclear or contradictory
- You lack sufficient context to make an informed decision

When you detect a context gap, call fire_gate with:
- gapDescription: A clear explanation of what information is missing
- question: A specific, actionable question for the human operator`;

export interface DispatchPhaseParams {
  runId: string;
  harnessId: string;
  phase: Phase;
  input: unknown;
  source: TriggerSource;
  temporalWorkflowId?: string;
  resumeFromSnapshot?: GateSnapshot;
}

@Injectable()
export class AgentDispatcherService {
  private readonly logger = new Logger(AgentDispatcherService.name);

  private phaseRunners: Map<Phase, (input: unknown, context: AgentContext) => Promise<unknown | GateEvent>> = new Map();

  constructor(
    private readonly runRepository: RunRepository,
    private readonly agentConfigService: AgentConfigService,
    private readonly ruleEnforcement: RuleEnforcementService,
    private readonly auditLogger: AuditLoggerService,
    private readonly llmRegistry: LLMRegistryService,
    private readonly memoryConnector: MemoryConnectorService,
    @Optional() private readonly mcpRegistry?: MCPRegistryService,
  ) {}

  registerPhaseRunner(
    phase: Phase,
    runner: (input: unknown, context: AgentContext) => Promise<unknown | GateEvent>,
  ): void {
    this.phaseRunners.set(phase, runner);
  }

  getLockedPreamble(): string {
    return LOCKED_PREAMBLE;
  }

  async dispatchPhase(params: DispatchPhaseParams): Promise<unknown | GateEvent> {
    const { runId, harnessId, phase, input, source, temporalWorkflowId, resumeFromSnapshot } = params;

    const pipeline = await this.agentConfigService.getPipeline(phase, harnessId);
    const agents = pipeline.agents;

    if (agents.length === 0) {
      this.logger.warn(`No agents configured for phase ${phase} in harness ${harnessId}`);
      return input;
    }

    const phaseStartTime = Date.now();
    let currentArtifact = input;
    let startPosition = 0;

    try {
      // Gate resume path: restore from snapshot
      if (resumeFromSnapshot) {
        const snapshot = resumeFromSnapshot;
        startPosition = snapshot.pipelinePosition;

        // Emit agent_skipped_on_resume for each skipped agent
        for (let i = 0; i < startPosition; i++) {
          if (i < agents.length) {
            await this.auditLogger.log({
              runId,
              harnessId,
              phase,
              eventType: 'agent_skipped_on_resume',
              actor: { agentId: agents[i].agentId },
              payload: { skippedPosition: i, resumePosition: startPosition },
            });
          }
        }

        // Restore artifact from snapshot's agentOutputsBeforeGate
        const outputs = snapshot.agentOutputsBeforeGate;
        if (outputs.length > 0) {
          const lastOutput = outputs[outputs.length - 1];
          currentArtifact = lastOutput.artifact;
        }
      }

      // Pipeline execution
      for (let position = startPosition; position < agents.length; position++) {
        const agentConfig = agents[position];

        // FF-09: updatePipelinePosition BEFORE agent invocation
        await this.runRepository.updatePipelinePosition(
          runId,
          phase,
          position,
          JSON.parse(JSON.stringify(currentArtifact ?? {})) as Prisma.InputJsonValue,
        );

        // Build agent context
        const context: AgentContext = {
          runId,
          harnessId,
          phase,
          agentConfig,
          source,
          pipelinePosition: position,
          temporalWorkflowId,
        };

        // Check hard rules before agent invocation
        const hardResult = await this.ruleEnforcement.checkHardRules(
          agentConfig.rules,
          currentArtifact,
        );
        if (hardResult.violated) {
          return new GateEvent({
            phase,
            runId,
            harnessId,
            gapDescription: `Hard rule violated: ${hardResult.rule?.constraint ?? 'unknown'}`,
            question: hardResult.gateQuestion ?? 'How should we proceed?',
            source,
            agentId: agentConfig.agentId,
            pipelinePosition: position,
            temporalWorkflowId,
          });
        }

        // Invoke agent
        await this.auditLogger.log({
          runId,
          harnessId,
          phase,
          eventType: 'agent_invoked',
          actor: { agentId: agentConfig.agentId },
          payload: { position, model: agentConfig.model },
        });

        const runner = this.phaseRunners.get(phase);
        if (!runner) {
          throw new Error(`No phase runner registered for phase: ${phase}`);
        }

        const result = await runner(currentArtifact, context);

        // Belt-and-suspenders: if an agent somehow returns a GateEvent in a
        // gate-free phase (TRIGGER / SHIP), throw ForcedGateError (FC-01/FC-07).
        if (result instanceof GateEvent &&
            (phase === 'TRIGGER' || phase === 'SHIP')) {
          throw new ForcedGateError(
            `Agent returned GateEvent in gate-free phase ${phase} (FC-01/FC-07). ` +
            `AgentId: ${result.agentId}, RunId: ${runId}.`,
          );
        }

        // If agent fired a gate, build snapshot and return
        if (result instanceof GateEvent) {
          const snapshot = await this.buildSnapshot(
            phase,
            position,
            currentArtifact,
            runId,
            agents,
            params,
          );
          result.snapshot = snapshot;
          return result;
        }

        // Check soft rules after agent invocation (against agent output, not input)
        const softResult = await this.ruleEnforcement.checkSoftRules(
          agentConfig.rules,
          result,
        );
        for (const deviation of softResult.deviations) {
          await this.auditLogger.log({
            runId,
            harnessId,
            phase,
            eventType: 'rule_deviation',
            actor: { agentId: agentConfig.agentId },
            payload: { rule: deviation.rule.constraint, reason: deviation.reason },
          });
        }

        await this.auditLogger.log({
          runId,
          harnessId,
          phase,
          eventType: 'agent_completed',
          actor: { agentId: agentConfig.agentId },
          payload: { position },
        });

        currentArtifact = result;
      }

      return currentArtifact;
    } finally {
      // W6-09: Always record phase duration, even on gate fire or error
      const phaseDurationSec = (Date.now() - phaseStartTime) / 1000;
      finchPhaseDurationSeconds.record(phaseDurationSec, {
        phase,
        harness_id: harnessId,
      });
    }
  }

  private async buildSnapshot(
    phase: Phase,
    position: number,
    artifactAtSuspension: unknown,
    runId: string,
    _agents: AgentStepConfig[],
    params: DispatchPhaseParams,
  ): Promise<GateSnapshot> {
    const outputs: { position: number; artifact: unknown }[] = [];
    for (let i = 0; i < position; i++) {
      const persisted = await this.runRepository.getPersistedPipelineArtifact(runId, phase, i);
      if (persisted !== null) {
        outputs.push({ position: i, artifact: persisted });
      }
    }

    const base = {
      pipelinePosition: position,
      artifactAtSuspension,
      agentOutputsBeforeGate: outputs,
    };

    if (phase === 'ACQUIRE') {
      return base as GateASnapshot;
    }
    if (phase === 'PLAN') {
      return {
        ...base,
        contextObject: params.input,
      } as GatePSnapshot;
    }
    return {
      ...base,
      executionProgress: {
        completedSubTaskIds: [],
        modifiedFiles: [],
        verificationResultsSoFar: [],
      },
      planArtifact: params.input,
      contextObject: params.input,
    } as GateESnapshot;
  }

  getLLM(agentConfig: AgentStepConfig): LLMConnector {
    return this.llmRegistry.get(agentConfig.llmProvider || 'anthropic');
  }

  getMemoryConnector(): MemoryConnectorService {
    return this.memoryConnector;
  }

  getAuditLogger(): AuditLoggerService {
    return this.auditLogger;
  }

  getMCPRegistry(): MCPRegistryService | undefined {
    return this.mcpRegistry;
  }
}
