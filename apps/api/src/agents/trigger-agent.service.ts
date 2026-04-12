import { Injectable, Logger } from '@nestjs/common';
import { BaseAgent, AgentLoopParams } from './base-agent';
import { GateEvent } from './gate-event';
import { ParseOutputError } from './errors';
import type {
  LLMConnector,
  LLMResponse,
  AgentContext,
  Tool,
  AuditEventData,
} from '@finch/types';
import type { RawTriggerInput, TaskDescriptor } from '../workflow/types';
import { AgentDispatcherService } from '../orchestrator/agent-dispatcher.service';

@Injectable()
export class TriggerAgentService extends BaseAgent<RawTriggerInput, TaskDescriptor> {
  private readonly logger = new Logger(TriggerAgentService.name);

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

  buildInitialMessage(input: RawTriggerInput): string {
    return `Normalize the following raw task input into a structured task descriptor.\n\nRaw text: ${input.rawText}\nHarness: ${input.harnessId}\nRun: ${input.runId}`;
  }

  buildToolSet(_context: AgentContext): Tool[] {
    // Trigger agent is stateless — no gate, no memory, no tools
    return [];
  }

  parseOutput(response: LLMResponse): TaskDescriptor {
    try {
      return JSON.parse(response.text) as TaskDescriptor;
    } catch (err) {
      throw new ParseOutputError(
        `TriggerAgent failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  parseFallback(response: LLMResponse): TaskDescriptor {
    return {
      runId: '',
      harnessId: '',
      normalizedPrompt: response.text,
      intent: 'unknown',
      scope: [],
    };
  }

  async executeToolCall(
    _toolName: string,
    _toolInput: Record<string, unknown>,
    _context: AgentContext,
  ): Promise<unknown> {
    // Trigger agent has no tools
    return { error: 'No tools available for trigger agent' };
  }

  async runTrigger(input: RawTriggerInput, context: AgentContext): Promise<TaskDescriptor | GateEvent> {
    await this.dispatcher.getAuditLogger().log({
      runId: context.runId,
      harnessId: context.harnessId,
      phase: 'TRIGGER',
      eventType: 'phase_started',
      payload: { rawText: input.rawText },
    });

    const result = await this.run(input, context);

    if (result instanceof GateEvent) {
      return result;
    }

    // Ensure runId and harnessId are set
    const descriptor: TaskDescriptor = {
      ...result,
      runId: input.runId,
      harnessId: input.harnessId,
    };

    await this.dispatcher.getAuditLogger().log({
      runId: context.runId,
      harnessId: context.harnessId,
      phase: 'TRIGGER',
      eventType: 'phase_completed',
      payload: { normalizedPrompt: descriptor.normalizedPrompt },
    });

    return descriptor;
  }
}
