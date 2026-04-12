import { describe, it, expect, vi } from 'vitest';
import { ConnectorSettingsService } from '../../src/connector-settings/connector-settings.service';

function makeMocks() {
  const mockPrisma = {
    mcpServer: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  const mockEncryption = {
    encrypt: vi.fn().mockReturnValue('encrypted-config'),
    decrypt: vi.fn().mockReturnValue('{}'),
  };

  const mockRegistry = {
    registerServer: vi.fn(),
    unregisterServer: vi.fn(),
  };

  const mockFactory = {
    createFromRow: vi.fn().mockReturnValue(null),
  };

  return { mockPrisma, mockEncryption, mockRegistry, mockFactory };
}

function makeService(mocks: ReturnType<typeof makeMocks>) {
  return new ConnectorSettingsService(
    mocks.mockPrisma as never,
    mocks.mockEncryption as never,
    mocks.mockRegistry as never,
    mocks.mockFactory as never,
  );
}

describe('ConnectorSettingsService', () => {
  it('listForHarness returns mapped rows', async () => {
    const mocks = makeMocks();
    const now = new Date();
    mocks.mockPrisma.mcpServer.findMany.mockResolvedValue([
      {
        mcpServerId: 's1',
        harnessId: 'h1',
        serverType: 'jira',
        displayName: 'My Jira',
        configEncrypted: 'enc',
        isActive: true,
        healthStatus: 'healthy',
        lastHealthCheck: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const service = makeService(mocks);
    const result = await service.listForHarness('h1');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      mcpServerId: 's1',
      harnessId: 'h1',
      serverType: 'jira',
      displayName: 'My Jira',
      isActive: true,
      healthStatus: 'healthy',
      lastHealthCheck: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(mocks.mockPrisma.mcpServer.findMany).toHaveBeenCalledWith({
      where: { harnessId: 'h1', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('listForHarness returns empty array when no servers', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);
    const result = await service.listForHarness('h1');
    expect(result).toEqual([]);
  });

  it('create encrypts config, creates DB row, and registers server', async () => {
    const mocks = makeMocks();
    const now = new Date();
    const mockRow = {
      mcpServerId: 's1',
      harnessId: 'h1',
      serverType: 'jira',
      displayName: 'My Jira',
      configEncrypted: 'encrypted-config',
      isActive: true,
      healthStatus: 'unknown',
      createdAt: now,
      updatedAt: now,
    };
    mocks.mockPrisma.mcpServer.create.mockResolvedValue(mockRow);
    const mockServer = { serverId: 'jira', displayName: 'Jira Cloud' };
    mocks.mockFactory.createFromRow.mockReturnValue(mockServer);

    const service = makeService(mocks);
    const result = await service.create({
      harnessId: 'h1',
      serverType: 'jira',
      displayName: 'My Jira',
      config: { apiToken: 'tok' },
    });

    expect(mocks.mockEncryption.encrypt).toHaveBeenCalledWith('{"apiToken":"tok"}');
    expect(mocks.mockPrisma.mcpServer.create).toHaveBeenCalledWith({
      data: {
        harnessId: 'h1',
        serverType: 'jira',
        displayName: 'My Jira',
        configEncrypted: 'encrypted-config',
      },
    });
    expect(mocks.mockFactory.createFromRow).toHaveBeenCalled();
    expect(mocks.mockRegistry.registerServer).toHaveBeenCalledWith('h1', mockServer);
    expect(result.mcpServerId).toBe('s1');
  });

  it('create does not register if factory returns null', async () => {
    const mocks = makeMocks();
    const mockRow = {
      mcpServerId: 's1',
      harnessId: 'h1',
      serverType: 'unknown-type',
      displayName: 'Unknown',
      configEncrypted: 'enc',
      isActive: true,
      healthStatus: 'unknown',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.mockPrisma.mcpServer.create.mockResolvedValue(mockRow);
    mocks.mockFactory.createFromRow.mockReturnValue(null);

    const service = makeService(mocks);
    await service.create({
      harnessId: 'h1',
      serverType: 'unknown-type',
      displayName: 'Unknown',
      config: {},
    });

    expect(mocks.mockRegistry.registerServer).not.toHaveBeenCalled();
  });

  it('testConnection returns health check result and updates DB', async () => {
    const mocks = makeMocks();
    const mockRow = {
      mcpServerId: 's1',
      harnessId: 'h1',
      serverType: 'jira',
      displayName: 'My Jira',
      configEncrypted: 'enc',
      isActive: true,
      healthStatus: 'unknown',
    };
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue(mockRow);
    const mockServer = {
      healthCheck: vi.fn().mockResolvedValue({ ok: true }),
    };
    mocks.mockFactory.createFromRow.mockReturnValue(mockServer);
    mocks.mockPrisma.mcpServer.update.mockResolvedValue({});

    const service = makeService(mocks);
    const result = await service.testConnection('s1');

    expect(result).toEqual({ ok: true });
    expect(mocks.mockPrisma.mcpServer.update).toHaveBeenCalledWith({
      where: { mcpServerId: 's1' },
      data: { healthStatus: 'healthy', lastHealthCheck: expect.any(Date) },
    });
  });

  it('testConnection updates status to unhealthy on failure', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
      mcpServerId: 's1', harnessId: 'h1', serverType: 'jira',
      displayName: 'J', configEncrypted: 'e', isActive: true, healthStatus: 'unknown',
    });
    const mockServer = {
      healthCheck: vi.fn().mockResolvedValue({ ok: false, error: 'bad creds' }),
    };
    mocks.mockFactory.createFromRow.mockReturnValue(mockServer);
    mocks.mockPrisma.mcpServer.update.mockResolvedValue({});

    const service = makeService(mocks);
    const result = await service.testConnection('s1');

    expect(result).toEqual({ ok: false, error: 'bad creds' });
    expect(mocks.mockPrisma.mcpServer.update).toHaveBeenCalledWith({
      where: { mcpServerId: 's1' },
      data: { healthStatus: 'unhealthy', lastHealthCheck: expect.any(Date) },
    });
  });

  it('testConnection throws when server not found', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue(null);
    const service = makeService(mocks);
    await expect(service.testConnection('nonexistent')).rejects.toThrow('MCP server not found');
  });

  it('testConnection returns error when factory returns null', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
      mcpServerId: 's1', harnessId: 'h1', serverType: 'bad',
      displayName: 'B', configEncrypted: 'e', isActive: true, healthStatus: 'unknown',
    });
    mocks.mockFactory.createFromRow.mockReturnValue(null);

    const service = makeService(mocks);
    const result = await service.testConnection('s1');
    expect(result).toEqual({ ok: false, error: 'Unsupported server type: bad' });
  });

  it('remove soft-deletes and unregisters', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
      mcpServerId: 's1', harnessId: 'h1', serverType: 'jira',
      displayName: 'J', configEncrypted: 'e', isActive: true,
    });
    mocks.mockPrisma.mcpServer.update.mockResolvedValue({});

    const service = makeService(mocks);
    const result = await service.remove('s1');

    expect(result).toEqual({ success: true });
    expect(mocks.mockPrisma.mcpServer.update).toHaveBeenCalledWith({
      where: { mcpServerId: 's1' },
      data: { isActive: false },
    });
    expect(mocks.mockRegistry.unregisterServer).toHaveBeenCalledWith('h1', 'jira');
  });

  it('remove throws when server not found', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue(null);
    const service = makeService(mocks);
    await expect(service.remove('nonexistent')).rejects.toThrow('MCP server not found');
  });

  it('listTools returns tools from factory-created server', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
      mcpServerId: 's1', harnessId: 'h1', serverType: 'jira',
      displayName: 'J', configEncrypted: 'e', isActive: true, healthStatus: 'ok',
    });
    const mockServer = {
      listTools: vi.fn().mockReturnValue([
        { name: 'jira.getIssue', description: 'Get issue', inputSchema: {}, permission: 'read' },
      ]),
    };
    mocks.mockFactory.createFromRow.mockReturnValue(mockServer);

    const service = makeService(mocks);
    const tools = await service.listTools('s1');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('jira.getIssue');
  });

  it('listTools returns empty when server not found in DB', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue(null);
    const service = makeService(mocks);
    await expect(service.listTools('nonexistent')).rejects.toThrow('MCP server not found');
  });

  it('listTools returns empty when factory returns null', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
      mcpServerId: 's1', harnessId: 'h1', serverType: 'bad',
      displayName: 'B', configEncrypted: 'e', isActive: true, healthStatus: 'ok',
    });
    mocks.mockFactory.createFromRow.mockReturnValue(null);

    const service = makeService(mocks);
    const tools = await service.listTools('s1');
    expect(tools).toEqual([]);
  });
});
