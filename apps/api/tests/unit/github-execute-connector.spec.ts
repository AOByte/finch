import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GitHubExecuteConnectorService } from '../../src/connectors/github-execute-connector.service';
import { ConnectorRegistryService } from '../../src/connectors/connector-registry.service';
import { CredentialEncryptionService } from '../../src/connectors/credential-encryption.service';
import { AuditLoggerService } from '../../src/audit/audit-logger.service';

vi.mock('simple-git', () => ({
  default: vi.fn().mockReturnValue({
    clone: vi.fn().mockResolvedValue(undefined),
    checkoutLocalBranch: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn().mockImplementation(() => {
    const proc = {
      stdout: { on: vi.fn((event: string, cb: (d: Buffer) => void) => { if (event === 'data') cb(Buffer.from('ok\n')); }) },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number | null) => void) => { if (event === 'close') cb(0); }),
    };
    return proc;
  }),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    mkdtemp: vi.fn().mockResolvedValue('/tmp/finch-test'),
    rm: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

const mockAuditLogger = {
  log: vi.fn().mockResolvedValue(undefined),
} as unknown as AuditLoggerService;

function makeService() {
  const config = new ConfigService({ GITHUB_TOKEN: 'ghp_test', ENCRYPTION_KEY: 'a'.repeat(64) });
  const registry = new ConnectorRegistryService();
  const encryption = new CredentialEncryptionService(new ConfigService({ ENCRYPTION_KEY: 'a'.repeat(64) }));
  return new GitHubExecuteConnectorService(config, registry, encryption, mockAuditLogger);
}

describe('GitHubExecuteConnectorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers in ConnectorRegistryService on init', () => {
    const config = new ConfigService({ GITHUB_TOKEN: 'ghp_test', ENCRYPTION_KEY: 'a'.repeat(64) });
    const registry = new ConnectorRegistryService();
    const encryption = new CredentialEncryptionService(new ConfigService({ ENCRYPTION_KEY: 'a'.repeat(64) }));
    const service = new GitHubExecuteConnectorService(config, registry, encryption, mockAuditLogger);
    service.onModuleInit();
    expect(registry.has('github-execute')).toBe(true);
  });

  it('creates workspace by cloning repo and creating branch', async () => {
    const service = makeService();
    service.onModuleInit();
    const workspace = await service.createWorkspace('https://github.com/test/repo.git', 'plan-123');
    expect(workspace.path).toBe('/tmp/finch-test');
    expect(workspace.branch).toBe('finch/plan-123');
    expect(typeof workspace.cleanup).toBe('function');
  });

  it('workspace cleanup removes directory', async () => {
    const service = makeService();
    service.onModuleInit();
    const workspace = await service.createWorkspace('https://github.com/test/repo.git', 'plan-123');
    await workspace.cleanup();
    const { rm } = await import('fs/promises');
    expect(rm).toHaveBeenCalledWith('/tmp/finch-test', { recursive: true, force: true });
  });

  it('applies file edits and commits', async () => {
    const service = makeService();
    service.onModuleInit();
    const workspace = { path: '/tmp/finch-test', branch: 'finch/test', cleanup: vi.fn() };
    await service.applyEdits(workspace, [
      { path: 'src/index.ts', content: 'console.log("hello")' },
    ]);
    const { writeFile } = await import('fs/promises');
    expect(writeFile).toHaveBeenCalled();
  });

  it('runCommand emits audit events and returns result', async () => {
    const service = makeService();
    service.onModuleInit();
    const workspace = { path: '/tmp/finch-test', branch: 'finch/test', cleanup: vi.fn() };
    const result = await service.runCommand({
      workspace,
      command: 'echo ok',
      timeout: 5000,
      conditionId: 'cond-1',
      runId: 'run-1',
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(mockAuditLogger.log).toHaveBeenCalledTimes(2);
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'verification_run',
    }));
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'verification_result',
    }));
  });

  it('workspace cleanup handles errors gracefully', async () => {
    const { rm } = await import('fs/promises');
    vi.mocked(rm).mockRejectedValueOnce(new Error('Permission denied'));
    const service = makeService();
    service.onModuleInit();
    const workspace = await service.createWorkspace('https://github.com/test/repo.git', 'plan-123');
    // Should not throw
    await workspace.cleanup();
  });
});
