import { describe, it, expect, vi } from 'vitest';
import { GitHubMCPServer } from '../../src/mcp/servers/github-mcp-server';

function makeMocks() {
  return {
    acquire: {
      acquire: vi.fn().mockResolvedValue({
        metadata: { defaultBranch: 'main', language: 'TypeScript' },
        fileTree: ['src/index.ts', 'package.json'],
        packageManifests: { 'package.json': '{}' },
      }),
    },
    execute: {
      createWorkspace: vi.fn().mockResolvedValue({ path: '/tmp/ws', branch: 'finch/fix', cleanup: vi.fn() }),
      applyEdits: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),
    },
    ship: {
      pushBranch: vi.fn().mockResolvedValue(undefined),
      openPullRequest: vi.fn().mockResolvedValue({ url: 'https://github.com/o/r/pull/1', number: 1 }),
    },
  };
}

describe('GitHubMCPServer', () => {
  it('has correct serverId and displayName', () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    expect(server.serverId).toBe('github');
    expect(server.displayName).toBe('GitHub');
  });

  it('listTools returns 11 tools (4 read, 7 write)', () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const tools = server.listTools();
    expect(tools).toHaveLength(11);
    expect(tools.filter(t => t.permission === 'read')).toHaveLength(4);
    expect(tools.filter(t => t.permission === 'write')).toHaveLength(7);
  });

  it('executeTool github.getRepo returns metadata', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.getRepo', { owner: 'o', repo: 'r' });
    expect(result).toEqual({ defaultBranch: 'main', language: 'TypeScript' });
    expect(m.acquire.acquire).toHaveBeenCalledWith('o', 'r');
  });

  it('executeTool github.getFileTree returns fileTree', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.getFileTree', { owner: 'o', repo: 'r' });
    expect(result).toEqual({ fileTree: ['src/index.ts', 'package.json'] });
  });

  it('executeTool github.getContent returns packageManifests', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.getContent', { owner: 'o', repo: 'r', path: 'pkg.json' });
    expect(result).toEqual({ packageManifests: { 'package.json': '{}' } });
  });

  it('executeTool github.searchCode returns stub', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.searchCode', { owner: 'o', repo: 'r', query: 'test' });
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('message');
  });

  it('executeTool github.cloneRepo calls createWorkspace', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.cloneRepo', { repoUrl: 'https://github.com/o/r', planId: 'p1' });
    expect(result).toEqual({ workspacePath: '/tmp/ws', branch: 'finch/fix' });
    expect(m.execute.createWorkspace).toHaveBeenCalledWith('https://github.com/o/r', 'p1');
  });

  it('executeTool github.applyEdit calls applyEdits', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.applyEdit', {
      workspacePath: '/tmp/ws', filePath: 'src/main.ts', content: 'new code',
    });
    expect(result).toEqual({ success: true, filePath: 'src/main.ts' });
    expect(m.execute.applyEdits).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/ws' }),
      [{ path: 'src/main.ts', content: 'new code' }],
    );
  });

  it('executeTool github.runCommand calls runCommand', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.runCommand', {
      workspacePath: '/tmp/ws', command: 'npm test', timeout: 5000, conditionId: 'c1', runId: 'r1',
    });
    expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 });
    expect(m.execute.runCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'npm test',
      timeout: 5000,
      conditionId: 'c1',
      runId: 'r1',
    }));
  });

  it('executeTool github.runCommand uses default timeout', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    await server.executeTool('github.runCommand', {
      workspacePath: '/tmp/ws', command: 'echo hi', conditionId: 'c1', runId: 'r1',
    });
    expect(m.execute.runCommand).toHaveBeenCalledWith(expect.objectContaining({ timeout: 30000 }));
  });

  it('executeTool github.createBranch returns stub success', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.createBranch', { workspacePath: '/tmp/ws', branchName: 'fix' });
    expect(result).toHaveProperty('success', true);
  });

  it('executeTool github.commitAndPush calls pushBranch', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.commitAndPush', {
      repoUrl: 'https://github.com/o/r', workspacePath: '/tmp/ws', branch: 'fix',
    });
    expect(result).toEqual({ success: true, branch: 'fix' });
    expect(m.ship.pushBranch).toHaveBeenCalledWith('https://github.com/o/r', '/tmp/ws', 'fix');
  });

  it('executeTool github.createPR calls openPullRequest', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.executeTool('github.createPR', {
      owner: 'o', repo: 'r', title: 'Fix', body: 'desc', head: 'fix', base: 'main', runId: 'r1',
    });
    expect(result).toEqual({ url: 'https://github.com/o/r/pull/1', number: 1 });
  });

  it('executeTool github.createPR defaults base to main', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    await server.executeTool('github.createPR', {
      owner: 'o', repo: 'r', title: 'Fix', body: 'desc', head: 'fix', runId: 'r1',
    });
    expect(m.ship.openPullRequest).toHaveBeenCalledWith(expect.objectContaining({ base: 'main' }));
  });

  it('executeTool github.cleanupWorkspace removes directory', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    // Use a temp path that doesn't exist — rm with force:true won't throw
    const result = await server.executeTool('github.cleanupWorkspace', {
      workspacePath: '/tmp/nonexistent-ws-test',
    });
    expect(result).toHaveProperty('success', true);
  });

  it('executeTool throws for unknown tool', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    await expect(server.executeTool('github.unknown', {})).rejects.toThrow('Unknown GitHub MCP tool');
  });

  it('healthCheck returns ok:true when acquire succeeds', async () => {
    const m = makeMocks();
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.healthCheck();
    expect(result).toEqual({ ok: true });
  });

  it('healthCheck returns ok:false when not initialized', async () => {
    const m = makeMocks();
    m.acquire.acquire.mockRejectedValue(new Error('GitHub client not initialized'));
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('healthCheck returns ok:true on network errors', async () => {
    const m = makeMocks();
    m.acquire.acquire.mockRejectedValue(new Error('ECONNREFUSED'));
    const server = new GitHubMCPServer(m.acquire as never, m.execute as never, m.ship as never);
    const result = await server.healthCheck();
    expect(result.ok).toBe(true);
  });
});
