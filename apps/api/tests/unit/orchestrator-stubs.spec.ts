import { describe, it, expect } from 'vitest';
import { GateControllerService } from '../../src/orchestrator/gate-controller.service';
import { AgentDispatcherService } from '../../src/orchestrator/agent-dispatcher.service';
import { RuleEnforcementService } from '../../src/orchestrator/rule-enforcement.service';

describe('OrchestratorModule stub providers', () => {
  it('GateControllerService can be instantiated', () => {
    const svc = new GateControllerService();
    expect(svc).toBeDefined();
  });

  it('AgentDispatcherService can be instantiated', () => {
    const svc = new AgentDispatcherService();
    expect(svc).toBeDefined();
  });

  it('RuleEnforcementService can be instantiated', () => {
    const svc = new RuleEnforcementService();
    expect(svc).toBeDefined();
  });
});
