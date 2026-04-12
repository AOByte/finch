import { describe, it, expect, vi } from 'vitest';
import { ConnectorSettingsService } from '../../src/connector-settings/connector-settings.service';

function makeMocks() {
  const mockPrisma = {
    mcpServer: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
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

  const mockProcessManager = {
    register: vi.fn(),
    unregister: vi.fn(),
    stop: vi.fn(),
  };

  return { mockPrisma, mockEncryption, mockRegistry, mockFactory, mockProcessManager };
}

function makeService(mocks: ReturnType<typeof makeMocks>) {
  return new ConnectorSettingsService(
    mocks.mockPrisma as never,
    mocks.mockEncryption as never,
    mocks.mockRegistry as never,
    mocks.mockFactory as never,
    mocks.mockProcessManager as never,
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

  // --- loadAndRegisterServer tests ---

  it('loadAndRegisterServer loads row, creates server, and registers', async () => {
    const mocks = makeMocks();
    const row = {
      mcpServerId: 's1', harnessId: 'h1', serverType: 'jira', displayName: 'Jira',
      configEncrypted: 'enc', isActive: true, healthStatus: 'unknown',
      transport: null, command: null, commandArgs: [], endpointUrl: null,
      envEncrypted: null, permissionOverrides: null,
      oauthProviderId: null, accessTokenEncrypted: null,
      refreshTokenEncrypted: null, tokenExpiresAt: null,
    };
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue(row);
    const mockServer = { serverId: 'jira', displayName: 'Jira Cloud' };
    mocks.mockFactory.createFromRow.mockReturnValue(mockServer);

    const service = makeService(mocks);
    await service.loadAndRegisterServer('s1');

    expect(mocks.mockFactory.createFromRow).toHaveBeenCalled();
    expect(mocks.mockRegistry.registerServer).toHaveBeenCalledWith('h1', mockServer);
    expect(mocks.mockPrisma.mcpServer.update).toHaveBeenCalledWith({
      where: { mcpServerId: 's1' },
      data: { healthStatus: 'healthy', lastHealthCheck: expect.any(Date) },
    });
  });

  it('loadAndRegisterServer throws when server not found', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);
    await expect(service.loadAndRegisterServer('nonexistent')).rejects.toThrow('MCP server not found');
  });

  it('loadAndRegisterServer returns silently when factory returns null', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
      mcpServerId: 's1', harnessId: 'h1', serverType: 'unknown', displayName: 'U',
      configEncrypted: 'enc', isActive: true, healthStatus: 'unknown',
      transport: null, command: null, commandArgs: [], endpointUrl: null,
      envEncrypted: null, permissionOverrides: null,
      oauthProviderId: null, accessTokenEncrypted: null,
      refreshTokenEncrypted: null, tokenExpiresAt: null,
    });
    mocks.mockFactory.createFromRow.mockReturnValue(null);

    const service = makeService(mocks);
    await service.loadAndRegisterServer('s1');
    expect(mocks.mockRegistry.registerServer).not.toHaveBeenCalled();
  });

  // --- onModuleInit tests ---

  it('onModuleInit loads all active servers at boot', async () => {
    const mocks = makeMocks();
    const row = {
      mcpServerId: 's1', harnessId: 'h1', serverType: 'jira', displayName: 'Jira',
      configEncrypted: 'enc', isActive: true, healthStatus: 'unknown',
      transport: null, command: null, commandArgs: [], endpointUrl: null,
      envEncrypted: null, permissionOverrides: null,
      oauthProviderId: null, accessTokenEncrypted: null,
      refreshTokenEncrypted: null, tokenExpiresAt: null,
    };
    mocks.mockPrisma.mcpServer.findMany.mockResolvedValue([row]);
    // loadAndRegisterServer calls findUnique internally
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue(row);
    const mockServer = { serverId: 'jira', displayName: 'Jira Cloud' };
    mocks.mockFactory.createFromRow.mockReturnValue(mockServer);

    const service = makeService(mocks);
    await service.onModuleInit();

    expect(mocks.mockPrisma.mcpServer.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(mocks.mockRegistry.registerServer).toHaveBeenCalledWith('h1', mockServer);
  });

  it('onModuleInit handles connection failures without crashing', async () => {
    const mocks = makeMocks();
    const row = {
      mcpServerId: 's1', harnessId: 'h1', serverType: 'bad', displayName: 'Bad',
      configEncrypted: 'enc', isActive: true, healthStatus: 'unknown',
      transport: null, command: null, commandArgs: [], endpointUrl: null,
      envEncrypted: null, permissionOverrides: null,
      oauthProviderId: null, accessTokenEncrypted: null,
      refreshTokenEncrypted: null, tokenExpiresAt: null,
    };
    mocks.mockPrisma.mcpServer.findMany.mockResolvedValue([row]);
    // findUnique returns the row so loadAndRegisterServer can proceed
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue(row);
    // Factory returns null → loadAndRegisterServer returns without registering
    mocks.mockFactory.createFromRow.mockReturnValue(null);

    const service = makeService(mocks);
    await service.onModuleInit(); // should not throw
  });

  it('onModuleInit marks failed servers as connection_failed', async () => {
    const mocks = makeMocks();
    mocks.mockPrisma.mcpServer.findMany.mockResolvedValue([
      {
        mcpServerId: 's1', harnessId: 'h1', serverType: 'jira', displayName: 'Jira',
        configEncrypted: 'enc', isActive: true, healthStatus: 'unknown',
        transport: null, command: null, commandArgs: [], endpointUrl: null,
        envEncrypted: null, permissionOverrides: null,
        oauthProviderId: null, accessTokenEncrypted: null,
        refreshTokenEncrypted: null, tokenExpiresAt: null,
      },
    ]);
    // Simulate loadAndRegisterServer throwing by having findUnique return null
    mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue(null);

    const service = makeService(mocks);
    await service.onModuleInit(); // should not throw — error is caught
    expect(mocks.mockPrisma.mcpServer.update).toHaveBeenCalledWith({
      where: { mcpServerId: 's1' },
      data: { healthStatus: 'connection_failed' },
    });
  });
});
