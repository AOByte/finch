import { describe, it, expect, vi } from 'vitest';
import { ConnectorRegistryService } from '../../src/connectors/connector-registry.service';

describe('ConnectorRegistryService', () => {
  it('register and getTriggerConnector', () => {
    const service = new ConnectorRegistryService();
    const connector = { sendMessage: vi.fn() };
    service.register('webhook', 'trigger', connector as never);

    const result = service.getTriggerConnector('webhook');
    expect(result).toBe(connector);
  });

  it('getTriggerConnector returns undefined for non-trigger category', () => {
    const service = new ConnectorRegistryService();
    const connector = { sendMessage: vi.fn() };
    service.register('slack-acquire', 'acquire', connector as never);

    const result = service.getTriggerConnector('slack-acquire');
    expect(result).toBeUndefined();
  });

  it('getTriggerConnector returns undefined for unknown id', () => {
    const service = new ConnectorRegistryService();
    expect(service.getTriggerConnector('nonexistent')).toBeUndefined();
  });

  it('getDefaultTriggerConnector returns first trigger connector', () => {
    const service = new ConnectorRegistryService();
    const connector1 = { sendMessage: vi.fn() };
    const connector2 = { sendMessage: vi.fn() };
    service.register('webhook', 'trigger', connector1 as never);
    service.register('slack', 'trigger', connector2 as never);

    expect(service.getDefaultTriggerConnector()).toBe(connector1);
  });

  it('getDefaultTriggerConnector returns undefined when no trigger connectors', () => {
    const service = new ConnectorRegistryService();
    const connector = { sendMessage: vi.fn() };
    service.register('acquire-conn', 'acquire', connector as never);

    expect(service.getDefaultTriggerConnector()).toBeUndefined();
  });

  it('getDefaultTriggerConnector returns undefined when empty', () => {
    const service = new ConnectorRegistryService();
    expect(service.getDefaultTriggerConnector()).toBeUndefined();
  });

  it('has returns true for registered connector', () => {
    const service = new ConnectorRegistryService();
    service.register('webhook', 'trigger', { sendMessage: vi.fn() } as never);
    expect(service.has('webhook')).toBe(true);
  });

  it('has returns false for unregistered connector', () => {
    const service = new ConnectorRegistryService();
    expect(service.has('nonexistent')).toBe(false);
  });

  it('listByCategory returns ids matching category', () => {
    const service = new ConnectorRegistryService();
    service.register('webhook', 'trigger', { sendMessage: vi.fn() } as never);
    service.register('slack', 'trigger', { sendMessage: vi.fn() } as never);
    service.register('github', 'acquire', { sendMessage: vi.fn() } as never);

    expect(service.listByCategory('trigger')).toEqual(['webhook', 'slack']);
    expect(service.listByCategory('acquire')).toEqual(['github']);
    expect(service.listByCategory('execute')).toEqual([]);
  });
});
