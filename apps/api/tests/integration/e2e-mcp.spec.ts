import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPRegistryService } from '../../src/mcp/mcp-registry.service';
import { JiraMCPServer } from '../../src/mcp/servers/jira-mcp-server';
import { GitHubMCPServer } from '../../src/mcp/servers/github-mcp-server';
import { SlackMCPServer } from '../../src/mcp/servers/slack-mcp-server';
import type { MCPServer, MCPTool, Phase } from '@finch/types';

/**
 * Wave 5A E2E Integration Tests
 *
 * W5A-12: ACQUIRE agent calls jira.getIssue (read tool) via MCP
 * W5A-13: EXECUTE agent calls github.cloneRepo + github.applyEdit (write tools)
 * W5A-14: Attempt write tool in PLAN phase → FC-04 rejection
 * W5A-15: MCPRegistryService phase filtering comprehensive tests
 */

// --- Mock connectors ---

function makeMockJiraConnector() {
  return {
    fetchIssue: vi.fn().mockResolvedValue({
      key: 'MC-208',
      summary: 'Fix authentication bug',
      description: 'Users cannot log in after password reset',
      status: 'Open',
      assignee: 'dev@company.com',
      comments: [{ body: 'Reproduced on staging' }],
      linkedIssues: [{ key: 'MC-100' }],
      subtasks: [{ key: 'MC-209' }],
    }),
  };
}

function makeMockGitHubConnectors() {
  return {
    acquire: {
      acquire: vi.fn().mockResolvedValue({
        metadata: { defaultBranch: 'main', language: 'TypeScript', description: 'Test repo' },
        fileTree: ['src/index.ts', 'src/auth.ts', 'package.json'],
        packageManifests: { 'package.json': '{ "name": "test" }' },
      }),
    },
    execute: {
      createWorkspace: vi.fn().mockResolvedValue({
        path: '/tmp/finch-ws-abc123',
        branch: 'finch/fix-mc-208',
        cleanup: vi.fn(),
      }),
      applyEdits: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn().mockResolvedValue({ stdout: 'All tests passed', stderr: '', exitCode: 0 }),
    },
    ship: {
      pushBranch: vi.fn().mockResolvedValue(undefined),
      openPullRequest: vi.fn().mockResolvedValue({
        url: 'https://github.com/org/repo/pull/42',
        number: 42,
      }),
    },
  };
}

function makeMockSlackConnector() {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
  };
}

describe('W5A-12: ACQUIRE agent calls jira.getIssue (read tool) via MCP', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
    const jiraServer = new JiraMCPServer(makeMockJiraConnector() as never);
    registry.registerServer('harness-1', jiraServer);
  });

  it('jira.getIssue is available in ACQUIRE phase', () => {
    const tools = registry.listToolsForHarness('harness-1', 'ACQUIRE');
    const jiraGetIssue = tools.find(t => t.name === 'jira.getIssue');
    expect(jiraGetIssue).toBeDefined();
    expect(jiraGetIssue!.permission).toBe('read');
  });

  it('ACQUIRE agent can execute jira.getIssue and receive issue data', async () => {
    const result = await registry.executeTool(
      'harness-1',
      'jira.getIssue',
      { issueKey: 'MC-208' },
      'ACQUIRE',
    );

    expect(result).toHaveProperty('key', 'MC-208');
    expect(result).toHaveProperty('summary', 'Fix authentication bug');
    expect(result).toHaveProperty('status', 'Open');
  });

  it('jira.getIssue is available in all 5 TAPES phases', () => {
    const phases: Phase[] = ['TRIGGER', 'ACQUIRE', 'PLAN', 'EXECUTE', 'SHIP'];
    for (const phase of phases) {
      const tools = registry.listToolsForHarness('harness-1', phase);
      expect(tools.find(t => t.name === 'jira.getIssue')).toBeDefined();
    }
  });

  it('jira.searchIssues is available in ACQUIRE phase', async () => {
    const tools = registry.listToolsForHarness('harness-1', 'ACQUIRE');
    expect(tools.find(t => t.name === 'jira.searchIssues')).toBeDefined();
  });

  it('jira.addComment (write) is NOT available in ACQUIRE phase', () => {
    const tools = registry.listToolsForHarness('harness-1', 'ACQUIRE');
    expect(tools.find(t => t.name === 'jira.addComment')).toBeUndefined();
  });
});

describe('W5A-13: EXECUTE agent calls github.cloneRepo + github.applyEdit (write tools)', () => {
  let registry: MCPRegistryService;
  let ghMocks: ReturnType<typeof makeMockGitHubConnectors>;

  beforeEach(() => {
    registry = new MCPRegistryService();
    ghMocks = makeMockGitHubConnectors();
    const githubServer = new GitHubMCPServer(
      ghMocks.acquire as never,
      ghMocks.execute as never,
      ghMocks.ship as never,
    );
    registry.registerServer('harness-1', githubServer);
  });

  it('github.cloneRepo and github.applyEdit are available in EXECUTE phase', () => {
    const tools = registry.listToolsForHarness('harness-1', 'EXECUTE');
    expect(tools.find(t => t.name === 'github.cloneRepo')).toBeDefined();
    expect(tools.find(t => t.name === 'github.applyEdit')).toBeDefined();
  });

  it('EXECUTE agent can clone repo and apply edits', async () => {
    // Step 1: Clone the repository
    const cloneResult = await registry.executeTool(
      'harness-1',
      'github.cloneRepo',
      { repoUrl: 'https://github.com/org/repo', planId: 'plan-1' },
      'EXECUTE',
    );
    expect(cloneResult).toHaveProperty('workspacePath', '/tmp/finch-ws-abc123');
    expect(cloneResult).toHaveProperty('branch', 'finch/fix-mc-208');

    // Step 2: Apply edits
    const editResult = await registry.executeTool(
      'harness-1',
      'github.applyEdit',
      {
        workspacePath: '/tmp/finch-ws-abc123',
        filePath: 'src/auth.ts',
        content: 'export function login() { /* fixed */ }',
      },
      'EXECUTE',
    );
    expect(editResult).toHaveProperty('success', true);
    expect(editResult).toHaveProperty('filePath', 'src/auth.ts');

    // Verify connector calls
    expect(ghMocks.execute.createWorkspace).toHaveBeenCalledWith(
      'https://github.com/org/repo',
      'plan-1',
    );
    expect(ghMocks.execute.applyEdits).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/finch-ws-abc123' }),
      [{ path: 'src/auth.ts', content: 'export function login() { /* fixed */ }' }],
    );
  });

  it('all 7 write tools are available in EXECUTE phase', () => {
    const tools = registry.listToolsForHarness('harness-1', 'EXECUTE');
    const writeTools = tools.filter(t => t.permission === 'write');
    expect(writeTools).toHaveLength(7);
  });

  it('write tools are also available in SHIP phase', () => {
    const tools = registry.listToolsForHarness('harness-1', 'SHIP');
    const writeTools = tools.filter(t => t.permission === 'write');
    expect(writeTools).toHaveLength(7);
  });

  it('full workflow: clone → edit → run tests → push → create PR', async () => {
    // Clone
    await registry.executeTool('harness-1', 'github.cloneRepo', {
      repoUrl: 'https://github.com/org/repo', planId: 'plan-1',
    }, 'EXECUTE');

    // Edit
    await registry.executeTool('harness-1', 'github.applyEdit', {
      workspacePath: '/tmp/finch-ws-abc123', filePath: 'src/auth.ts', content: 'fixed code',
    }, 'EXECUTE');

    // Run tests
    const testResult = await registry.executeTool('harness-1', 'github.runCommand', {
      workspacePath: '/tmp/finch-ws-abc123', command: 'npm test',
      conditionId: 'tests-pass', runId: 'run-1',
    }, 'EXECUTE');
    expect(testResult).toHaveProperty('exitCode', 0);

    // Push (SHIP phase)
    await registry.executeTool('harness-1', 'github.commitAndPush', {
      repoUrl: 'https://github.com/org/repo',
      workspacePath: '/tmp/finch-ws-abc123',
      branch: 'finch/fix-mc-208',
    }, 'SHIP');

    // Create PR (SHIP phase)
    const prResult = await registry.executeTool('harness-1', 'github.createPR', {
      owner: 'org', repo: 'repo', title: 'Fix MC-208',
      body: 'Fixes auth bug', head: 'finch/fix-mc-208', runId: 'run-1',
    }, 'SHIP');
    expect(prResult).toHaveProperty('number', 42);
  });
});

describe('W5A-14: FC-04 enforcement — write tool rejection in PLAN phase', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
    const jiraServer = new JiraMCPServer(makeMockJiraConnector() as never);
    const ghMocks = makeMockGitHubConnectors();
    const githubServer = new GitHubMCPServer(
      ghMocks.acquire as never,
      ghMocks.execute as never,
      ghMocks.ship as never,
    );
    const slackServer = new SlackMCPServer(makeMockSlackConnector() as never);
    registry.registerServer('harness-1', jiraServer);
    registry.registerServer('harness-1', githubServer);
    registry.registerServer('harness-1', slackServer);
  });

  it('write tool jira.addComment is rejected in PLAN phase', async () => {
    await expect(
      registry.executeTool('harness-1', 'jira.addComment', { issueKey: 'MC-208', body: 'test' }, 'PLAN'),
    ).rejects.toThrow('FC-04 violation: write tool "jira.addComment" not permitted in PLAN phase');
  });

  it('write tool github.cloneRepo is rejected in PLAN phase', async () => {
    await expect(
      registry.executeTool('harness-1', 'github.cloneRepo', { repoUrl: 'url', planId: 'p' }, 'PLAN'),
    ).rejects.toThrow('FC-04 violation');
  });

  it('write tool slack.postMessage is rejected in PLAN phase', async () => {
    await expect(
      registry.executeTool('harness-1', 'slack.postMessage', { channel: 'C1', text: 'hi' }, 'PLAN'),
    ).rejects.toThrow('FC-04 violation');
  });

  it('write tool is rejected in TRIGGER phase', async () => {
    await expect(
      registry.executeTool('harness-1', 'jira.addComment', { issueKey: 'MC-208', body: 'x' }, 'TRIGGER'),
    ).rejects.toThrow('FC-04 violation');
  });

  it('write tool is rejected in ACQUIRE phase', async () => {
    await expect(
      registry.executeTool('harness-1', 'github.cloneRepo', { repoUrl: 'url', planId: 'p' }, 'ACQUIRE'),
    ).rejects.toThrow('FC-04 violation');
  });

  it('read tools succeed in PLAN phase', async () => {
    const result = await registry.executeTool(
      'harness-1', 'jira.getIssue', { issueKey: 'MC-208' }, 'PLAN',
    );
    expect(result).toHaveProperty('key', 'MC-208');
  });

  it('read tools succeed in TRIGGER phase', async () => {
    const result = await registry.executeTool(
      'harness-1', 'jira.getIssue', { issueKey: 'MC-208' }, 'TRIGGER',
    );
    expect(result).toHaveProperty('key', 'MC-208');
  });

  it('write tool succeeds in EXECUTE phase', async () => {
    const result = await registry.executeTool(
      'harness-1', 'jira.addComment', { issueKey: 'MC-208', body: 'hi' }, 'EXECUTE',
    );
    expect(result).toHaveProperty('success', true);
  });

  it('write tool succeeds in SHIP phase', async () => {
    const result = await registry.executeTool(
      'harness-1', 'slack.postMessage', { channel: 'C1', text: 'done' }, 'SHIP',
    );
    expect(result).toHaveProperty('success', true);
  });
});

describe('W5A-15: MCPRegistryService phase filtering — comprehensive', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
    const jiraServer = new JiraMCPServer(makeMockJiraConnector() as never);
    const ghMocks = makeMockGitHubConnectors();
    const githubServer = new GitHubMCPServer(
      ghMocks.acquire as never,
      ghMocks.execute as never,
      ghMocks.ship as never,
    );
    const slackServer = new SlackMCPServer(makeMockSlackConnector() as never);
    registry.registerServer('harness-1', jiraServer);
    registry.registerServer('harness-1', githubServer);
    registry.registerServer('harness-1', slackServer);
  });

  it('total tools across all servers: 19 (9 read, 10 write)', () => {
    // All tools visible in EXECUTE phase
    const tools = registry.listToolsForHarness('harness-1', 'EXECUTE');
    expect(tools).toHaveLength(19);
    expect(tools.filter(t => t.permission === 'read')).toHaveLength(9);
    expect(tools.filter(t => t.permission === 'write')).toHaveLength(10);
  });

  it('TRIGGER phase: only 9 read tools visible', () => {
    const tools = registry.listToolsForHarness('harness-1', 'TRIGGER');
    expect(tools).toHaveLength(9);
    expect(tools.every(t => t.permission === 'read')).toBe(true);
  });

  it('ACQUIRE phase: only 9 read tools visible', () => {
    const tools = registry.listToolsForHarness('harness-1', 'ACQUIRE');
    expect(tools).toHaveLength(9);
    expect(tools.every(t => t.permission === 'read')).toBe(true);
  });

  it('PLAN phase: only 9 read tools visible', () => {
    const tools = registry.listToolsForHarness('harness-1', 'PLAN');
    expect(tools).toHaveLength(9);
    expect(tools.every(t => t.permission === 'read')).toBe(true);
  });

  it('EXECUTE phase: all 19 tools visible', () => {
    const tools = registry.listToolsForHarness('harness-1', 'EXECUTE');
    expect(tools).toHaveLength(19);
  });

  it('SHIP phase: all 19 tools visible', () => {
    const tools = registry.listToolsForHarness('harness-1', 'SHIP');
    expect(tools).toHaveLength(19);
  });

  it('tools are correctly namespaced to their server', () => {
    const tools = registry.listToolsForHarness('harness-1', 'EXECUTE');
    const jiraTools = tools.filter(t => t.name.startsWith('jira.'));
    const githubTools = tools.filter(t => t.name.startsWith('github.'));
    const slackTools = tools.filter(t => t.name.startsWith('slack.'));
    expect(jiraTools).toHaveLength(6);
    expect(githubTools).toHaveLength(11);
    expect(slackTools).toHaveLength(2);
  });

  it('getToolPermission works for tools across all servers', () => {
    expect(registry.getToolPermission('harness-1', 'jira.getIssue')).toBe('read');
    expect(registry.getToolPermission('harness-1', 'jira.addComment')).toBe('write');
    expect(registry.getToolPermission('harness-1', 'github.getRepo')).toBe('read');
    expect(registry.getToolPermission('harness-1', 'github.cloneRepo')).toBe('write');
    expect(registry.getToolPermission('harness-1', 'slack.getChannelHistory')).toBe('read');
    expect(registry.getToolPermission('harness-1', 'slack.postMessage')).toBe('write');
  });

  it('registering/unregistering updates tool visibility', () => {
    // Initial: 19 tools
    expect(registry.listToolsForHarness('harness-1', 'EXECUTE')).toHaveLength(19);

    // Remove Slack server
    registry.unregisterServer('harness-1', 'slack');
    expect(registry.listToolsForHarness('harness-1', 'EXECUTE')).toHaveLength(17);

    // Remove GitHub server
    registry.unregisterServer('harness-1', 'github');
    expect(registry.listToolsForHarness('harness-1', 'EXECUTE')).toHaveLength(6);

    // Remove Jira server
    registry.unregisterServer('harness-1', 'jira');
    expect(registry.listToolsForHarness('harness-1', 'EXECUTE')).toHaveLength(0);
  });

  it('servers are isolated per harness', () => {
    // harness-1 has 3 servers with 19 tools
    expect(registry.listToolsForHarness('harness-1', 'EXECUTE')).toHaveLength(19);

    // harness-2 has no servers
    expect(registry.listToolsForHarness('harness-2', 'EXECUTE')).toHaveLength(0);

    // Register only Jira for harness-2
    const jira2 = new JiraMCPServer(makeMockJiraConnector() as never);
    registry.registerServer('harness-2', jira2);
    expect(registry.listToolsForHarness('harness-2', 'EXECUTE')).toHaveLength(6);

    // harness-1 still has 19
    expect(registry.listToolsForHarness('harness-1', 'EXECUTE')).toHaveLength(19);
  });

  it('executeTool routes to correct server across multiple servers', async () => {
    // Jira read tool
    const jiraResult = await registry.executeTool(
      'harness-1', 'jira.getIssue', { issueKey: 'MC-208' }, 'EXECUTE',
    );
    expect(jiraResult).toHaveProperty('key', 'MC-208');

    // GitHub read tool
    const ghResult = await registry.executeTool(
      'harness-1', 'github.getRepo', { owner: 'org', repo: 'r' }, 'EXECUTE',
    );
    expect(ghResult).toHaveProperty('defaultBranch', 'main');

    // Slack write tool
    const slackResult = await registry.executeTool(
      'harness-1', 'slack.postMessage', { channel: 'C1', text: 'msg' }, 'EXECUTE',
    );
    expect(slackResult).toHaveProperty('success', true);
  });
});

// ============================================================
// Jira MCP Server — individual tool execution
// ============================================================
describe('Jira MCP Server — individual tool execution', () => {
  let registry: MCPRegistryService;
  let jiraMock: ReturnType<typeof makeMockJiraConnector>;

  beforeEach(() => {
    registry = new MCPRegistryService();
    jiraMock = makeMockJiraConnector();
    const jiraServer = new JiraMCPServer(jiraMock as never);
    registry.registerServer('harness-1', jiraServer);
  });

  it('jira.getIssue returns full issue payload', async () => {
    const r = await registry.executeTool('harness-1', 'jira.getIssue', { issueKey: 'MC-208' }, 'EXECUTE');
    expect(r).toMatchObject({ key: 'MC-208', summary: 'Fix authentication bug', status: 'Open' });
  });

  it('jira.searchIssues returns issues array', async () => {
    const r = await registry.executeTool('harness-1', 'jira.searchIssues', { jql: 'project=MC', issueKey: 'MC-208' }, 'EXECUTE') as { issues: unknown[] };
    expect(r.issues).toHaveLength(1);
  });

  it('jira.getComments returns comments from issue', async () => {
    const r = await registry.executeTool('harness-1', 'jira.getComments', { issueKey: 'MC-208' }, 'EXECUTE') as { comments: unknown[] };
    expect(r.comments).toEqual([{ body: 'Reproduced on staging' }]);
  });

  it('jira.getLinkedIssues returns linked issues and subtasks', async () => {
    const r = await registry.executeTool('harness-1', 'jira.getLinkedIssues', { issueKey: 'MC-208' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.linkedIssues).toEqual([{ key: 'MC-100' }]);
    expect(r.subtasks).toEqual([{ key: 'MC-209' }]);
  });

  it('jira.addComment returns success stub', async () => {
    const r = await registry.executeTool('harness-1', 'jira.addComment', { issueKey: 'MC-208', body: 'test' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.issueKey).toBe('MC-208');
  });

  it('jira.transitionIssue returns success stub', async () => {
    const r = await registry.executeTool('harness-1', 'jira.transitionIssue', { issueKey: 'MC-208', transitionName: 'In Review' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.transitionName).toBe('In Review');
  });

  it('jira server has correct serverId and displayName', () => {
    const servers = registry.getServersForHarness('harness-1');
    expect(servers[0].serverId).toBe('jira');
    expect(servers[0].displayName).toBe('Jira Cloud');
  });

  it('jira server lists exactly 6 tools', () => {
    const servers = registry.getServersForHarness('harness-1');
    expect(servers[0].listTools()).toHaveLength(6);
  });

  it('jira read tools: getIssue, searchIssues, getComments, getLinkedIssues', () => {
    const tools = registry.listToolsForHarness('harness-1', 'TRIGGER');
    const names = tools.map(t => t.name);
    expect(names).toContain('jira.getIssue');
    expect(names).toContain('jira.searchIssues');
    expect(names).toContain('jira.getComments');
    expect(names).toContain('jira.getLinkedIssues');
  });

  it('jira write tools: addComment, transitionIssue', () => {
    const tools = registry.listToolsForHarness('harness-1', 'EXECUTE');
    const writeTools = tools.filter(t => t.permission === 'write');
    const names = writeTools.map(t => t.name);
    expect(names).toContain('jira.addComment');
    expect(names).toContain('jira.transitionIssue');
  });

  it('jira.searchIssues with no issueKey falls back to UNKNOWN', async () => {
    const r = await registry.executeTool('harness-1', 'jira.searchIssues', { jql: 'status=Open' }, 'EXECUTE') as { issues: unknown[] };
    expect(r.issues).toBeDefined();
    expect(jiraMock.fetchIssue).toHaveBeenCalled();
  });
});

// ============================================================
// GitHub MCP Server — individual tool execution
// ============================================================
describe('GitHub MCP Server — individual tool execution', () => {
  let registry: MCPRegistryService;
  let ghMocks: ReturnType<typeof makeMockGitHubConnectors>;

  beforeEach(() => {
    registry = new MCPRegistryService();
    ghMocks = makeMockGitHubConnectors();
    const githubServer = new GitHubMCPServer(ghMocks.acquire as never, ghMocks.execute as never, ghMocks.ship as never);
    registry.registerServer('harness-1', githubServer);
  });

  it('github.getRepo returns metadata', async () => {
    const r = await registry.executeTool('harness-1', 'github.getRepo', { owner: 'org', repo: 'r' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.defaultBranch).toBe('main');
    expect(r.language).toBe('TypeScript');
  });

  it('github.getFileTree returns fileTree array', async () => {
    const r = await registry.executeTool('harness-1', 'github.getFileTree', { owner: 'org', repo: 'r' }, 'EXECUTE') as { fileTree: string[] };
    expect(r.fileTree).toContain('src/index.ts');
    expect(r.fileTree).toHaveLength(3);
  });

  it('github.getContent returns packageManifests', async () => {
    const r = await registry.executeTool('harness-1', 'github.getContent', { owner: 'org', repo: 'r', path: 'package.json' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.packageManifests).toBeDefined();
  });

  it('github.searchCode returns stub results', async () => {
    const r = await registry.executeTool('harness-1', 'github.searchCode', { owner: 'org', repo: 'r', query: 'auth' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.results).toEqual([]);
    expect(r.query).toBe('auth');
  });

  it('github.cloneRepo creates workspace', async () => {
    const r = await registry.executeTool('harness-1', 'github.cloneRepo', { repoUrl: 'https://github.com/org/repo', planId: 'p1' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.workspacePath).toBe('/tmp/finch-ws-abc123');
    expect(r.branch).toBe('finch/fix-mc-208');
  });

  it('github.applyEdit writes file', async () => {
    const r = await registry.executeTool('harness-1', 'github.applyEdit', { workspacePath: '/tmp/ws', filePath: 'f.ts', content: 'code' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.filePath).toBe('f.ts');
  });

  it('github.runCommand returns exit code', async () => {
    const r = await registry.executeTool('harness-1', 'github.runCommand', { workspacePath: '/tmp/ws', command: 'npm test', conditionId: 'c1', runId: 'r1' }, 'EXECUTE') as Record<string, unknown>;
    expect(r).toHaveProperty('exitCode', 0);
    expect(r).toHaveProperty('stdout', 'All tests passed');
  });

  it('github.createBranch returns stub success', async () => {
    const r = await registry.executeTool('harness-1', 'github.createBranch', { workspacePath: '/tmp/ws', branchName: 'fix-1' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.branchName).toBe('fix-1');
  });

  it('github.commitAndPush calls shipConnector', async () => {
    const r = await registry.executeTool('harness-1', 'github.commitAndPush', { repoUrl: 'url', workspacePath: '/tmp/ws', branch: 'b' }, 'SHIP') as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(ghMocks.ship.pushBranch).toHaveBeenCalledWith('url', '/tmp/ws', 'b');
  });

  it('github.createPR returns PR number and URL', async () => {
    const r = await registry.executeTool('harness-1', 'github.createPR', { owner: 'o', repo: 'r', title: 'T', body: 'B', head: 'h', runId: 'run1' }, 'SHIP') as Record<string, unknown>;
    expect(r).toHaveProperty('number', 42);
    expect(r).toHaveProperty('url', 'https://github.com/org/repo/pull/42');
  });

  it('github server has correct serverId and displayName', () => {
    const servers = registry.getServersForHarness('harness-1');
    expect(servers[0].serverId).toBe('github');
    expect(servers[0].displayName).toBe('GitHub');
  });

  it('github server lists exactly 11 tools', () => {
    const servers = registry.getServersForHarness('harness-1');
    expect(servers[0].listTools()).toHaveLength(11);
  });

  it('github has 4 read tools and 7 write tools', () => {
    const tools = registry.listToolsForHarness('harness-1', 'EXECUTE');
    const readTools = tools.filter(t => t.permission === 'read');
    const writeTools = tools.filter(t => t.permission === 'write');
    expect(readTools).toHaveLength(4);
    expect(writeTools).toHaveLength(7);
  });
});

// ============================================================
// Slack MCP Server — individual tool execution
// ============================================================
describe('Slack MCP Server — individual tool execution', () => {
  let registry: MCPRegistryService;
  let slackMock: ReturnType<typeof makeMockSlackConnector>;

  beforeEach(() => {
    registry = new MCPRegistryService();
    slackMock = makeMockSlackConnector();
    const slackServer = new SlackMCPServer(slackMock as never);
    registry.registerServer('harness-1', slackServer);
  });

  it('slack.getChannelHistory returns stub', async () => {
    const r = await registry.executeTool('harness-1', 'slack.getChannelHistory', { channel: 'C1' }, 'EXECUTE') as Record<string, unknown>;
    expect(r).toHaveProperty('messages');
    expect(r).toHaveProperty('channel', 'C1');
  });

  it('slack.postMessage sends message via connector', async () => {
    const r = await registry.executeTool('harness-1', 'slack.postMessage', { channel: 'C1', text: 'hello' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(slackMock.sendMessage).toHaveBeenCalledWith({ channelId: 'C1', threadTs: '', message: 'hello' });
  });

  it('slack.postMessage with threadTs sends threaded reply', async () => {
    const r = await registry.executeTool('harness-1', 'slack.postMessage', { channel: 'C1', text: 'reply', threadTs: '123.456' }, 'EXECUTE') as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(slackMock.sendMessage).toHaveBeenCalledWith({ channelId: 'C1', threadTs: '123.456', message: 'reply' });
  });

  it('slack server has correct serverId and displayName', () => {
    const servers = registry.getServersForHarness('harness-1');
    expect(servers[0].serverId).toBe('slack');
    expect(servers[0].displayName).toBe('Slack');
  });

  it('slack server lists exactly 2 tools', () => {
    const servers = registry.getServersForHarness('harness-1');
    expect(servers[0].listTools()).toHaveLength(2);
  });

  it('slack has 1 read and 1 write tool', () => {
    const tools = registry.listToolsForHarness('harness-1', 'EXECUTE');
    expect(tools.filter(t => t.permission === 'read')).toHaveLength(1);
    expect(tools.filter(t => t.permission === 'write')).toHaveLength(1);
  });
});

// ============================================================
// MCPRegistryService — error handling
// ============================================================
describe('MCPRegistryService — error handling', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
    const jiraServer = new JiraMCPServer(makeMockJiraConnector() as never);
    registry.registerServer('harness-1', jiraServer);
  });

  it('executeTool throws for unknown server prefix', async () => {
    await expect(registry.executeTool('harness-1', 'unknown.tool', {}, 'EXECUTE')).rejects.toThrow('No MCP server found for tool: unknown.tool');
  });

  it('executeTool throws for unknown tool on known server', async () => {
    await expect(registry.executeTool('harness-1', 'jira.nonExistent', {}, 'EXECUTE')).rejects.toThrow('Unknown MCP tool: jira.nonExistent');
  });

  it('executeTool throws for empty harness', async () => {
    await expect(registry.executeTool('no-servers', 'jira.getIssue', { issueKey: 'X' }, 'EXECUTE')).rejects.toThrow('No MCP server found');
  });

  it('getToolPermission returns undefined for unknown tool', () => {
    expect(registry.getToolPermission('harness-1', 'jira.nope')).toBeUndefined();
  });

  it('getToolPermission returns undefined for unknown server', () => {
    expect(registry.getToolPermission('harness-1', 'unknown.tool')).toBeUndefined();
  });

  it('getToolPermission returns undefined for unknown harness', () => {
    expect(registry.getToolPermission('nope', 'jira.getIssue')).toBeUndefined();
  });

  it('listToolsForHarness returns empty array for unknown harness', () => {
    expect(registry.listToolsForHarness('nope', 'EXECUTE')).toHaveLength(0);
  });

  it('getServersForHarness returns empty array for unknown harness', () => {
    expect(registry.getServersForHarness('nope')).toHaveLength(0);
  });
});

// ============================================================
// Server error handling — unknown tool names
// ============================================================
describe('Server error handling — unknown tool names', () => {
  it('JiraMCPServer throws for unknown tool', async () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    await expect(server.executeTool('jira.nope', {})).rejects.toThrow('Unknown Jira MCP tool: jira.nope');
  });

  it('GitHubMCPServer throws for unknown tool', async () => {
    const gh = makeMockGitHubConnectors();
    const server = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    await expect(server.executeTool('github.nope', {})).rejects.toThrow('Unknown GitHub MCP tool: github.nope');
  });

  it('SlackMCPServer throws for unknown tool', async () => {
    const server = new SlackMCPServer(makeMockSlackConnector() as never);
    await expect(server.executeTool('slack.nope', {})).rejects.toThrow('Unknown Slack MCP tool: slack.nope');
  });
});

// ============================================================
// Health checks
// ============================================================
describe('MCP Server health checks', () => {
  it('JiraMCPServer healthCheck returns ok:true when connector works', async () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    const h = await server.healthCheck();
    expect(h.ok).toBe(true);
  });

  it('JiraMCPServer healthCheck returns ok:false for "not initialized"', async () => {
    const mock = { fetchIssue: vi.fn().mockRejectedValue(new Error('not initialized')) };
    const server = new JiraMCPServer(mock as never);
    const h = await server.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.error).toContain('not initialized');
  });

  it('JiraMCPServer healthCheck returns ok:true for non-init errors', async () => {
    const mock = { fetchIssue: vi.fn().mockRejectedValue(new Error('network timeout')) };
    const server = new JiraMCPServer(mock as never);
    const h = await server.healthCheck();
    expect(h.ok).toBe(true);
  });

  it('GitHubMCPServer healthCheck returns ok:true when connector works', async () => {
    const gh = makeMockGitHubConnectors();
    const server = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const h = await server.healthCheck();
    expect(h.ok).toBe(true);
  });

  it('GitHubMCPServer healthCheck returns ok:false for "not initialized"', async () => {
    const gh = makeMockGitHubConnectors();
    gh.acquire.acquire = vi.fn().mockRejectedValue(new Error('not initialized'));
    const server = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const h = await server.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.error).toContain('not initialized');
  });

  it('GitHubMCPServer healthCheck returns ok:true for network errors', async () => {
    const gh = makeMockGitHubConnectors();
    gh.acquire.acquire = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const server = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const h = await server.healthCheck();
    expect(h.ok).toBe(true);
  });

  it('SlackMCPServer healthCheck returns ok:true when initialized', async () => {
    const server = new SlackMCPServer(makeMockSlackConnector() as never);
    const h = await server.healthCheck();
    expect(h.ok).toBe(true);
  });

  it('SlackMCPServer healthCheck returns ok:false when not initialized', async () => {
    const mock = { sendMessage: vi.fn(), isInitialized: vi.fn().mockReturnValue(false) };
    const server = new SlackMCPServer(mock as never);
    const h = await server.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.error).toContain('not initialized');
  });
});

// ============================================================
// FC-04 enforcement matrix — all write tools × read-only phases
// ============================================================
describe('FC-04 enforcement matrix — all write tools in read-only phases', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
    const jiraServer = new JiraMCPServer(makeMockJiraConnector() as never);
    const gh = makeMockGitHubConnectors();
    const githubServer = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const slackServer = new SlackMCPServer(makeMockSlackConnector() as never);
    registry.registerServer('harness-1', jiraServer);
    registry.registerServer('harness-1', githubServer);
    registry.registerServer('harness-1', slackServer);
  });

  const writeTools = [
    { name: 'jira.addComment', input: { issueKey: 'X', body: 'y' } },
    { name: 'jira.transitionIssue', input: { issueKey: 'X', transitionName: 'Done' } },
    { name: 'github.cloneRepo', input: { repoUrl: 'u', planId: 'p' } },
    { name: 'github.applyEdit', input: { workspacePath: 'w', filePath: 'f', content: 'c' } },
    { name: 'github.runCommand', input: { workspacePath: 'w', command: 'c', conditionId: 'c', runId: 'r' } },
    { name: 'github.createBranch', input: { workspacePath: 'w', branchName: 'b' } },
    { name: 'github.commitAndPush', input: { repoUrl: 'u', workspacePath: 'w', branch: 'b' } },
    { name: 'github.createPR', input: { owner: 'o', repo: 'r', title: 't', body: 'b', head: 'h', runId: 'run' } },
    { name: 'github.cleanupWorkspace', input: { workspacePath: '/tmp/nonexistent-safe' } },
    { name: 'slack.postMessage', input: { channel: 'C1', text: 'hi' } },
  ];

  const readOnlyPhases: Phase[] = ['TRIGGER', 'ACQUIRE', 'PLAN'];

  for (const tool of writeTools) {
    for (const phase of readOnlyPhases) {
      it(`${tool.name} rejected in ${phase}`, async () => {
        await expect(registry.executeTool('harness-1', tool.name, tool.input, phase)).rejects.toThrow('FC-04 violation');
      });
    }
  }

  // Write tools succeed in EXECUTE and SHIP
  for (const tool of writeTools.slice(0, 2)) {
    for (const phase of ['EXECUTE', 'SHIP'] as Phase[]) {
      it(`${tool.name} succeeds in ${phase}`, async () => {
        const r = await registry.executeTool('harness-1', tool.name, tool.input, phase);
        expect(r).toBeDefined();
      });
    }
  }
});

// ============================================================
// FC-04 — read tools pass in every phase
// ============================================================
describe('FC-04 — read tools available in every phase', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
    const jiraServer = new JiraMCPServer(makeMockJiraConnector() as never);
    const gh = makeMockGitHubConnectors();
    const githubServer = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const slackServer = new SlackMCPServer(makeMockSlackConnector() as never);
    registry.registerServer('harness-1', jiraServer);
    registry.registerServer('harness-1', githubServer);
    registry.registerServer('harness-1', slackServer);
  });

  const readTools = [
    { name: 'jira.getIssue', input: { issueKey: 'MC-208' } },
    { name: 'jira.searchIssues', input: { jql: 'x', issueKey: 'MC-208' } },
    { name: 'jira.getComments', input: { issueKey: 'MC-208' } },
    { name: 'jira.getLinkedIssues', input: { issueKey: 'MC-208' } },
    { name: 'github.getRepo', input: { owner: 'o', repo: 'r' } },
    { name: 'github.getFileTree', input: { owner: 'o', repo: 'r' } },
    { name: 'github.getContent', input: { owner: 'o', repo: 'r', path: 'f' } },
    { name: 'github.searchCode', input: { owner: 'o', repo: 'r', query: 'q' } },
    { name: 'slack.getChannelHistory', input: { channel: 'C1' } },
  ];

  const allPhases: Phase[] = ['TRIGGER', 'ACQUIRE', 'PLAN', 'EXECUTE', 'SHIP'];

  for (const tool of readTools) {
    for (const phase of allPhases) {
      it(`${tool.name} succeeds in ${phase}`, async () => {
        const r = await registry.executeTool('harness-1', tool.name, tool.input, phase);
        expect(r).toBeDefined();
      });
    }
  }
});

// ============================================================
// Multi-harness isolation
// ============================================================
describe('Multi-harness isolation', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
    registry.registerServer('h1', new JiraMCPServer(makeMockJiraConnector() as never));
    const gh = makeMockGitHubConnectors();
    registry.registerServer('h2', new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never));
  });

  it('h1 only sees jira tools', () => {
    const tools = registry.listToolsForHarness('h1', 'EXECUTE');
    expect(tools.every(t => t.name.startsWith('jira.'))).toBe(true);
    expect(tools).toHaveLength(6);
  });

  it('h2 only sees github tools', () => {
    const tools = registry.listToolsForHarness('h2', 'EXECUTE');
    expect(tools.every(t => t.name.startsWith('github.'))).toBe(true);
    expect(tools).toHaveLength(11);
  });

  it('h1 cannot execute github tools', async () => {
    await expect(registry.executeTool('h1', 'github.getRepo', { owner: 'o', repo: 'r' }, 'EXECUTE')).rejects.toThrow('No MCP server found');
  });

  it('h2 cannot execute jira tools', async () => {
    await expect(registry.executeTool('h2', 'jira.getIssue', { issueKey: 'X' }, 'EXECUTE')).rejects.toThrow('No MCP server found');
  });

  it('registering same server type to both harnesses keeps them independent', () => {
    registry.registerServer('h1', new SlackMCPServer(makeMockSlackConnector() as never));
    registry.registerServer('h2', new SlackMCPServer(makeMockSlackConnector() as never));
    expect(registry.listToolsForHarness('h1', 'EXECUTE')).toHaveLength(8); // 6 jira + 2 slack
    expect(registry.listToolsForHarness('h2', 'EXECUTE')).toHaveLength(13); // 11 github + 2 slack
  });
});

// ============================================================
// Server lifecycle — register, re-register, unregister
// ============================================================
describe('Server lifecycle — register, re-register, unregister', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
  });

  it('register adds server tools', () => {
    expect(registry.listToolsForHarness('h1', 'EXECUTE')).toHaveLength(0);
    registry.registerServer('h1', new JiraMCPServer(makeMockJiraConnector() as never));
    expect(registry.listToolsForHarness('h1', 'EXECUTE')).toHaveLength(6);
  });

  it('unregister removes server tools', () => {
    registry.registerServer('h1', new JiraMCPServer(makeMockJiraConnector() as never));
    registry.unregisterServer('h1', 'jira');
    expect(registry.listToolsForHarness('h1', 'EXECUTE')).toHaveLength(0);
  });

  it('re-register replaces the server (no duplicates)', () => {
    registry.registerServer('h1', new JiraMCPServer(makeMockJiraConnector() as never));
    registry.registerServer('h1', new JiraMCPServer(makeMockJiraConnector() as never));
    expect(registry.listToolsForHarness('h1', 'EXECUTE')).toHaveLength(6);
    expect(registry.getServersForHarness('h1')).toHaveLength(1);
  });

  it('unregister non-existent server is safe', () => {
    registry.unregisterServer('h1', 'nonexistent');
    expect(registry.listToolsForHarness('h1', 'EXECUTE')).toHaveLength(0);
  });

  it('multiple servers can be registered to same harness', () => {
    registry.registerServer('h1', new JiraMCPServer(makeMockJiraConnector() as never));
    const gh = makeMockGitHubConnectors();
    registry.registerServer('h1', new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never));
    registry.registerServer('h1', new SlackMCPServer(makeMockSlackConnector() as never));
    expect(registry.getServersForHarness('h1')).toHaveLength(3);
    expect(registry.listToolsForHarness('h1', 'EXECUTE')).toHaveLength(19);
  });

  it('unregister one server leaves others intact', () => {
    registry.registerServer('h1', new JiraMCPServer(makeMockJiraConnector() as never));
    const gh = makeMockGitHubConnectors();
    registry.registerServer('h1', new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never));
    registry.unregisterServer('h1', 'jira');
    expect(registry.getServersForHarness('h1')).toHaveLength(1);
    expect(registry.listToolsForHarness('h1', 'EXECUTE')).toHaveLength(11);
  });
});

// ============================================================
// Tool schema validation
// ============================================================
describe('Tool schema validation', () => {
  it('all tools have required inputSchema fields', () => {
    const jira = new JiraMCPServer(makeMockJiraConnector() as never);
    const gh = makeMockGitHubConnectors();
    const github = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const slack = new SlackMCPServer(makeMockSlackConnector() as never);
    const allTools = [...jira.listTools(), ...github.listTools(), ...slack.listTools()];

    for (const tool of allTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
      expect(tool.inputSchema.required).toBeDefined();
      expect(tool.permission).toMatch(/^(read|write)$/);
    }
  });

  it('all tool names follow server.action pattern', () => {
    const jira = new JiraMCPServer(makeMockJiraConnector() as never);
    const gh = makeMockGitHubConnectors();
    const github = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const slack = new SlackMCPServer(makeMockSlackConnector() as never);
    const allTools = [...jira.listTools(), ...github.listTools(), ...slack.listTools()];

    for (const tool of allTools) {
      expect(tool.name).toMatch(/^(jira|github|slack)\.\w+$/);
    }
  });

  it('no duplicate tool names across all servers', () => {
    const jira = new JiraMCPServer(makeMockJiraConnector() as never);
    const gh = makeMockGitHubConnectors();
    const github = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const slack = new SlackMCPServer(makeMockSlackConnector() as never);
    const allTools = [...jira.listTools(), ...github.listTools(), ...slack.listTools()];
    const names = allTools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('total tool count is 19 (6 jira + 11 github + 2 slack)', () => {
    const jira = new JiraMCPServer(makeMockJiraConnector() as never);
    const gh = makeMockGitHubConnectors();
    const github = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const slack = new SlackMCPServer(makeMockSlackConnector() as never);
    const total = jira.listTools().length + github.listTools().length + slack.listTools().length;
    expect(total).toBe(19);
  });
});

// ============================================================
// Concurrent tool execution
// ============================================================
describe('Concurrent tool execution', () => {
  let registry: MCPRegistryService;

  beforeEach(() => {
    registry = new MCPRegistryService();
    const jiraServer = new JiraMCPServer(makeMockJiraConnector() as never);
    const gh = makeMockGitHubConnectors();
    const githubServer = new GitHubMCPServer(gh.acquire as never, gh.execute as never, gh.ship as never);
    const slackServer = new SlackMCPServer(makeMockSlackConnector() as never);
    registry.registerServer('harness-1', jiraServer);
    registry.registerServer('harness-1', githubServer);
    registry.registerServer('harness-1', slackServer);
  });

  it('parallel read tool calls across servers', async () => {
    const [jiraR, ghR, slackR] = await Promise.all([
      registry.executeTool('harness-1', 'jira.getIssue', { issueKey: 'MC-208' }, 'ACQUIRE'),
      registry.executeTool('harness-1', 'github.getRepo', { owner: 'o', repo: 'r' }, 'ACQUIRE'),
      registry.executeTool('harness-1', 'slack.getChannelHistory', { channel: 'C1' }, 'ACQUIRE'),
    ]);
    expect(jiraR).toHaveProperty('key', 'MC-208');
    expect(ghR).toHaveProperty('defaultBranch', 'main');
    expect(slackR).toHaveProperty('messages');
  });

  it('parallel write tool calls in EXECUTE phase', async () => {
    const [addComment, cloneRepo] = await Promise.all([
      registry.executeTool('harness-1', 'jira.addComment', { issueKey: 'MC-208', body: 'x' }, 'EXECUTE'),
      registry.executeTool('harness-1', 'github.cloneRepo', { repoUrl: 'u', planId: 'p' }, 'EXECUTE'),
    ]);
    expect(addComment).toHaveProperty('success', true);
    expect(cloneRepo).toHaveProperty('workspacePath');
  });

  it('mixed read+write parallel in EXECUTE phase', async () => {
    const results = await Promise.all([
      registry.executeTool('harness-1', 'jira.getIssue', { issueKey: 'MC-208' }, 'EXECUTE'),
      registry.executeTool('harness-1', 'jira.addComment', { issueKey: 'MC-208', body: 'x' }, 'EXECUTE'),
      registry.executeTool('harness-1', 'github.getRepo', { owner: 'o', repo: 'r' }, 'EXECUTE'),
      registry.executeTool('harness-1', 'github.cloneRepo', { repoUrl: 'u', planId: 'p' }, 'EXECUTE'),
    ]);
    expect(results).toHaveLength(4);
    results.forEach(r => expect(r).toBeDefined());
  });
});
