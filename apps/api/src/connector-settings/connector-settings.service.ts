import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';
import { CredentialEncryptionService } from '../connectors/credential-encryption.service';
import { MCPRegistryService } from '../mcp/mcp-registry.service';
import { MCPServerFactory } from '../mcp/mcp-server.factory';

export interface CreateMCPServerInput {
  harnessId: string;
  serverType: string;
  displayName: string;
  config: Record<string, unknown>;
}

@Injectable()
export class ConnectorSettingsService {
  private readonly logger = new Logger(ConnectorSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
    private readonly mcpRegistry: MCPRegistryService,
    private readonly mcpFactory: MCPServerFactory,
  ) {}

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
