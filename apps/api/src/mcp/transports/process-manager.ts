import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { StdioTransport } from './stdio-transport';

/**
 * Manages stdio child process lifecycle: crash recovery with exponential backoff,
 * graceful shutdown, and credential rotation (restart with new env vars).
 */
@Injectable()
export class ProcessManager implements OnModuleDestroy {
  private readonly logger = new Logger(ProcessManager.name);
  private readonly managedTransports = new Map<string, {
    transport: StdioTransport;
    restartCount: number;
    restartTimer?: ReturnType<typeof setTimeout>;
  }>();

  register(serverId: string, transport: StdioTransport): void {
    this.managedTransports.set(serverId, { transport, restartCount: 0 });
    this.logger.log(`Registered stdio process for server "${serverId}"`);
  }

  unregister(serverId: string): void {
    const entry = this.managedTransports.get(serverId);
    if (entry) {
      if (entry.restartTimer) clearTimeout(entry.restartTimer);
      this.managedTransports.delete(serverId);
      this.logger.log(`Unregistered stdio process for server "${serverId}"`);
    }
  }

  async stop(serverId: string): Promise<void> {
    const entry = this.managedTransports.get(serverId);
    if (entry) {
      if (entry.restartTimer) clearTimeout(entry.restartTimer);
      await entry.transport.close();
      this.managedTransports.delete(serverId);
      this.logger.log(`Stopped stdio process for server "${serverId}"`);
    }
  }

  /**
   * Restart a stdio process with updated credentials.
   * Used after OAuth token refresh — stdio processes receive tokens via env at spawn time.
   */
  async restartWithNewCredentials(serverId: string, token: string): Promise<void> {
    const entry = this.managedTransports.get(serverId);
    if (!entry) {
      this.logger.warn(`Cannot restart unknown server "${serverId}"`);
      return;
    }

    await entry.transport.close();
    entry.transport.updateCredentials(token);
    await entry.transport.initialize();
    entry.restartCount = 0;
    this.logger.log(`Restarted stdio process for server "${serverId}" with new credentials`);
  }

  /**
   * Schedule a restart with exponential backoff: 1s, 2s, 4s, 8s, max 30s.
   * Resets on success.
   */
  scheduleRestart(serverId: string, onRestarted?: () => void): void {
    const entry = this.managedTransports.get(serverId);
    if (!entry) return;

    const delay = Math.min(1000 * Math.pow(2, entry.restartCount), 30_000);
    entry.restartCount++;

    this.logger.log(`Scheduling restart for "${serverId}" in ${delay}ms (attempt ${entry.restartCount})`);

    entry.restartTimer = setTimeout(async () => {
      try {
        await entry.transport.close().catch(() => {});
        await entry.transport.initialize();
        entry.restartCount = 0;
        this.logger.log(`Successfully restarted "${serverId}"`);
        onRestarted?.();
      } catch (err) {
        this.logger.error(`Restart failed for "${serverId}": ${(err as Error).message}`);
        this.scheduleRestart(serverId, onRestarted);
      }
    }, delay);
  }

  isManaged(serverId: string): boolean {
    return this.managedTransports.has(serverId);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log(`Shutting down ${this.managedTransports.size} managed processes`);
    const stops = Array.from(this.managedTransports.keys()).map(id => this.stop(id));
    await Promise.allSettled(stops);
  }
}
