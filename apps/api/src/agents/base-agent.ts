import type {
  LLMConnector,
  LLMResponse,
  AgentContext,
  Tool,
  Message,
  AuditEventData,
} from '@finch/types';
import { GateEvent } from './gate-event';

export interface AgentLoopParams {
  llm: LLMConnector;
  systemPrompt: string;
  initialMessage: string;
  tools: Tool[];
  context: AgentContext;
}

export abstract class BaseAgent<TInput, TOutput> {
  protected abstract auditLog(event: AuditEventData): Promise<void>;

  abstract buildLockedPreamble(): string;
  abstract buildInitialMessage(input: TInput): string;
  abstract buildToolSet(context: AgentContext): Tool[];
  abstract parseOutput(response: LLMResponse): TOutput;
  abstract executeToolCall(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: AgentContext,
  ): Promise<unknown>;

  async run(input: TInput, context: AgentContext): Promise<TOutput | GateEvent> {
    const config = context.agentConfig;
    const preamble = this.buildLockedPreamble();
    const skillsContent = config.skills.map((s) => s.content).join('\n\n');
    const rulesContent = config.rules
      .map((r) => `RULE [${r.enforcement.toUpperCase()}]: ${r.constraint}`)
      .join('\n');

    const systemPrompt = [preamble, config.systemPromptBody, skillsContent, rulesContent]
      .filter(Boolean)
      .join('\n\n---\n\n');

    const initialMessage = this.buildInitialMessage(input);
    const tools = this.buildToolSet(context);

    return this.runAgentLoop({ llm: this.getLLM(), systemPrompt, initialMessage, tools, context });
  }

  protected abstract getLLM(): LLMConnector;

  protected async runAgentLoop(params: AgentLoopParams): Promise<TOutput | GateEvent> {
    const messages: Message[] = [
      { role: 'user', content: params.initialMessage },
    ];

    for (let iteration = 0; iteration < 50; iteration++) {
      const response = await params.llm.complete({
        messages,
        system: params.systemPrompt,
        tools: params.tools,
        model: params.context.agentConfig.model,
        maxTokens: params.context.agentConfig.maxTokens ?? 4096,
      });

      await this.auditLog({
        runId: params.context.runId,
        harnessId: params.context.harnessId,
        phase: params.context.phase,
        eventType: 'llm_call',
        actor: {
          agentId: params.context.agentConfig.agentId,
          model: params.context.agentConfig.model,
        },
        payload: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          stopReason: response.stopReason,
        },
      });

      messages.push({ role: 'assistant', content: response.text });

      if (response.stopReason === 'end_turn') {
        return this.parseOutput(response);
      }

      if (response.stopReason === 'tool_use') {
        for (const toolUse of response.toolUses) {
          if (toolUse.name === 'fire_gate') {
            // fire_gate RETURNS a GateEvent — does NOT throw
            return new GateEvent({
              phase: params.context.phase,
              runId: params.context.runId,
              harnessId: params.context.harnessId,
              gapDescription: toolUse.input['gapDescription'] as string,
              question: toolUse.input['question'] as string,
              source: params.context.source,
              agentId: params.context.agentConfig.agentId,
              pipelinePosition: params.context.pipelinePosition,
              temporalWorkflowId: params.context.temporalWorkflowId,
            });
          }

          const result = await this.executeToolCall(
            toolUse.name,
            toolUse.input,
            params.context,
          );

          await this.auditLog({
            runId: params.context.runId,
            harnessId: params.context.harnessId,
            phase: params.context.phase,
            eventType: 'tool_call',
            actor: { agentId: params.context.agentConfig.agentId },
            payload: { toolName: toolUse.name, input: toolUse.input, result: result as Record<string, unknown> },
          });

          messages.push({
            role: 'user',
            content: [{ type: 'tool_result', toolUseId: toolUse.id, content: JSON.stringify(result) }],
          });
        }
      }
    }

    // Max iterations reached — return whatever we have
    throw new Error('Agent loop exceeded maximum iterations (50)');
  }
}
