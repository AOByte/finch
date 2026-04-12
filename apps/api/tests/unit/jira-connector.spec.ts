import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JiraConnectorService } from '../../src/connectors/jira-connector.service';
import { ConnectorRegistryService } from '../../src/connectors/connector-registry.service';
import { CredentialEncryptionService } from '../../src/connectors/credential-encryption.service';

const mockGetIssue = vi.fn().mockResolvedValue({
  key: 'PROJ-123',
  fields: {
    summary: 'Fix login bug',
    description: 'Users cannot login.\n\nAcceptance Criteria:\n- Login works\n- Error message shown',
    issuetype: { name: 'Bug' },
    priority: { name: 'High' },
    labels: ['frontend', 'auth'],
    components: [{ name: 'Auth' }, { name: 'UI' }],
    sprint: { name: 'Sprint 5' },
    customfield_10014: 'EPIC-1',
    issuelinks: [
      { type: { name: 'Blocks' }, outwardIssue: { key: 'PROJ-124' } },
      { type: { name: 'Related' }, inwardIssue: { key: 'PROJ-100' } },
    ],
    subtasks: [
      { key: 'PROJ-123-1', fields: { summary: 'Fix form validation' } },
    ],
    comment: {
      comments: [
        { author: { displayName: 'Alice' }, body: 'Confirmed', created: '2024-01-01T00:00:00Z' },
      ],
    },
    assignee: { displayName: 'Bob' },
    reporter: { displayName: 'Charlie' },
  },
});

vi.mock('jira.js', () => {
  class MockVersion3Client {
    issues = { getIssue: mockGetIssue };
    constructor(_opts: unknown) {}
  }
  return { Version3Client: MockVersion3Client };
});

function makeService(envOverrides: Record<string, string | undefined> = {}) {
  const config = new ConfigService({
    JIRA_HOST: 'https://test.atlassian.net',
    JIRA_EMAIL: 'test@test.com',
    JIRA_API_TOKEN: 'token123',
    ENCRYPTION_KEY: 'a'.repeat(64),
    ...envOverrides,
  });
  const registry = new ConnectorRegistryService();
  const encryption = new CredentialEncryptionService(new ConfigService({ ENCRYPTION_KEY: 'a'.repeat(64) }));
  return { service: new JiraConnectorService(config, registry, encryption), registry };
}

describe('JiraConnectorService', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('registers in ConnectorRegistryService on init', () => {
    const { service, registry } = makeService();
    service.onModuleInit();
    expect(registry.has('jira')).toBe(true);
  });

  it('initializes client when credentials are provided', () => {
    const { service } = makeService();
    service.onModuleInit();
    expect(service).toBeDefined();
  });

  it('skips initialization when credentials are missing', () => {
    const { service } = makeService({ JIRA_HOST: undefined });
    service.onModuleInit();
    expect(service.fetchIssue('PROJ-1')).rejects.toThrow('Jira client not initialized');
  });

  it('fetches issue with all fields', async () => {
    const { service } = makeService();
    service.onModuleInit();
    const issue = await service.fetchIssue('PROJ-123');

    expect(issue.key).toBe('PROJ-123');
    expect(issue.summary).toBe('Fix login bug');
    expect(issue.description).toContain('Users cannot login');
    expect(issue.acceptanceCriteria).toContain('Login works');
    expect(issue.issueType).toBe('Bug');
    expect(issue.priority).toBe('High');
    expect(issue.labels).toEqual(['frontend', 'auth']);
    expect(issue.components).toEqual(['Auth', 'UI']);
    expect(issue.sprint).toBe('Sprint 5');
    expect(issue.epic).toBe('EPIC-1');
    expect(issue.linkedIssues).toHaveLength(2);
    expect(issue.linkedIssues[0]).toEqual({ key: 'PROJ-124', type: 'Blocks' });
    expect(issue.linkedIssues[1]).toEqual({ key: 'PROJ-100', type: 'Related' });
    expect(issue.subtasks).toEqual([{ key: 'PROJ-123-1', summary: 'Fix form validation' }]);
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0].author).toBe('Alice');
    expect(issue.assignee).toBe('Bob');
    expect(issue.reporter).toBe('Charlie');
  });

  it('throws when fetching without initialized client', async () => {
    const { service } = makeService({ JIRA_HOST: undefined, JIRA_EMAIL: undefined, JIRA_API_TOKEN: undefined });
    service.onModuleInit();
    await expect(service.fetchIssue('PROJ-1')).rejects.toThrow('Jira client not initialized');
  });

  it('handles null description gracefully', async () => {
    mockGetIssue.mockResolvedValueOnce({
      key: 'PROJ-1',
      fields: {
        summary: 'Test',
        description: null,
        issuetype: { name: 'Task' },
        priority: { name: 'Low' },
        labels: [],
        components: [],
        sprint: null,
        customfield_10014: null,
        issuelinks: [],
        subtasks: [],
        comment: null,
        assignee: null,
        reporter: null,
      },
    });

    const { service } = makeService();
    service.onModuleInit();
    const issue = await service.fetchIssue('PROJ-1');
    expect(issue.description).toBeNull();
    expect(issue.acceptanceCriteria).toBeNull();
    expect(issue.sprint).toBeNull();
    expect(issue.epic).toBeNull();
    expect(issue.comments).toEqual([]);
    expect(issue.assignee).toBeNull();
    expect(issue.reporter).toBeNull();
  });

  it('extractSprintName handles object without name', async () => {
    mockGetIssue.mockResolvedValueOnce({
      key: 'PROJ-1',
      fields: {
        summary: 'Test',
        description: null,
        issuetype: { name: 'Task' },
        priority: { name: 'Low' },
        labels: [],
        components: [],
        sprint: { id: 1 }, // no name property
        customfield_10014: null,
        issuelinks: null,
        subtasks: [],
        comment: { comments: [] },
        assignee: null,
        reporter: null,
      },
    });

    const { service } = makeService();
    service.onModuleInit();
    const issue = await service.fetchIssue('PROJ-1');
    expect(issue.sprint).toBeNull();
    expect(issue.linkedIssues).toEqual([]);
  });

  it('extractAcceptanceCriteria returns null when no match', async () => {
    mockGetIssue.mockResolvedValueOnce({
      key: 'PROJ-2',
      fields: {
        summary: 'Test',
        description: 'Just a description with no AC section',
        issuetype: { name: 'Story' },
        priority: { name: 'Medium' },
        labels: [],
        components: [],
        sprint: null,
        customfield_10014: null,
        issuelinks: [],
        subtasks: [],
        comment: { comments: [] },
        assignee: null,
        reporter: null,
      },
    });

    const { service } = makeService();
    service.onModuleInit();
    const issue = await service.fetchIssue('PROJ-2');
    expect(issue.acceptanceCriteria).toBeNull();
  });
});
