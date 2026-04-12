import { describe, it, expect, vi } from 'vitest';
import { ConnectorSettingsController } from '../../src/connector-settings/connector-settings.controller';

function makeMockService() {
  return {
    listForHarness: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ mcpServerId: 's1' }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ success: true }),
    listTools: vi.fn().mockResolvedValue([]),
  };
}

describe('ConnectorSettingsController', () => {
  it('list returns data wrapper', async () => {
    const service = makeMockService();
    service.listForHarness.mockResolvedValue([{ mcpServerId: 's1', serverType: 'jira' }]);
    const controller = new ConnectorSettingsController(service as never);

    const result = await controller.list('h1');
    expect(result).toEqual({ data: [{ mcpServerId: 's1', serverType: 'jira' }] });
    expect(service.listForHarness).toHaveBeenCalledWith('h1');
  });

  it('create passes body fields and harnessId', async () => {
    const service = makeMockService();
    service.create.mockResolvedValue({ mcpServerId: 's1', serverType: 'jira' });
    const controller = new ConnectorSettingsController(service as never);

    const result = await controller.create('h1', {
      serverType: 'jira',
      displayName: 'My Jira',
      config: { apiToken: 'tok' },
    });

    expect(result).toEqual({ data: { mcpServerId: 's1', serverType: 'jira' } });
    expect(service.create).toHaveBeenCalledWith({
      harnessId: 'h1',
      serverType: 'jira',
      displayName: 'My Jira',
      config: { apiToken: 'tok' },
    });
  });

  it('testConnection passes mcpServerId', async () => {
    const service = makeMockService();
    const controller = new ConnectorSettingsController(service as never);

    const result = await controller.testConnection('s1');
    expect(result).toEqual({ data: { ok: true } });
    expect(service.testConnection).toHaveBeenCalledWith('s1');
  });

  it('remove passes mcpServerId', async () => {
    const service = makeMockService();
    const controller = new ConnectorSettingsController(service as never);

    const result = await controller.remove('s1');
    expect(result).toEqual({ data: { success: true } });
    expect(service.remove).toHaveBeenCalledWith('s1');
  });

  it('listTools passes mcpServerId', async () => {
    const service = makeMockService();
    service.listTools.mockResolvedValue([{ name: 'jira.getIssue', permission: 'read' }]);
    const controller = new ConnectorSettingsController(service as never);

    const result = await controller.listTools('s1');
    expect(result).toEqual({ data: [{ name: 'jira.getIssue', permission: 'read' }] });
    expect(service.listTools).toHaveBeenCalledWith('s1');
  });
});
