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
