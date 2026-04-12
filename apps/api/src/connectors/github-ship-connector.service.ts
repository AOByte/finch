import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { ConnectorRegistryService } from './connector-registry.service';
import { CredentialEncryptionService } from './credential-encryption.service';

export interface PullRequestParams {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  runId: string;
}

export interface PullRequestResult {
  number: number;
  url: string;
  htmlUrl: string;
}

@Injectable()
export class GitHubShipConnectorService implements OnModuleInit {
  private readonly logger = new Logger(GitHubShipConnectorService.name);
  private octokit: Octokit | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ConnectorRegistryService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  onModuleInit(): void {
    this.registry.register('github-ship', 'ship', this as never);

    const token = this.config.get<string>('GITHUB_TOKEN');
    if (token) {
      this.octokit = new Octokit({ auth: token });
      this.logger.log('GitHub Ship connector initialized');
    } else {
      this.logger.warn('GITHUB_TOKEN not configured — GitHub Ship connector disabled');
    }
  }

  async openPullRequest(params: PullRequestParams): Promise<PullRequestResult> {
    if (!this.octokit) {
      throw new Error('GitHub client not initialized — missing GITHUB_TOKEN');
    }

    const { data } = await this.octokit.pulls.create({
      owner: params.owner,
      repo: params.repo,
      head: params.head,
      base: params.base,
      title: params.title,
      body: this.buildPRBody(params),
    });

    this.logger.log(`PR #${data.number} created: ${data.html_url}`);

    return {
      number: data.number,
      url: data.url,
      htmlUrl: data.html_url,
    };
  }

  async pushBranch(repoUrl: string, workspacePath: string, branch: string): Promise<void> {
    const token = this.config.get<string>('GITHUB_TOKEN');
    const simpleGit = (await import('simple-git')).default;
    const git = simpleGit(workspacePath);

    if (token) {
      const authUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);
      await git.addRemote('auth-origin', authUrl).catch(() => {
        // remote may already exist
      });
      await git.push('auth-origin', branch);
    } else {
      await git.push('origin', branch);
    }
  }

  private buildPRBody(params: PullRequestParams): string {
    return [
      `## Finch Automated PR`,
      '',
      `**Run ID:** \`${params.runId}\``,
      '',
      params.body,
      '',
      '---',
      '*This PR was created automatically by [Finch](https://github.com/AOByte/finch).*',
    ].join('\n');
  }
}
