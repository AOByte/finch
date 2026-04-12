import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleEnforcementService } from '../../src/orchestrator/rule-enforcement.service';

describe('RuleEnforcementService', () => {
  const mockLLM = { complete: vi.fn() };
  const mockRegistry = {
    get: vi.fn().mockReturnValue(mockLLM),
  };
  let service: RuleEnforcementService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RuleEnforcementService(mockRegistry as never);
  });

  describe('checkHardRules', () => {
    it('returns violated=false with no hard rules', async () => {
      const result = await service.checkHardRules([], 'artifact');
      expect(result.violated).toBe(false);
    });

    it('returns violated=false for soft rules only', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'soft', constraint: 'test', enforcement: 'soft', patternType: 'path', patterns: ['bad'] }],
        'artifact',
      );
      expect(result.violated).toBe(false);
    });

    it('returns violated=true when path pattern matches', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'no bad words', enforcement: 'hard', patternType: 'path', patterns: ['bad'] }],
        'this is bad content',
      );
      expect(result.violated).toBe(true);
      expect(result.rule?.constraint).toBe('no bad words');
      expect(result.gateQuestion).toContain('no bad words');
    });

    it('returns violated=false when path pattern does not match', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'no bad', enforcement: 'hard', patternType: 'path', patterns: ['bad'] }],
        'clean content',
      );
      expect(result.violated).toBe(false);
    });

    it('returns violated=true when regex pattern matches', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'no numbers', enforcement: 'hard', patternType: 'regex', patterns: ['\\d+'] }],
        'has 123 numbers',
      );
      expect(result.violated).toBe(true);
    });

    it('returns violated=false when regex pattern does not match', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'no numbers', enforcement: 'hard', patternType: 'regex', patterns: ['\\d+'] }],
        'no numbers here',
      );
      expect(result.violated).toBe(false);
    });

    it('handles invalid regex gracefully', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'test', enforcement: 'hard', patternType: 'regex', patterns: ['[invalid'] }],
        'content',
      );
      expect(result.violated).toBe(false);
    });

    it('handles semantic rules via LLM', async () => {
      mockLLM.complete.mockResolvedValue({ text: 'YES' });
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'must be polite', enforcement: 'hard', patternType: 'semantic', patterns: [] }],
        'rude content',
      );
      expect(result.violated).toBe(true);
    });

    it('handles semantic rule returning NO', async () => {
      mockLLM.complete.mockResolvedValue({ text: 'NO' });
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'must be polite', enforcement: 'hard', patternType: 'semantic', patterns: [] }],
        'polite content',
      );
      expect(result.violated).toBe(false);
    });

    it('handles semantic rule LLM failure gracefully', async () => {
      mockLLM.complete.mockRejectedValue(new Error('LLM error'));
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'test', enforcement: 'hard', patternType: 'semantic', patterns: [] }],
        'content',
      );
      expect(result.violated).toBe(false);
    });

    it('returns violated=false for unknown patternType', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'test', enforcement: 'hard', patternType: 'unknown' as never, patterns: [] }],
        'content',
      );
      expect(result.violated).toBe(false);
    });

    it('handles non-string artifact', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'no bad', enforcement: 'hard', patternType: 'path', patterns: ['bad'] }],
        { key: 'bad value' },
      );
      expect(result.violated).toBe(true);
    });

    it('handles null artifact', async () => {
      const result = await service.checkHardRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'no bad', enforcement: 'hard', patternType: 'path', patterns: ['xyz'] }],
        null,
      );
      expect(result.violated).toBe(false);
    });
  });

  describe('checkSoftRules', () => {
    it('returns empty deviations with no soft rules', async () => {
      const result = await service.checkSoftRules([], 'artifact');
      expect(result.deviations).toHaveLength(0);
    });

    it('returns deviations for violated soft rules', async () => {
      const result = await service.checkSoftRules(
        [{ ruleId: 'r1', name: 'soft', constraint: 'be nice', enforcement: 'soft', patternType: 'path', patterns: ['rude'] }],
        'rude content',
      );
      expect(result.deviations).toHaveLength(1);
      expect(result.deviations[0].rule.constraint).toBe('be nice');
    });

    it('returns no deviations for non-violated soft rules', async () => {
      const result = await service.checkSoftRules(
        [{ ruleId: 'r1', name: 'soft', constraint: 'be nice', enforcement: 'soft', patternType: 'path', patterns: ['rude'] }],
        'nice content',
      );
      expect(result.deviations).toHaveLength(0);
    });

    it('ignores hard rules', async () => {
      const result = await service.checkSoftRules(
        [{ ruleId: 'r1', name: 'hard', constraint: 'no bad', enforcement: 'hard', patternType: 'path', patterns: ['bad'] }],
        'bad content',
      );
      expect(result.deviations).toHaveLength(0);
    });
  });
});
