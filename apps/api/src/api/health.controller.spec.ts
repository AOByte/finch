import { describe, it, expect, beforeEach } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('should return status ok', () => {
    const result = controller.health();
    expect(result.status).toBe('ok');
  });

  it('should return service name finch-api', () => {
    const result = controller.health();
    expect(result.service).toBe('finch-api');
  });

  it('should return a valid ISO 8601 timestamp', () => {
    const before = new Date().toISOString();
    const result = controller.health();
    const after = new Date().toISOString();

    expect(result.timestamp).toBeDefined();
    // Timestamp should be between before and after
    expect(result.timestamp >= before).toBe(true);
    expect(result.timestamp <= after).toBe(true);
  });

  it('should return exactly three keys', () => {
    const result = controller.health();
    expect(Object.keys(result)).toHaveLength(3);
    expect(Object.keys(result).sort()).toEqual(['service', 'status', 'timestamp']);
  });
});
