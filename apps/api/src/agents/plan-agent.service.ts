import { Injectable, Logger } from '@nestjs/common';
import { BaseAgent } from './base-agent';
import { GateEvent } from './gate-event';
import { ParseOutputError } from './errors';
import type {
  LLMConnector,
  LLMResponse,
  AgentContext,
  Tool,
  AuditEventData,
} from '@finch/types';
import type { ContextObject, PlanArtifact, PlanStep } from '../workflow/types';
import { AgentDispatcherService } from '../orchestrator/agent-dispatcher.service';

@Injectable()
export class PlanAgentService extends BaseAgent<ContextObject, PlanArtifact> {
  private readonly logger = new Logger(PlanAgentService.name);

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

  buildInitialMessage(input: ContextObject): string {
    return `Create an execution plan based on the acquired context.\n\nFiles: ${input.files.join(', ')}\nDependencies: ${input.dependencies.join(', ')}`;
  }

  buildToolSet(_context: AgentContext): Tool[] {
    return [
      {
        name: 'fire_gate',
        description: 'Fire a clarification gate when you identify a context gap. Gate P fires on context gap ONLY — never for plan approval.',
        inputSchema: {
          type: 'object',
          properties: {
            gapDescription: { type: 'string', description: 'What information is missing' },
            question: { type: 'string', description: 'Specific question for the human' },
          },
          required: ['gapDescription', 'question'],
        },
      },
    ];
  }

  parseOutput(response: LLMResponse): PlanArtifact {
    try {
      const parsed = JSON.parse(response.text);
      // Normalize string steps to PlanStep objects
      if (Array.isArray(parsed.steps)) {
        parsed.steps = parsed.steps.map((s: string | PlanStep) =>
          typeof s === 'string' ? { description: s } : s,
        );
      }
      return parsed as PlanArtifact;
    } catch (err) {
      throw new ParseOutputError(
        `PlanAgent failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  parseFallback(response: LLMResponse): PlanArtifact {
    return {
      runId: '',
      hasGap: false,
      steps: [{ description: response.text }],
    };
  }

  async executeToolCall(
    _toolName: string,
    _toolInput: Record<string, unknown>,
    _context: AgentContext,
  ): Promise<unknown> {
    return { error: 'Unknown tool' };
  }

  async runPlan(input: ContextObject, context: AgentContext): Promise<PlanArtifact | GateEvent> {
    await this.dispatcher.getAuditLogger().log({
      runId: context.runId,
      harnessId: context.harnessId,
      phase: 'PLAN',
      eventType: 'phase_started',
      payload: { fileCount: input.files.length },
    });

    const result = await this.run(input, context);

    if (result instanceof GateEvent) {
      return result;
    }

    const plan: PlanArtifact = {
      ...result,
      runId: input.runId,
    };

    await this.dispatcher.getAuditLogger().log({
      runId: context.runId,
      harnessId: context.harnessId,
      phase: 'PLAN',
      eventType: 'phase_completed',
      payload: { stepCount: plan.steps.length, steps: plan.steps.map((s: PlanStep) => ({ description: s.description, repoId: s.repoId })) },
    });

    return plan;
  }
}
