import { Logger } from '@nestjs/common';
import type { MCPServer, MCPTool, MCPToolPermission } from '@finch/types';
import type { MCPTransport } from './transports/mcp-transport.interface';

export interface ExternalMCPConfig {
  serverId: string;
  displayName: string;
}

/**
 * Adapter that bridges an external MCP server (stdio or SSE) to Finch's
 * in-process MCPServer interface. MCPRegistryService treats this identically
 * to internal servers like JiraMCPServer.
 *
 * Key design decisions:
 * - tokenRefresher callback injected by MCPServerFactory, bound to OAuthService.refreshTokens().
 *   This avoids ExternalMCPAdapter depending on NestJS DI directly.
 * - isReady() returns false until both transport initialization and tool discovery are done.
 * - External tools default to 'read'. User-configured permissionOverrides map individual tools to 'write'.
 */
export class ExternalMCPAdapter implements MCPServer {
  private readonly logger = new Logger(ExternalMCPAdapter.name);
  readonly serverId: string;
  readonly displayName: string;
  private cachedTools: MCPTool[] = [];
  private connected = false;

  constructor(
    private readonly transport: MCPTransport,
    private readonly config: ExternalMCPConfig,
    private readonly permissionOverrides: Map<string, MCPToolPermission>,
    private readonly tokenRefresher?: (mcpServerId: string) => Promise<string | null>,
    private readonly mcpServerId?: string,
  ) {
    this.serverId = config.serverId;
    this.displayName = config.displayName;
  }

  async connect(): Promise<void> {
    await this.transport.initialize();
    await this.refreshTools();
    this.connected = true;
  }

  isReady(): boolean {
    return this.connected && this.transport.isConnected();
  }

  async refreshTools(): Promise<void> {
    const rawTools = await this.transport.sendRequest('tools/list') as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };
    this.cachedTools = this.mapToMCPTools(rawTools?.tools ?? []);
  }

  listTools(): MCPTool[] {
    return this.cachedTools;
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const externalName = toolName.replace(`${this.serverId}.`, '');
    try {
      return await this.transport.sendRequest('tools/call', {
        name: externalName,
        arguments: input,
      });
    } catch (err) {
      // On 401/403, attempt token refresh and retry once
      if (this.isAuthError(err) && this.tokenRefresher && this.mcpServerId) {
        this.logger.warn(`Auth error on ${toolName}, attempting token refresh`);
        const newToken = await this.tokenRefresher(this.mcpServerId);
        if (newToken) {
          this.transport.updateCredentials?.(newToken);
          return this.transport.sendRequest('tools/call', {
            name: externalName,
            arguments: input,
          });
        }
      }
      throw err;
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    if (!this.connected) return { ok: false, error: 'Not connected' };
    return { ok: this.transport.isConnected() };
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.transport.close();
  }

  getTransport(): MCPTransport {
    return this.transport;
  }

  private mapToMCPTools(
    rawTools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>,
  ): MCPTool[] {
    return rawTools.map(tool => {
      const prefixedName = `${this.serverId}.${tool.name}`;
      const permission: MCPToolPermission = this.permissionOverrides.get(tool.name) ?? 'read';
      return {
        name: prefixedName,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        permission,
      };
    });
  }

  private isAuthError(err: unknown): boolean {
    if (err instanceof Error) {
      const status = (err as unknown as Record<string, unknown>).status;
      if (status === 401 || status === 403) return true;
      if (err.message.includes('401') || err.message.includes('403')) return true;
      if (err.message.toLowerCase().includes('unauthorized')) return true;
    }
    return false;
  }
}
