import { describe, it, expect, vi, beforeAll } from 'vitest';
import { MCPServerFactory } from '../../src/mcp/mcp-server.factory';
import type { MCPServerRow } from '../../src/mcp/mcp-server.factory';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});

function makeRow(overrides: Partial<MCPServerRow> = {}): MCPServerRow {
  return {
    mcpServerId: 'srv-1',
    harnessId: 'h1',
    serverType: 'jira',
    displayName: 'My Jira',
    configEncrypted: '',
    isActive: true,
    healthStatus: 'unknown',
    ...overrides,
  };
}

describe('MCPServerFactory', () => {
  const mockEncryption = {
    encrypt: vi.fn().mockReturnValue('encrypted'),
    decrypt: vi.fn().mockReturnValue('{}'),
  };

  const mockJiraConnector = {
    fetchIssue: vi.fn(),
    onModuleInit: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
  };

  const mockGithubAcquire = {
    acquire: vi.fn(),
    onModuleInit: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
  };

  const mockGithubExecute = {
    createWorkspace: vi.fn(),
    applyEdits: vi.fn(),
    runCommand: vi.fn(),
    onModuleInit: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
  };

  const mockGithubShip = {
    pushBranch: vi.fn(),
    openPullRequest: vi.fn(),
    onModuleInit: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
  };

  const mockSlackConnector = {
    sendMessage: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    onModuleInit: vi.fn(),
  };

  function makeFactory(): MCPServerFactory {
    return new MCPServerFactory(
      mockEncryption as never,
      mockJiraConnector as never,
      mockGithubAcquire as never,
      mockGithubExecute as never,
      mockGithubShip as never,
      mockSlackConnector as never,
    );
  }

  it('createFromRow returns JiraMCPServer for serverType=jira', () => {
    const factory = makeFactory();
    const server = factory.createFromRow(makeRow({ serverType: 'jira' }));
    expect(server).not.toBeNull();
    expect(server!.serverId).toBe('jira');
    expect(server!.displayName).toBe('Jira Cloud');
  });

  it('createFromRow returns GitHubMCPServer for serverType=github', () => {
    const factory = makeFactory();
    const server = factory.createFromRow(makeRow({ serverType: 'github' }));
    expect(server).not.toBeNull();
    expect(server!.serverId).toBe('github');
    expect(server!.displayName).toBe('GitHub');
  });

  it('createFromRow returns SlackMCPServer for serverType=slack', () => {
    const factory = makeFactory();
    const server = factory.createFromRow(makeRow({ serverType: 'slack' }));
    expect(server).not.toBeNull();
    expect(server!.serverId).toBe('slack');
    expect(server!.displayName).toBe('Slack');
  });

  it('createFromRow returns null for unknown serverType', () => {
    const factory = makeFactory();
    const server = factory.createFromRow(makeRow({ serverType: 'unknown' }));
    expect(server).toBeNull();
  });

  it('createFromRow returns null when decryption fails', () => {
    const badEncryption = {
      encrypt: vi.fn(),
      decrypt: vi.fn().mockImplementation(() => { throw new Error('decrypt fail'); }),
    };
    const factory = new MCPServerFactory(
      badEncryption as never,
      mockJiraConnector as never,
      mockGithubAcquire as never,
      mockGithubExecute as never,
      mockGithubShip as never,
      mockSlackConnector as never,
    );
    const server = factory.createFromRow(makeRow());
    expect(server).toBeNull();
  });

  it('createFromRow returns null when config is invalid JSON', () => {
    const badEncryption = {
      encrypt: vi.fn(),
      decrypt: vi.fn().mockReturnValue('not-json'),
    };
    const factory = new MCPServerFactory(
      badEncryption as never,
      mockJiraConnector as never,
      mockGithubAcquire as never,
      mockGithubExecute as never,
      mockGithubShip as never,
      mockSlackConnector as never,
    );
    const server = factory.createFromRow(makeRow());
    expect(server).toBeNull();
  });

  it('getSupportedTypes returns jira, github, slack', () => {
    const factory = makeFactory();
    expect(factory.getSupportedTypes()).toEqual(['jira', 'github', 'slack']);
  });
});
