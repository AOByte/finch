import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';
import { CredentialEncryptionService } from '../connectors/credential-encryption.service';
import { MCPRegistryService } from '../mcp/mcp-registry.service';
import { MCPServerFactory } from '../mcp/mcp-server.factory';
import { ExternalMCPAdapter } from '../mcp/external-mcp-adapter';
import { ProcessManager } from '../mcp/transports/process-manager';
import { StdioTransport } from '../mcp/transports/stdio-transport';

export interface CreateMCPServerInput {
  harnessId: string;
  serverType: string;
  displayName: string;
  config: Record<string, unknown>;
}

@Injectable()
export class ConnectorSettingsService implements OnModuleInit {
  private readonly logger = new Logger(ConnectorSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
    private readonly mcpRegistry: MCPRegistryService,
    private readonly mcpFactory: MCPServerFactory,
    private readonly processManager: ProcessManager,
  ) {}

  /**
   * Boot-time loading: iterate all active mcp_servers rows and register each.
   * Connection failures are logged but don't crash the app.
   */
  async onModuleInit(): Promise<void> {
    const rows = await this.prisma.mcpServer.findMany({
      where: { isActive: true },
    });

    this.logger.log(`Boot-time loading: found ${rows.length} active MCP server(s)`);

    for (const row of rows) {
      try {
        await this.loadAndRegisterServer(row.mcpServerId);
      } catch (err) {
        this.logger.warn(
          `Failed to load MCP server ${row.mcpServerId} (${row.serverType}) at boot: ${(err as Error).message}`,
        );
        // Don't crash — mark as connection_failed
        await this.prisma.mcpServer.update({
          where: { mcpServerId: row.mcpServerId },
          data: { healthStatus: 'connection_failed' },
        }).catch(() => { /* best-effort */ });
      }
    }
  }

  /**
   * Load an MCP server row from DB, create adapter via MCPServerFactory,
   * connect it, and register in MCPRegistryService.
   * Called from OAuthCallbackController after OAuth flow and at boot time.
   */
  async loadAndRegisterServer(mcpServerId: string): Promise<void> {
    const row = await this.prisma.mcpServer.findUnique({
      where: { mcpServerId },
    });

    if (!row) {
      throw new Error(`MCP server not found: ${mcpServerId}`);
    }

    const server = this.mcpFactory.createFromRow({
      mcpServerId: row.mcpServerId,
      harnessId: row.harnessId,
      serverType: row.serverType,
      displayName: row.displayName,
      configEncrypted: row.configEncrypted,
      isActive: row.isActive,
      healthStatus: row.healthStatus,
      transport: row.transport,
      command: row.command,
      commandArgs: row.commandArgs,
      endpointUrl: row.endpointUrl,
      envEncrypted: row.envEncrypted,
      permissionOverrides: row.permissionOverrides as Record<string, string> | null,
      oauthProviderId: row.oauthProviderId,
      accessTokenEncrypted: row.accessTokenEncrypted,
      refreshTokenEncrypted: row.refreshTokenEncrypted,
      tokenExpiresAt: row.tokenExpiresAt,
    });

    if (!server) {
      this.logger.warn(`Could not create MCP server for ${mcpServerId} (${row.serverType})`);
      return;
    }

    // Connect external adapters (internal servers are already ready)
    if (server instanceof ExternalMCPAdapter) {
      await server.connect();

      // Register stdio processes with ProcessManager for crash recovery
      const transport = server.getTransport();
      if (transport instanceof StdioTransport) {
        this.processManager.register(mcpServerId, transport);
      }
    }

    this.mcpRegistry.registerServer(row.harnessId, server);

    // Update health status
    await this.prisma.mcpServer.update({
      where: { mcpServerId },
      data: { healthStatus: 'healthy', lastHealthCheck: new Date() },
    });

    this.logger.log(`Loaded and registered MCP server ${mcpServerId} (${row.serverType}) for harness ${row.harnessId}`);
  }

  async listForHarness(harnessId: string) {
    const rows = await this.prisma.mcpServer.findMany({
      where: { harnessId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map(r => ({
      mcpServerId: r.mcpServerId,
      harnessId: r.harnessId,
      serverType: r.serverType,
      displayName: r.displayName,
      isActive: r.isActive,
      healthStatus: r.healthStatus,
      lastHealthCheck: r.lastHealthCheck,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async create(input: CreateMCPServerInput) {
    const configEncrypted = this.encryption.encrypt(JSON.stringify(input.config));

    const row = await this.prisma.mcpServer.create({
      data: {
        harnessId: input.harnessId,
        serverType: input.serverType,
        displayName: input.displayName,
        configEncrypted,
      },
    });

    // Register the MCP server in the in-memory registry
    const server = this.mcpFactory.createFromRow({
      mcpServerId: row.mcpServerId,
      harnessId: row.harnessId,
      serverType: row.serverType,
      displayName: row.displayName,
      configEncrypted: row.configEncrypted,
      isActive: row.isActive,
      healthStatus: row.healthStatus,
    });

    if (server) {
      this.mcpRegistry.registerServer(input.harnessId, server);
    }

    this.logger.log(`Created MCP server ${row.mcpServerId} (${row.serverType}) for harness ${row.harnessId}`);

    return {
      mcpServerId: row.mcpServerId,
      harnessId: row.harnessId,
      serverType: row.serverType,
      displayName: row.displayName,
      isActive: row.isActive,
      healthStatus: row.healthStatus,
      createdAt: row.createdAt,
    };
  }

  async testConnection(mcpServerId: string) {
    const row = await this.prisma.mcpServer.findUnique({
      where: { mcpServerId },
    });

    if (!row) {
      throw new Error(`MCP server not found: ${mcpServerId}`);
    }

    const server = this.mcpFactory.createFromRow({
      mcpServerId: row.mcpServerId,
      harnessId: row.harnessId,
      serverType: row.serverType,
      displayName: row.displayName,
      configEncrypted: row.configEncrypted,
      isActive: row.isActive,
      healthStatus: row.healthStatus,
    });

    if (!server) {
      return { ok: false, error: `Unsupported server type: ${row.serverType}` };
    }

    const result = await server.healthCheck();

    // Update health status in DB
    await this.prisma.mcpServer.update({
      where: { mcpServerId },
      data: {
        healthStatus: result.ok ? 'healthy' : 'unhealthy',
        lastHealthCheck: new Date(),
      },
    });

    return result;
  }

  async remove(mcpServerId: string) {
    const row = await this.prisma.mcpServer.findUnique({
      where: { mcpServerId },
    });

    if (!row) {
      throw new Error(`MCP server not found: ${mcpServerId}`);
    }

    await this.prisma.mcpServer.update({
      where: { mcpServerId },
      data: { isActive: false },
    });

    this.mcpRegistry.unregisterServer(row.harnessId, row.serverType);
    this.logger.log(`Removed MCP server ${mcpServerId} (${row.serverType}) from harness ${row.harnessId}`);

    return { success: true };
  }

  async listTools(mcpServerId: string) {
    const row = await this.prisma.mcpServer.findUnique({
      where: { mcpServerId },
    });

    if (!row) {
      throw new Error(`MCP server not found: ${mcpServerId}`);
    }

    const server = this.mcpFactory.createFromRow({
      mcpServerId: row.mcpServerId,
      harnessId: row.harnessId,
      serverType: row.serverType,
      displayName: row.displayName,
      configEncrypted: row.configEncrypted,
      isActive: row.isActive,
      healthStatus: row.healthStatus,
    });

    if (!server) {
      return [];
    }

    return server.listTools();
  }
}
