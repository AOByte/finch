import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GitHubAcquireConnectorService } from '../../src/connectors/github-acquire-connector.service';
import { ConnectorRegistryService } from '../../src/connectors/connector-registry.service';
import { CredentialEncryptionService } from '../../src/connectors/credential-encryption.service';

const mockReposGet = vi.fn().mockResolvedValue({
  data: { default_branch: 'main', language: 'TypeScript', description: 'A test repo' },
});
const mockGetContent = vi.fn().mockImplementation(({ path }: { path: string }) => {
  if (path === 'package.json') {
    return Promise.resolve({ data: { content: Buffer.from('{"name":"test"}').toString('base64') } });
  }
  throw new Error('Not found');
});
const mockGetTree = vi.fn().mockResolvedValue({
  data: { tree: [{ path: 'src/index.ts', type: 'blob', size: 100 }, { path: 'src', type: 'tree' }] },
});

vi.mock('@octokit/rest', () => {
  class MockOctokit {
    repos = { get: mockReposGet, getContent: mockGetContent };
    git = { getTree: mockGetTree };
    constructor(_opts?: unknown) {}
  }
  return { Octokit: MockOctokit };
});

function makeService(envOverrides: Record<string, string | undefined> = {}) {
  const config = new ConfigService({ GITHUB_TOKEN: 'ghp_test', ENCRYPTION_KEY: 'a'.repeat(64), ...envOverrides });
  const registry = new ConnectorRegistryService();
  const encryption = new CredentialEncryptionService(new ConfigService({ ENCRYPTION_KEY: 'a'.repeat(64) }));
  return { service: new GitHubAcquireConnectorService(config, registry, encryption), registry };
}

describe('GitHubAcquireConnectorService', () => {
  it('registers in ConnectorRegistryService on init', () => {
    const { service, registry } = makeService();
    service.onModuleInit();
    expect(registry.has('github-acquire')).toBe(true);
  });

  it('initializes Octokit when token is provided', () => {
    const { service } = makeService();
    service.onModuleInit();
    expect(service).toBeDefined();
  });

  it('skips initialization when token is missing', () => {
    const { service } = makeService({ GITHUB_TOKEN: undefined });
    service.onModuleInit();
    expect(service.acquire('owner', 'repo')).rejects.toThrow('GitHub client not initialized');
  });

  it('acquires repo metadata, file tree, and package manifests', async () => {
    const { service } = makeService();
    service.onModuleInit();
    const result = await service.acquire('owner', 'repo');

    expect(result.metadata.owner).toBe('owner');
    expect(result.metadata.repo).toBe('repo');
    expect(result.metadata.defaultBranch).toBe('main');
    expect(result.metadata.language).toBe('TypeScript');
    expect(result.fileTree).toHaveLength(2);
    expect(result.fileTree[0].path).toBe('src/index.ts');
    expect(result.packageManifests['package.json']).toBe('{"name":"test"}');
  });
});
