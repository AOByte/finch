import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Version3Client } from 'jira.js';
import { ConnectorRegistryService } from './connector-registry.service';
import { CredentialEncryptionService } from './credential-encryption.service';

export interface JiraIssueData {
  key: string;
  summary: string;
  description: string | null;
  acceptanceCriteria: string | null;
  issueType: string;
  priority: string;
  labels: string[];
  components: string[];
  sprint: string | null;
  epic: string | null;
  linkedIssues: { key: string; type: string }[];
  subtasks: { key: string; summary: string }[];
  comments: { author: string; body: string; created: string }[];
  assignee: string | null;
  reporter: string | null;
}

@Injectable()
export class JiraConnectorService implements OnModuleInit {
  private readonly logger = new Logger(JiraConnectorService.name);
  private client: Version3Client | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ConnectorRegistryService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  onModuleInit(): void {
    this.registry.register('jira', 'acquire', this as never);

    const host = this.config.get<string>('JIRA_HOST');
    const email = this.config.get<string>('JIRA_EMAIL');
    const apiToken = this.config.get<string>('JIRA_API_TOKEN');

    if (host && email && apiToken) {
      this.client = new Version3Client({
        host,
        authentication: {
          basic: { email, apiToken },
        },
      });
      this.logger.log('Jira client initialized');
    } else {
      this.logger.warn('Jira credentials not configured — connector disabled');
    }
  }

  async fetchIssue(issueKey: string): Promise<JiraIssueData> {
    if (!this.client) {
      throw new Error('Jira client not initialized — missing credentials');
    }

    const issue = await this.client.issues.getIssue({
      issueIdOrKey: issueKey,
      fields: [
        'summary',
        'description',
        'issuetype',
        'priority',
        'labels',
        'components',
        'sprint',
        'customfield_10014', // epic link
        'issuelinks',
        'subtasks',
        'comment',
        'assignee',
        'reporter',
      ],
    });

    const fields = issue.fields;

    return {
      key: issue.key ?? issueKey,
      summary: (fields.summary as string) ?? '',
      description: (fields.description as unknown as string | null) ?? null,
      acceptanceCriteria: this.extractAcceptanceCriteria(fields.description as unknown as string | null),
      issueType: (fields.issuetype as { name?: string })?.name ?? 'Unknown',
      priority: (fields.priority as { name?: string })?.name ?? 'None',
      labels: (fields.labels as string[]) ?? [],
      components: ((fields.components as { name?: string }[]) ?? []).map(c => c.name ?? ''),
      sprint: this.extractSprintName(fields.sprint),
      epic: (fields.customfield_10014 as string | null) ?? null,
      linkedIssues: this.extractLinkedIssues(fields.issuelinks as unknown[]),
      subtasks: ((fields.subtasks as { key?: string; fields?: { summary?: string } }[]) ?? []).map(s => ({
        key: s.key ?? '',
        summary: s.fields?.summary ?? '',
      })),
      comments: this.extractComments(fields.comment),
      assignee: (fields.assignee as { displayName?: string })?.displayName ?? null,
      reporter: (fields.reporter as { displayName?: string })?.displayName ?? null,
    };
  }

  private extractAcceptanceCriteria(description: string | null): string | null {
    if (!description) return null;
    const match = description.match(/acceptance\s*criteria[:\s]*([\s\S]*?)(?:\n\n|\n#|$)/i);
    return match ? match[1].trim() : null;
  }

  private extractSprintName(sprint: unknown): string | null {
    if (!sprint) return null;
    if (typeof sprint === 'object' && sprint !== null && 'name' in sprint) {
      return (sprint as { name: string }).name;
    }
    return null;
  }

  private extractLinkedIssues(links: unknown[]): { key: string; type: string }[] {
    if (!links) return [];
    return links.map((link: unknown) => {
      const l = link as {
        type?: { name?: string };
        inwardIssue?: { key?: string };
        outwardIssue?: { key?: string };
      };
      return {
        key: l.inwardIssue?.key ?? l.outwardIssue?.key ?? '',
        type: l.type?.name ?? '',
      };
    });
  }

  private extractComments(comment: unknown): { author: string; body: string; created: string }[] {
    if (!comment) return [];
    const c = comment as { comments?: { author?: { displayName?: string }; body?: string; created?: string }[] };
    return (c.comments ?? []).map(cm => ({
      author: cm.author?.displayName ?? '',
      body: cm.body ?? '',
      created: cm.created ?? '',
    }));
  }
}
