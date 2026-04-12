import { Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import type { MCPTransport, StdioTransportConfig } from './mcp-transport.interface';

/**
 * Stdio transport for MCP servers that run as child processes.
 * Communicates via JSON-RPC 2.0 over stdin/stdout.
 *
 * SECURITY: OAuth access tokens are injected as env vars into the child process.
 * This is the standard mechanism for stdio MCP servers — child process env vars
 * are accessible via /proc/$PID/environ on Linux by the same user.
 * envEncrypted in the DB is for at-rest storage only.
 */
export class StdioTransport implements MCPTransport {
  private readonly logger = new Logger(StdioTransport.name);
  private process: ChildProcess | null = null;
  private requestId = 0;
  private connected = false;
  private buffer = '';
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private config: StdioTransportConfig) {}

  async initialize(): Promise<void> {
    await this.spawnProcess();
    // MCP protocol handshake
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'finch', version: '1.0.0' },
    });
    this.connected = true;
  }

  private async spawnProcess(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const env = { ...process.env, ...this.config.env };
      this.process = spawn(this.config.command, this.config.args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        this.logger.warn(`[stdio stderr] ${data.toString().trim()}`);
      });

      this.process.on('error', (err) => {
        this.logger.error(`Process error: ${err.message}`);
        this.connected = false;
        reject(err);
      });

      this.process.on('close', (code) => {
        this.logger.log(`Process exited with code ${code}`);
        this.connected = false;
        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Process exited with code ${code}`));
        }
        this.pendingRequests.clear();
      });

      // Give the process a moment to start
      setTimeout(() => resolve(), 100);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: { code: number; message: string } };
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        this.logger.warn(`Failed to parse JSON-RPC message: ${trimmed.substring(0, 200)}`);
      }
    }
  }

  async sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Process stdin not writable');
    }

    const id = ++this.requestId;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after 30s`));
      }, 30_000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.process!.stdin!.write(message);
    });
  }

  async close(): Promise<void> {
    this.connected = false;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Transport closed'));
    }
    this.pendingRequests.clear();

    if (this.process) {
      this.process.kill('SIGTERM');
      // Force kill after 5 seconds
      const forceKillTimer = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5_000);

      await new Promise<void>((resolve) => {
        this.process!.on('close', () => {
          clearTimeout(forceKillTimer);
          resolve();
        });
      });
      this.process = null;
    }
  }

  isConnected(): boolean {
    return this.connected && this.process !== null && !this.process.killed;
  }

  updateCredentials(token: string): void {
    // Stdio processes receive tokens via env at spawn time.
    // To update, we need to restart with new env.
    // The ProcessManager handles this by calling close() then re-initializing.
    this.config = {
      ...this.config,
      env: { ...this.config.env, ...this.extractTokenEnv(token) },
    };
  }

  /** Get the current config (used by ProcessManager for restart). */
  getConfig(): StdioTransportConfig {
    return this.config;
  }

  /** Get the underlying process (for testing/monitoring). */
  getProcess(): ChildProcess | null {
    return this.process;
  }

  private extractTokenEnv(token: string): Record<string, string> {
    // Find the token env var key from the current config
    // Convention: the last env var that looks like a token gets updated
    const tokenKeys = Object.keys(this.config.env).filter(
      k => k.includes('TOKEN') || k.includes('KEY') || k.includes('SECRET'),
    );
    if (tokenKeys.length > 0) {
      return { [tokenKeys[tokenKeys.length - 1]]: token };
    }
    return {};
  }
}
