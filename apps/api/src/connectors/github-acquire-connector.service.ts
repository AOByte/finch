import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { ConnectorRegistryService } from './connector-registry.service';
import { CredentialEncryptionService } from './credential-encryption.service';

export interface RepoMetadata {
  owner: string;
  repo: string;
  defaultBranch: string;
  language: string | null;
  description: string | null;
}

export interface FileTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

export interface AcquireResult {
  metadata: RepoMetadata;
  fileTree: FileTreeEntry[];
  packageManifests: Record<string, string>;
}

@Injectable()
export class GitHubAcquireConnectorService implements OnModuleInit {
  private readonly logger = new Logger(GitHubAcquireConnectorService.name);
  private octokit: Octokit | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ConnectorRegistryService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  onModuleInit(): void {
    this.registry.register('github-acquire', 'acquire', this as never);

    const token = this.config.get<string>('GITHUB_TOKEN');
    if (token) {
      this.octokit = new Octokit({ auth: token });
      this.logger.log('GitHub Acquire connector initialized');
    } else {
      this.logger.warn('GITHUB_TOKEN not configured — GitHub Acquire connector disabled');
    }
  }

  async acquire(owner: string, repo: string): Promise<AcquireResult> {
    if (!this.octokit) {
      throw new Error('GitHub client not initialized — missing GITHUB_TOKEN');
    }

    const [metadata, fileTree, packageManifests] = await Promise.all([
      this.fetchMetadata(owner, repo),
      this.fetchFileTree(owner, repo),
      this.fetchPackageManifests(owner, repo),
    ]);

    return { metadata, fileTree, packageManifests };
  }

  private async fetchMetadata(owner: string, repo: string): Promise<RepoMetadata> {
    const { data } = await this.octokit!.repos.get({ owner, repo });
    return {
      owner,
      repo,
      defaultBranch: data.default_branch,
      language: data.language ?? null,
      description: data.description ?? null,
    };
  }

  private async fetchFileTree(owner: string, repo: string): Promise<FileTreeEntry[]> {
    const { data } = await this.octokit!.git.getTree({
      owner,
      repo,
      tree_sha: 'HEAD',
      recursive: 'true',
    });

    return (data.tree ?? []).map(entry => ({
      path: entry.path ?? '',
      type: (entry.type ?? 'blob') as 'blob' | 'tree',
      size: entry.size,
    }));
  }

  private async fetchPackageManifests(owner: string, repo: string): Promise<Record<string, string>> {
    const manifestPaths = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml'];
    const manifests: Record<string, string> = {};

    await Promise.all(
      manifestPaths.map(async (path) => {
        try {
          const { data } = await this.octokit!.repos.getContent({ owner, repo, path });
          if ('content' in data && typeof data.content === 'string') {
            manifests[path] = Buffer.from(data.content, 'base64').toString('utf8');
          }
        } catch {
          // File doesn't exist — skip
        }
      }),
    );

    return manifests;
  }
}
