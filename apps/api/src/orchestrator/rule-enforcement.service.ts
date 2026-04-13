import { Injectable, Logger } from '@nestjs/common';
import { LLMRegistryService } from '../llm/llm-registry.service';
import type { RuleRef, RuleCheckResult } from '@finch/types';
import { finchRuleViolationsTotal } from '../telemetry';

@Injectable()
export class RuleEnforcementService {
  private readonly logger = new Logger(RuleEnforcementService.name);

  constructor(private readonly llmRegistry: LLMRegistryService) {}

  async checkHardRules(
    rules: RuleRef[],
    currentArtifact: unknown,
  ): Promise<RuleCheckResult> {
    const hardRules = rules.filter((r) => r.enforcement === 'hard');
    for (const rule of hardRules) {
      const violated = await this.evaluateRule(rule, currentArtifact);
      if (violated) {
        finchRuleViolationsTotal.add(1, {
          rule_type: rule.patternType,
          enforcement: 'hard',
          harness_id: 'unknown',
        });
        return {
          violated: true,
          rule,
          gateQuestion: `Hard rule violated: ${rule.constraint}. Please clarify how to proceed.`,
        };
      }
    }
    return { violated: false };
  }

  async checkSoftRules(
    rules: RuleRef[],
    currentArtifact: unknown,
  ): Promise<{ deviations: Array<{ rule: RuleRef; reason: string }> }> {
    const softRules = rules.filter((r) => r.enforcement === 'soft');
    const deviations: Array<{ rule: RuleRef; reason: string }> = [];

    for (const rule of softRules) {
      const violated = await this.evaluateRule(rule, currentArtifact);
      if (violated) {
        finchRuleViolationsTotal.add(1, {
          rule_type: rule.patternType,
          enforcement: 'soft',
          harness_id: 'unknown',
        });
        deviations.push({ rule, reason: `Soft rule deviation: ${rule.constraint}` });
      }
    }
    return { deviations };
  }

  private async evaluateRule(rule: RuleRef, currentArtifact: unknown): Promise<boolean> {
    const artifactStr = typeof currentArtifact === 'string'
      ? currentArtifact
      : JSON.stringify(currentArtifact ?? '');

    if (rule.patternType === 'path') {
      return rule.patterns.some((pattern) => artifactStr.includes(pattern));
    }

    if (rule.patternType === 'regex') {
      return rule.patterns.some((pattern) => {
        try {
          return new RegExp(pattern).test(artifactStr);
        } catch {
          this.logger.warn(`Invalid regex pattern: ${pattern}`);
          return false;
        }
      });
    }

    if (rule.patternType === 'semantic') {
      return this.evaluateSemanticRule(rule, artifactStr);
    }

    return false;
  }

  private async evaluateSemanticRule(rule: RuleRef, artifactStr: string): Promise<boolean> {
    try {
      const llm = this.llmRegistry.get('anthropic');
      const response = await llm.complete({
        model: 'claude-haiku-4-5',
        maxTokens: 50,
        system: 'You evaluate whether a rule constraint is violated by the given artifact. Respond with only "YES" or "NO".',
        messages: [
          {
            role: 'user',
            content: `Rule: ${rule.constraint}\n\nArtifact:\n${artifactStr}\n\nIs this rule violated? Answer YES or NO only.`,
          },
        ],
      });
      return response.text.trim().toUpperCase().startsWith('YES');
    } catch (error) {
      this.logger.error(`Semantic rule evaluation failed: ${(error as Error).message}`);
      return false;
    }
  }
}
