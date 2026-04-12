import { Injectable, Logger } from '@nestjs/common';
import type { MCPServer, MCPTool, Phase } from '@finch/types';

const WRITE_ALLOWED_PHASES: Phase[] = ['EXECUTE', 'SHIP'];

@Injectable()
export class MCPRegistryService {
  private readonly logger = new Logger(MCPRegistryService.name);
  private readonly harnessServers = new Map<string, MCPServer[]>();

  registerServer(harnessId: string, server: MCPServer): void {
    const servers = this.harnessServers.get(harnessId) ?? [];
    // Prevent duplicate registration
    const existing = servers.findIndex(s => s.serverId === server.serverId);
    if (existing >= 0) {
      servers[existing] = server;
    } else {
      servers.push(server);
    }
    this.harnessServers.set(harnessId, servers);
    this.logger.log(`Registered MCP server "${server.serverId}" for harness ${harnessId}`);
  }

  unregisterServer(harnessId: string, serverId: string): void {
    const servers = this.harnessServers.get(harnessId) ?? [];
    const filtered = servers.filter(s => s.serverId !== serverId);
    this.harnessServers.set(harnessId, filtered);
    this.logger.log(`Unregistered MCP server "${serverId}" from harness ${harnessId}`);
  }

  getServersForHarness(harnessId: string): MCPServer[] {
    return this.harnessServers.get(harnessId) ?? [];
  }

  /**
   * List all MCP tools for a harness, filtered by phase.
   * Read tools are available in ALL phases.
   * Write tools are only available in EXECUTE and SHIP (FC-04 enforcement).
   */
  listToolsForHarness(harnessId: string, phase: Phase): MCPTool[] {
    const servers = this.harnessServers.get(harnessId) ?? [];
    const allTools: MCPTool[] = [];

    for (const server of servers) {
      allTools.push(...server.listTools());
    }

    if (WRITE_ALLOWED_PHASES.includes(phase)) {
      return allTools;
    }

    // Read-only phases: TRIGGER, ACQUIRE, PLAN — filter out write tools
    return allTools.filter(t => t.permission === 'read');
  }

  /**
   * Execute an MCP tool by name, with FC-04 phase enforcement.
   * Write tools are rejected in TRIGGER, ACQUIRE, and PLAN phases.
   */
  async executeTool(
    harnessId: string,
    toolName: string,
    input: Record<string, unknown>,
    phase: Phase,
  ): Promise<unknown> {
    const servers = this.harnessServers.get(harnessId) ?? [];
    const serverPrefix = toolName.split('.')[0];

    const server = servers.find(s => s.serverId === serverPrefix);
    if (!server) {
      throw new Error(`No MCP server found for tool: ${toolName}`);
    }

    // Find the tool to check its permission
    const tool = server.listTools().find(t => t.name === toolName);
    if (!tool) {
      throw new Error(`Unknown MCP tool: ${toolName}`);
    }

    // FC-04 enforcement: reject write tools in read-only phases
    if (tool.permission === 'write' && !WRITE_ALLOWED_PHASES.includes(phase)) {
      throw new Error(
        `FC-04 violation: write tool "${toolName}" not permitted in ${phase} phase`,
      );
    }

    return server.executeTool(toolName, input);
  }

  /**
   * Look up the permission of a tool by name.
   */
  getToolPermission(harnessId: string, toolName: string): 'read' | 'write' | undefined {
    const servers = this.harnessServers.get(harnessId) ?? [];
    const serverPrefix = toolName.split('.')[0];
    const server = servers.find(s => s.serverId === serverPrefix);
    if (!server) return undefined;
    const tool = server.listTools().find(t => t.name === toolName);
    return tool?.permission;
  }
}
