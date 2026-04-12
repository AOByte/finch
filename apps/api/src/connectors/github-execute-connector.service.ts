import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import simpleGit from 'simple-git';
import { ConnectorRegistryService } from './connector-registry.service';
import { CredentialEncryptionService } from './credential-encryption.service';
import { AuditLoggerService } from '../audit/audit-logger.service';

export interface WorkspaceHandle {
  path: string;
  branch: string;
  cleanup: () => Promise<void>;
}

export interface FileEdit {
  path: string;
  content: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  success: boolean;
}

@Injectable()
export class GitHubExecuteConnectorService implements OnModuleInit {
  private readonly logger = new Logger(GitHubExecuteConnectorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ConnectorRegistryService,
    private readonly encryption: CredentialEncryptionService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  onModuleInit(): void {
    this.registry.register('github-execute', 'execute', this as never);
    this.logger.log('GitHub Execute connector registered');
  }

  async createWorkspace(repoUrl: string, planId: string): Promise<WorkspaceHandle> {
    const workDir = await mkdtemp(join(tmpdir(), 'finch-'));
    const branch = `finch/${planId}`;

    const token = this.config.get<string>('GITHUB_TOKEN');
    const authUrl = token
      ? repoUrl.replace('https://', `https://x-access-token:${token}@`)
      : repoUrl;

    const git = simpleGit();
    await git.clone(authUrl, workDir);

    const localGit = simpleGit(workDir);
    await localGit.checkoutLocalBranch(branch);

    return {
      path: workDir,
      branch,
      cleanup: async () => {
        try {
          await rm(workDir, { recursive: true, force: true });
        } catch (err) {
          this.logger.warn(`Workspace cleanup failed: ${(err as Error).message}`);
        }
      },
    };
  }

  async applyEdits(workspace: WorkspaceHandle, edits: FileEdit[]): Promise<void> {
    for (const edit of edits) {
      const fullPath = join(workspace.path, edit.path);
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, edit.content, 'utf8');
    }

    const git = simpleGit(workspace.path);
    await git.add('.');
    await git.commit('Apply file edits from Finch plan');
  }

  async runCommand(params: {
    workspace: WorkspaceHandle;
    command: string;
    timeout: number;
    conditionId: string;
    runId: string;
  }): Promise<CommandResult> {
    await this.auditLogger.log({
      runId: params.runId,
      phase: 'EXECUTE',
      eventType: 'verification_run',
      actor: { type: 'connector', connectorId: 'github-execute' },
      payload: { conditionId: params.conditionId, command: params.command },
    });

    const result = await this.executeCommand(params.workspace.path, params.command, params.timeout);

    await this.auditLogger.log({
      runId: params.runId,
      phase: 'EXECUTE',
      eventType: 'verification_result',
      actor: { type: 'connector', connectorId: 'github-execute' },
      payload: {
        conditionId: params.conditionId,
        passed: result.success,
        exitCode: result.exitCode,
        output: result.stdout,
      },
    });

    return result;
  }

  private executeCommand(cwd: string, command: string, timeout: number): Promise<CommandResult> {
    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', command], { cwd, timeout });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr, success: code === 0 });
      });
    });
  }
}
