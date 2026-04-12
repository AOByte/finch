import { Injectable, Logger } from '@nestjs/common';
import { BaseAgent } from './base-agent';
import { GateEvent } from './gate-event';
import type {
  LLMConnector,
  LLMResponse,
  AgentContext,
  Tool,
  AuditEventData,
} from '@finch/types';
import type { PlanArtifact, VerificationReport, ContextObject, ShipResult } from '../workflow/types';
import { AgentDispatcherService } from '../orchestrator/agent-dispatcher.service';

export interface ShipInput {
  plan: PlanArtifact;
  report: VerificationReport;
  context: ContextObject;
  repoId: string;
}

@Injectable()
export class ShipAgentService extends BaseAgent<ShipInput, ShipResult> {
  private readonly logger = new Logger(ShipAgentService.name);

  constructor(private readonly dispatcher: AgentDispatcherService) {
    super();
  }

  protected async auditLog(event: AuditEventData): Promise<void> {
    await this.dispatcher.getAuditLogger().log(event);
  }

  protected getLLM(): LLMConnector {
    return this.dispatcher.getLLM({ llmProvider: 'anthropic' } as AgentContext['agentConfig']);
  }

  buildLockedPreamble(): string {
    return this.dispatcher.getLockedPreamble();
  }

  buildInitialMessage(input: ShipInput): string {
    return `Ship the changes for repo ${input.repoId}.\n\nPlan steps: ${input.plan.steps.join('\n')}\nVerification: ${input.report.allPassing ? 'all passing' : 'some failing'}`;
  }

  buildToolSet(_context: AgentContext): Tool[] {
    // ShipAgent has NO gate — writes to memory staging only
    return [
      {
        name: 'stage_memory',
        description: 'Stage a memory record for later merge. Ship agent never calls mergeRecord() directly.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Memory type' },
            content: { type: 'string', description: 'Memory content' },
            relevanceTags: { type: 'array', items: { type: 'string' }, description: 'Relevance tags' },
          },
          required: ['type', 'content', 'relevanceTags'],
        },
      },
    ];
  }

  parseOutput(response: LLMResponse): ShipResult {
    try {
      const parsed = JSON.parse(response.text);
      return parsed as ShipResult;
    } catch {
      return {
        repoId: '',
        commitSha: 'stub-sha',
      };
    }
  }

  async executeToolCall(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: AgentContext,
  ): Promise<unknown> {
    if (toolName === 'stage_memory') {
      await this.dispatcher.getMemoryConnector().stageRecord({
        runId: context.runId,
        harnessId: context.harnessId,
        type: toolInput['type'] as string,
        content: toolInput['content'] as string,
        relevanceTags: toolInput['relevanceTags'] as string[],
      });

      await this.dispatcher.getAuditLogger().log({
        runId: context.runId,
        harnessId: context.harnessId,
        phase: 'SHIP',
        eventType: 'memory_staged',
        payload: { type: toolInput['type'] },
      });

      return { staged: true };
    }
    return { error: 'Unknown tool' };
  }

  async runShip(
    plan: PlanArtifact,
    report: VerificationReport,
    context: ContextObject,
    repoId: string,
    agentContext: AgentContext,
  ): Promise<ShipResult | GateEvent> {
    await this.dispatcher.getAuditLogger().log({
      runId: agentContext.runId,
      harnessId: agentContext.harnessId,
      phase: 'SHIP',
      eventType: 'phase_started',
      payload: { repoId },
    });

    const input: ShipInput = { plan, report, context, repoId };
    const result = await this.run(input, agentContext);

    if (result instanceof GateEvent) {
      // ShipAgent should NOT fire gates, but handle gracefully
      return result;
    }

    const shipResult: ShipResult = {
      ...result,
      repoId,
    };

    await this.dispatcher.getAuditLogger().log({
      runId: agentContext.runId,
      harnessId: agentContext.harnessId,
      phase: 'SHIP',
      eventType: 'phase_completed',
      payload: { repoId, prUrl: shipResult.prUrl },
    });

    return shipResult;
  }
}
