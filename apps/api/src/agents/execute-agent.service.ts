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
import type { PlanArtifact, ContextObject, VerificationReport } from '../workflow/types';
import { AgentDispatcherService } from '../orchestrator/agent-dispatcher.service';

export interface ExecuteInput {
  plan: PlanArtifact;
  context: ContextObject;
}

@Injectable()
export class ExecuteAgentService extends BaseAgent<ExecuteInput, VerificationReport> {
  private readonly logger = new Logger(ExecuteAgentService.name);

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

  buildInitialMessage(input: ExecuteInput): string {
    return `Execute the following plan steps and produce a verification report.\n\nSteps: ${input.plan.steps.map(s => s.description).join('\n')}\nFiles: ${input.context.files.join(', ')}`;
  }

  buildToolSet(_context: AgentContext): Tool[] {
    return [
      {
        name: 'fire_gate',
        description: 'Fire a clarification gate when you identify a context gap. Gate E fires on context gap — NOT on technical failures.',
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

  parseOutput(response: LLMResponse): VerificationReport {
    try {
      return JSON.parse(response.text) as VerificationReport;
    } catch (err) {
      throw new ParseOutputError(
        `ExecuteAgent failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  parseFallback(response: LLMResponse): VerificationReport {
    // W4-00b safety: NEVER claim allPassing on parse failure
    return {
      runId: '',
      hasGap: false,
      allPassing: false,
      results: [response.text],
    };
  }

  async executeToolCall(
    _toolName: string,
    _toolInput: Record<string, unknown>,
    _context: AgentContext,
  ): Promise<unknown> {
    return { error: 'Unknown tool' };
  }

  async runExecute(
    plan: PlanArtifact,
    context: ContextObject,
    agentContext: AgentContext,
  ): Promise<VerificationReport | GateEvent> {
    await this.dispatcher.getAuditLogger().log({
      runId: agentContext.runId,
      harnessId: agentContext.harnessId,
      phase: 'EXECUTE',
      eventType: 'phase_started',
      payload: { stepCount: plan.steps.length },
    });

    const input: ExecuteInput = { plan, context };
    const result = await this.run(input, agentContext);

    if (result instanceof GateEvent) {
      return result;
    }

    const report: VerificationReport = {
      ...result,
      runId: plan.runId,
    };

    await this.dispatcher.getAuditLogger().log({
      runId: agentContext.runId,
      harnessId: agentContext.harnessId,
      phase: 'EXECUTE',
      eventType: 'phase_completed',
      payload: { allPassing: report.allPassing, resultCount: report.results.length },
    });

    return report;
  }
}
