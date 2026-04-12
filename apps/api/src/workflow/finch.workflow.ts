import {
  proxyActivities,
  condition,
  setHandler,
  defineSignal,
} from '@temporalio/workflow';
import type {
  FinchActivities,
  RawTriggerInput,
  RunResult,
  GateResolution,
} from './types';

export const gateResolvedSignal =
  defineSignal<[GateResolution]>('gate_resolved');
export const stopRunSignal = defineSignal('stop_run');

export async function finchWorkflow(
  rawInput: RawTriggerInput,
): Promise<RunResult> {
  const acts = proxyActivities<FinchActivities>({
    startToCloseTimeout: '15 minutes',
    retry: {
      maximumAttempts: 3,
      nonRetryableErrorTypes: ['GateRequiredError', 'ScopeViolationError'],
    },
  });

  let stopped = false;
  // Register signals BEFORE the first await
  setHandler(stopRunSignal, () => {
    stopped = true;
  });

  // -- TRIGGER --
  const taskDescriptor = await acts.runTriggerPhase(rawInput);

  if (stopped) return { status: 'STOPPED', phase: 'TRIGGER' };

  // -- ACQUIRE --
  let contextObject = await acts.runAcquirePhase(taskDescriptor);

  while (contextObject.hasGap) {
    if (stopped) return { status: 'STOPPED', phase: 'ACQUIRE' };

    const resolution = await waitForGateResolution(taskDescriptor.runId);
    if (stopped) return { status: 'STOPPED', phase: 'ACQUIRE' };

    if (resolution.requiresPhase === 'ACQUIRE') {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'ACQUIRE',
        toPhase: 'ACQUIRE',
      });
    }

    contextObject = await acts.resumeAcquirePhase(contextObject, resolution);
  }

  // -- PLAN --
  let planArtifact = await acts.runPlanPhase(contextObject);

  while (planArtifact.hasGap) {
    if (stopped) return { status: 'STOPPED', phase: 'PLAN' };

    const resolution = await waitForGateResolution(taskDescriptor.runId);
    if (stopped) return { status: 'STOPPED', phase: 'PLAN' };

    if (resolution.requiresPhase === 'ACQUIRE') {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'PLAN',
        toPhase: 'ACQUIRE',
      });
      contextObject = await acts.resumeAcquirePhase(contextObject, resolution);
      planArtifact = await acts.runPlanPhase(contextObject);
    } else {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'PLAN',
        toPhase: 'PLAN',
      });
      planArtifact = await acts.resumePlanPhase(planArtifact, resolution);
    }
  }

  // -- EXECUTE --
  let verificationReport = await acts.runExecutePhase(
    planArtifact,
    contextObject,
  );

  while (verificationReport.hasGap) {
    if (stopped) return { status: 'STOPPED', phase: 'EXECUTE' };

    const resolution = await waitForGateResolution(taskDescriptor.runId);
    if (stopped) return { status: 'STOPPED', phase: 'EXECUTE' };

    if (resolution.requiresPhase === 'ACQUIRE') {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'EXECUTE',
        toPhase: 'ACQUIRE',
      });
      contextObject = await acts.resumeAcquirePhase(contextObject, resolution);
      planArtifact = await acts.runPlanPhase(contextObject);
      verificationReport = await acts.runExecutePhase(
        planArtifact,
        contextObject,
      );
    } else if (resolution.requiresPhase === 'PLAN') {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'EXECUTE',
        toPhase: 'PLAN',
      });
      planArtifact = await acts.resumePlanPhase(planArtifact, resolution);
      verificationReport = await acts.runExecutePhase(
        planArtifact,
        contextObject,
      );
    } else {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'EXECUTE',
        toPhase: 'EXECUTE',
      });
      verificationReport = await acts.resumeExecutePhase(
        verificationReport,
        resolution,
      );
    }
  }

  // -- SHIP --
  const repos = await acts.getRegisteredRepos(contextObject.harnessId);

  if (repos.length === 1) {
    const shipResult = await acts.runShipPhase(
      planArtifact,
      verificationReport,
      contextObject,
      repos[0].repoId,
    );
    await acts.mergeRunMemory(planArtifact.runId);
    await acts.aggregateShipResults(planArtifact.runId, [
      { repoId: repos[0].repoId, status: 'success', result: shipResult },
    ]);
  } else {
    const shipPromises = repos.map((repo) =>
      acts
        .runShipPhase(
          planArtifact,
          verificationReport,
          contextObject,
          repo.repoId,
        )
        .then(
          (result) =>
            ({
              repoId: repo.repoId,
              status: 'success' as const,
              result,
            }),
        )
        .catch(
          (err: Error) =>
            ({
              repoId: repo.repoId,
              status: 'failed' as const,
              error: err.message,
            }),
        ),
    );

    const shipResults = await Promise.all(shipPromises);
    await acts.mergeRunMemory(planArtifact.runId);
    await acts.aggregateShipResults(planArtifact.runId, shipResults);
  }

  return { status: 'COMPLETED' };
}

async function waitForGateResolution(
  runId: string,
): Promise<GateResolution> {
  let resolution: GateResolution | null = null;
  setHandler(gateResolvedSignal, (r: GateResolution) => {
    resolution = r;
  });
  await condition(() => resolution !== null, '48 hours');
  if (!resolution) throw new Error(`Gate timeout for run ${runId}`);
  return resolution;
}
