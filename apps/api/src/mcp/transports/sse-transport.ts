import { Logger } from '@nestjs/common';
import type { MCPTransport, SSETransportConfig } from './mcp-transport.interface';

/**
 * SSE (Server-Sent Events) transport for HTTP-based MCP servers.
 * Sends requests via POST, receives responses via SSE stream.
 * Supports Bearer token authentication from OAuth.
 */
export class SSETransport implements MCPTransport {
  private readonly logger = new Logger(SSETransport.name);
  private connected = false;
  private requestId = 0;
  private headers: Record<string, string>;

  constructor(private readonly url: string, headers: Record<string, string>) {
    this.headers = { ...headers };
  }

  async initialize(): Promise<void> {
    // MCP protocol handshake via POST
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'finch', version: '1.0.0' },
    });
    this.connected = true;
  }

  async sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const status = response.status;
        const text = await response.text().catch(() => '');
        if (status === 401 || status === 403) {
          const err = new Error(`HTTP ${status}: ${text}`);
          (err as unknown as Record<string, unknown>).status = status;
          throw err;
        }
        throw new Error(`HTTP ${status}: ${text}`);
      }

      const result = await response.json() as {
        id?: number;
        result?: unknown;
        error?: { code: number; message: string };
      };

      if (result.error) {
        throw new Error(`JSON-RPC error ${result.error.code}: ${result.error.message}`);
      }

      return result.result;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Request ${method} timed out after 30s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  updateCredentials(token: string): void {
    this.headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
  }
}
