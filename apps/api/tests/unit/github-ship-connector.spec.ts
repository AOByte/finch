import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GitHubShipConnectorService } from '../../src/connectors/github-ship-connector.service';
import { ConnectorRegistryService } from '../../src/connectors/connector-registry.service';
import { CredentialEncryptionService } from '../../src/connectors/credential-encryption.service';

const mockPullsCreate = vi.fn().mockResolvedValue({
  data: { number: 42, url: 'https://api.github.com/repos/test/repo/pulls/42', html_url: 'https://github.com/test/repo/pull/42' },
});

vi.mock('@octokit/rest', () => {
  class MockOctokit {
    pulls = { create: mockPullsCreate };
    constructor(_opts?: unknown) {}
  }
  return { Octokit: MockOctokit };
});

const mockAddRemote = vi.fn().mockResolvedValue(undefined);
const mockPush = vi.fn().mockResolvedValue(undefined);

vi.mock('simple-git', () => ({
  default: vi.fn().mockReturnValue({
    addRemote: mockAddRemote,
    push: mockPush,
  }),
}));

function makeService(envOverrides: Record<string, string | undefined> = {}) {
  const config = new ConfigService({ GITHUB_TOKEN: 'ghp_test', ENCRYPTION_KEY: 'a'.repeat(64), ...envOverrides });
  const registry = new ConnectorRegistryService();
  const encryption = new CredentialEncryptionService(new ConfigService({ ENCRYPTION_KEY: 'a'.repeat(64) }));
  return { service: new GitHubShipConnectorService(config, registry, encryption), registry };
}

describe('GitHubShipConnectorService', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('registers in ConnectorRegistryService on init', () => {
    const { service, registry } = makeService();
    service.onModuleInit();
    expect(registry.has('github-ship')).toBe(true);
  });

  it('initializes Octokit when token is provided', () => {
    const { service } = makeService();
    service.onModuleInit();
    expect(service).toBeDefined();
  });

  it('skips initialization when token is missing', () => {
    const { service } = makeService({ GITHUB_TOKEN: undefined });
    service.onModuleInit();
    expect(service.openPullRequest({
      owner: 'test', repo: 'repo', head: 'finch/plan-1', base: 'main',
      title: 'Fix', body: 'desc', runId: 'r1',
    })).rejects.toThrow('GitHub client not initialized');
  });

  it('opens a PR with correct params', async () => {
    const { service } = makeService();
    service.onModuleInit();
    const result = await service.openPullRequest({
      owner: 'test', repo: 'repo', head: 'finch/plan-1', base: 'main',
      title: 'Fix login', body: 'Fixes the login bug', runId: 'run-123',
    });
    expect(result.number).toBe(42);
    expect(result.htmlUrl).toBe('https://github.com/test/repo/pull/42');
  });

  it('pushes branch with auth token', async () => {
    const { service } = makeService();
    service.onModuleInit();
    await service.pushBranch('https://github.com/test/repo.git', '/tmp/workspace', 'finch/plan-1');
    const simpleGit = (await import('simple-git')).default;
    expect(simpleGit).toHaveBeenCalledWith('/tmp/workspace');
  });

  it('pushes branch without auth token', async () => {
    const { service } = makeService({ GITHUB_TOKEN: undefined });
    service.onModuleInit();
    await service.pushBranch('https://github.com/test/repo.git', '/tmp/workspace', 'finch/plan-1');
    const simpleGit = (await import('simple-git')).default;
    expect(simpleGit).toHaveBeenCalledWith('/tmp/workspace');
  });

  it('handles addRemote failure gracefully (remote already exists)', async () => {
    mockAddRemote.mockRejectedValueOnce(new Error('remote already exists'));
    
    const { service } = makeService();
    service.onModuleInit();
    // Should not throw — addRemote error is caught
    await service.pushBranch('https://github.com/test/repo.git', '/tmp/workspace', 'finch/plan-1');
  });
});
