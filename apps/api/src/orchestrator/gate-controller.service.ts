import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GateRepository } from '../persistence/gate.repository';
import { RunRepository } from '../persistence/run.repository';
import { AuditLoggerService } from '../audit/audit-logger.service';
import { LLMRegistryService } from '../llm/llm-registry.service';
import { GateEvent } from '../agents/gate-event';
import type { GateResolution } from '../workflow/types';
import type { Phase, TriggerConnector } from '@finch/types';
import { finchGateFiresTotal } from '../telemetry';

@Injectable()
export class GateControllerService {
  private readonly logger = new Logger(GateControllerService.name);
  private triggerConnector: TriggerConnector | null = null;

  constructor(
    private readonly gateRepository: GateRepository,
    readonly runRepository: RunRepository,
    private readonly auditLogger: AuditLoggerService,
    private readonly llmRegistry: LLMRegistryService,
    @InjectQueue('gate-timeout') private readonly gateTimeoutQueue: Queue,
  ) {}

  setTriggerConnector(connector: TriggerConnector): void {
    this.triggerConnector = connector;
  }

  async dispatch(gateEvent: GateEvent): Promise<void> {
    // W6-09: Record gate fire metric
    finchGateFiresTotal.add(1, {
      phase: gateEvent.phase,
      trigger_type: gateEvent.source?.type ?? 'unknown',
      harness_id: gateEvent.harnessId,
    });

    // gate_fired is CRITICAL — synchronous write BEFORE anything else
    await this.auditLogger.log({
      runId: gateEvent.runId,
      harnessId: gateEvent.harnessId,
      phase: gateEvent.phase,
      eventType: 'gate_fired',
      actor: { type: 'agent', agentId: gateEvent.agentId },
      payload: {
        gateId: gateEvent.gateId,
        question: gateEvent.question,
        gapDescription: gateEvent.gapDescription,
        pipelinePosition: gateEvent.pipelinePosition,
      },
    });

    // Persist GateEvent to database
    await this.gateRepository.create({
      gateId: gateEvent.gateId,
      runId: gateEvent.runId,
      harnessId: gateEvent.harnessId,
      phase: gateEvent.phase,
      agentId: gateEvent.agentId,
      pipelinePosition: gateEvent.pipelinePosition,
      gapDescription: gateEvent.gapDescription,
      question: gateEvent.question,
      temporalWorkflowId: gateEvent.temporalWorkflowId ?? '',
      timeoutMs: gateEvent.timeoutMs,
      source: JSON.parse(JSON.stringify(gateEvent.source)) as Prisma.InputJsonValue,
      snapshot: JSON.parse(JSON.stringify(gateEvent.snapshot ?? {})) as Prisma.InputJsonValue,
    });

    // Update run to WAITING_FOR_HUMAN
    await this.runRepository.updateStatus(gateEvent.runId, 'WAITING_FOR_HUMAN');

    // Post question via trigger connector
    if (this.triggerConnector) {
      await this.triggerConnector.sendMessage({
        channelId: gateEvent.source.channelId,
        threadTs: gateEvent.source.threadTs,
        message: gateEvent.question,
      });
    }

    // Audit gate_question_sent (also critical)
    await this.auditLogger.log({
      runId: gateEvent.runId,
      harnessId: gateEvent.harnessId,
      phase: gateEvent.phase,
      eventType: 'gate_question_sent',
      actor: { type: 'agent', agentId: gateEvent.agentId },
      payload: { gateId: gateEvent.gateId, question: gateEvent.question },
    });

    // Schedule 48h gate-timeout BullMQ job
    await this.gateTimeoutQueue.add(
      'gate-timeout',
      { gateId: gateEvent.gateId, runId: gateEvent.runId },
      { delay: gateEvent.timeoutMs, jobId: `gate-timeout-${gateEvent.gateId}` },
    );

    this.logger.log(`Gate dispatched: ${gateEvent.gateId} for run ${gateEvent.runId}`);
  }

  async resolve(gateId: string, answer: string): Promise<GateResolution> {
    const gate = await this.gateRepository.findById(gateId);
    if (!gate) {
      throw new NotFoundException(`Gate ${gateId} not found`);
    }

    const phase = gate.phase as Phase;

    // Gate A always returns to ACQUIRE without LLM call
    let requiresPhase: 'ACQUIRE' | 'PLAN' | 'EXECUTE';
    if (phase === 'ACQUIRE') {
      requiresPhase = 'ACQUIRE';
    } else {
      // Gate P/E: classify with claude-haiku-4-5, max 10 tokens
      requiresPhase = await this.classifyTraversal(phase, answer);
    }

    const resolution: GateResolution = {
      gateId,
      requiresPhase,
      answer,
    };

    // Persist resolution and cancel timeout
    await this.gateRepository.saveResolution(
      gateId,
      JSON.parse(JSON.stringify(resolution)) as Prisma.InputJsonValue,
    );

    // Cancel timeout job
    const timeoutJob = await this.gateTimeoutQueue.getJob(`gate-timeout-${gateId}`);
    if (timeoutJob) {
      await timeoutJob.remove();
    }

    // Update run back to RUNNING
    await this.runRepository.updateStatus(gate.runId, 'RUNNING');

    // Audit gate_resumed
    await this.auditLogger.log({
      runId: gate.runId,
      harnessId: gate.harnessId,
      phase,
      eventType: 'gate_resumed',
      payload: { gateId, requiresPhase, answer },
    });

    // If backward traversal, log it
    if (requiresPhase !== phase) {
      await this.auditLogger.log({
        runId: gate.runId,
        harnessId: gate.harnessId,
        phase,
        eventType: 'gate_traversal_backward',
        payload: { gateId, fromPhase: phase, toPhase: requiresPhase },
      });
    }

    this.logger.log(`Gate resolved: ${gateId} → ${requiresPhase}`);
    return resolution;
  }

  private async classifyTraversal(
    currentPhase: Phase,
    answer: string,
  ): Promise<'ACQUIRE' | 'PLAN' | 'EXECUTE'> {
    try {
      const llm = this.llmRegistry.get('anthropic');
      const validPhases = currentPhase === 'PLAN'
        ? ['ACQUIRE', 'PLAN']
        : ['ACQUIRE', 'PLAN', 'EXECUTE'];

      const response = await llm.complete({
        model: 'claude-haiku-4-5',
        maxTokens: 10,
        system: `Classify which phase to return to. Respond with ONLY one of: ${validPhases.join(', ')}`,
        messages: [
          {
            role: 'user',
            content: `Current phase: ${currentPhase}\nHuman answer: ${answer}\n\nWhich phase should we return to?`,
          },
        ],
      });

      const text = response.text.trim().toUpperCase();
      if (validPhases.includes(text)) {
        return text as 'ACQUIRE' | 'PLAN' | 'EXECUTE';
      }

      return currentPhase as 'ACQUIRE' | 'PLAN' | 'EXECUTE';
    } catch (error) {
      this.logger.error(`Traversal classification failed: ${(error as Error).message}`);
      return currentPhase as 'ACQUIRE' | 'PLAN' | 'EXECUTE';
    }
  }
}
