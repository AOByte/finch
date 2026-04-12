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
import type { TaskDescriptor, ContextObject } from '../workflow/types';
import { AgentDispatcherService } from '../orchestrator/agent-dispatcher.service';

@Injectable()
export class AcquireAgentService extends BaseAgent<TaskDescriptor, ContextObject> {
  private readonly logger = new Logger(AcquireAgentService.name);

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

  buildInitialMessage(input: TaskDescriptor): string {
    return `Acquire context for the following task.\n\nNormalized prompt: ${input.normalizedPrompt}\nIntent: ${input.intent}\nScope: ${input.scope.join(', ')}`;
  }

  buildToolSet(_context: AgentContext): Tool[] {
    return [
      {
        name: 'fire_gate',
        description: 'Fire a clarification gate when you identify a context gap.',
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

  parseOutput(response: LLMResponse): ContextObject {
    try {
      return JSON.parse(response.text) as ContextObject;
    } catch (err) {
      throw new ParseOutputError(
        `AcquireAgent failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  parseFallback(response: LLMResponse): ContextObject {
    return {
      runId: '',
      harnessId: '',
      hasGap: false,
      files: [],
      dependencies: [],
    };
  }

  async executeToolCall(
    _toolName: string,
    _toolInput: Record<string, unknown>,
    _context: AgentContext,
  ): Promise<unknown> {
    return { error: 'Unknown tool' };
  }

  async runAcquire(input: TaskDescriptor, context: AgentContext): Promise<ContextObject | GateEvent> {
    await this.dispatcher.getAuditLogger().log({
      runId: context.runId,
      harnessId: context.harnessId,
      phase: 'ACQUIRE',
      eventType: 'phase_started',
      payload: { normalizedPrompt: input.normalizedPrompt },
    });

    // ME-01: Query memory FIRST before any external connector
    const memoryHits = await this.dispatcher.getMemoryConnector().query(
      context.harnessId,
      input.normalizedPrompt,
    );

    await this.dispatcher.getAuditLogger().log({
      runId: context.runId,
      harnessId: context.harnessId,
      phase: 'ACQUIRE',
      eventType: 'memory_read',
      payload: { hitCount: memoryHits.length, query: input.normalizedPrompt },
    });

    const result = await this.run(input, context);

    if (result instanceof GateEvent) {
      return result;
    }

    const contextObj: ContextObject = {
      ...result,
      runId: input.runId,
      harnessId: input.harnessId,
    };

    await this.dispatcher.getAuditLogger().log({
      runId: context.runId,
      harnessId: context.harnessId,
      phase: 'ACQUIRE',
      eventType: 'phase_completed',
      payload: { hasGap: contextObj.hasGap, fileCount: contextObj.files.length },
    });

    return contextObj;
  }
}
