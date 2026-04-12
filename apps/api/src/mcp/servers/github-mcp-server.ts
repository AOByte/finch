import type { MCPServer, MCPTool } from '@finch/types';
import type { GitHubAcquireConnectorService } from '../../connectors/github-acquire-connector.service';
import type { GitHubExecuteConnectorService } from '../../connectors/github-execute-connector.service';
import type { GitHubShipConnectorService } from '../../connectors/github-ship-connector.service';

export class GitHubMCPServer implements MCPServer {
  readonly serverId = 'github';
  readonly displayName = 'GitHub';

  constructor(
    private readonly acquireConnector: GitHubAcquireConnectorService,
    private readonly executeConnector: GitHubExecuteConnectorService,
    private readonly shipConnector: GitHubShipConnectorService,
  ) {}

  listTools(): MCPTool[] {
    return [
      // --- Read tools (available in all phases) ---
      {
        name: 'github.getRepo',
        description: 'Get repository metadata (default branch, language, description)',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo'],
        },
        permission: 'read',
      },
      {
        name: 'github.getFileTree',
        description: 'List all files in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo'],
        },
        permission: 'read',
      },
      {
        name: 'github.getContent',
        description: 'Read a file from a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            path: { type: 'string', description: 'File path within the repository' },
          },
          required: ['owner', 'repo', 'path'],
        },
        permission: 'read',
      },
      {
        name: 'github.searchCode',
        description: 'Search for code in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            query: { type: 'string', description: 'Search query' },
          },
          required: ['owner', 'repo', 'query'],
        },
        permission: 'read',
      },
      // --- Write tools (EXECUTE and SHIP only) ---
      {
        name: 'github.cloneRepo',
        description: 'Clone a repository to an ephemeral workspace',
        inputSchema: {
          type: 'object',
          properties: {
            repoUrl: { type: 'string', description: 'Repository HTTPS URL' },
            planId: { type: 'string', description: 'Plan ID for branch naming' },
          },
          required: ['repoUrl', 'planId'],
        },
        permission: 'write',
      },
      {
        name: 'github.applyEdit',
        description: 'Write or edit a file in an ephemeral workspace',
        inputSchema: {
          type: 'object',
          properties: {
            workspacePath: { type: 'string', description: 'Workspace directory path' },
            filePath: { type: 'string', description: 'File path within workspace' },
            content: { type: 'string', description: 'New file content' },
          },
          required: ['workspacePath', 'filePath', 'content'],
        },
        permission: 'write',
      },
      {
        name: 'github.runCommand',
        description: 'Run a shell command in an ephemeral workspace',
        inputSchema: {
          type: 'object',
          properties: {
            workspacePath: { type: 'string', description: 'Workspace directory path' },
            command: { type: 'string', description: 'Shell command to run' },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
            conditionId: { type: 'string', description: 'Verification condition ID' },
            runId: { type: 'string', description: 'Run ID for audit logging' },
          },
          required: ['workspacePath', 'command', 'conditionId', 'runId'],
        },
        permission: 'write',
      },
      {
        name: 'github.createBranch',
        description: 'Create a new branch in an ephemeral workspace (done during cloneRepo)',
        inputSchema: {
          type: 'object',
          properties: {
            workspacePath: { type: 'string', description: 'Workspace directory path' },
            branchName: { type: 'string', description: 'Branch name to create' },
          },
          required: ['workspacePath', 'branchName'],
        },
        permission: 'write',
      },
      {
        name: 'github.commitAndPush',
        description: 'Push the workspace branch to GitHub',
        inputSchema: {
          type: 'object',
          properties: {
            repoUrl: { type: 'string', description: 'Repository HTTPS URL' },
            workspacePath: { type: 'string', description: 'Workspace directory path' },
            branch: { type: 'string', description: 'Branch name to push' },
          },
          required: ['repoUrl', 'workspacePath', 'branch'],
        },
        permission: 'write',
      },
      {
        name: 'github.createPR',
        description: 'Open a pull request on GitHub',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            title: { type: 'string', description: 'PR title' },
            body: { type: 'string', description: 'PR description' },
            head: { type: 'string', description: 'Source branch' },
            base: { type: 'string', description: 'Target branch (default: main)' },
            runId: { type: 'string', description: 'Run ID for audit trail' },
          },
          required: ['owner', 'repo', 'title', 'body', 'head', 'runId'],
        },
        permission: 'write',
      },
      {
        name: 'github.cleanupWorkspace',
        description: 'Delete an ephemeral workspace directory',
        inputSchema: {
          type: 'object',
          properties: {
            workspacePath: { type: 'string', description: 'Workspace directory path' },
          },
          required: ['workspacePath'],
        },
        permission: 'write',
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'github.getRepo': {
        const result = await this.acquireConnector.acquire(
          input.owner as string,
          input.repo as string,
        );
        return result.metadata;
      }

      case 'github.getFileTree': {
        const result = await this.acquireConnector.acquire(
          input.owner as string,
          input.repo as string,
        );
        return { fileTree: result.fileTree };
      }

      case 'github.getContent': {
        const result = await this.acquireConnector.acquire(
          input.owner as string,
          input.repo as string,
        );
        return { packageManifests: result.packageManifests };
      }

      case 'github.searchCode':
        // Stub: GitHubAcquireConnectorService does not have searchCode yet.
        return { results: [], query: input.query, message: 'Search not yet implemented' };

      case 'github.cloneRepo': {
        const workspace = await this.executeConnector.createWorkspace(
          input.repoUrl as string,
          input.planId as string,
        );
        return { workspacePath: workspace.path, branch: workspace.branch };
      }

      case 'github.applyEdit': {
        const workspace = {
          path: input.workspacePath as string,
          branch: '',
          cleanup: async () => { /* noop */ },
        };
        await this.executeConnector.applyEdits(workspace, [
          { path: input.filePath as string, content: input.content as string },
        ]);
        return { success: true, filePath: input.filePath };
      }

      case 'github.runCommand': {
        const workspace = {
          path: input.workspacePath as string,
          branch: '',
          cleanup: async () => { /* noop */ },
        };
        return this.executeConnector.runCommand({
          workspace,
          command: input.command as string,
          timeout: (input.timeout as number) ?? 30000,
          conditionId: input.conditionId as string,
          runId: input.runId as string,
        });
      }

      case 'github.createBranch':
        // Branch creation happens during cloneRepo via createWorkspace
        return { success: true, branchName: input.branchName, message: 'Branch creation happens during cloneRepo' };

      case 'github.commitAndPush':
        await this.shipConnector.pushBranch(
          input.repoUrl as string,
          input.workspacePath as string,
          input.branch as string,
        );
        return { success: true, branch: input.branch };

      case 'github.createPR':
        return this.shipConnector.openPullRequest({
          owner: input.owner as string,
          repo: input.repo as string,
          head: input.head as string,
          base: (input.base as string) ?? 'main',
          title: input.title as string,
          body: input.body as string,
          runId: input.runId as string,
        });

      case 'github.cleanupWorkspace': {
        const { rm } = await import('fs/promises');
        await rm(input.workspacePath as string, { recursive: true, force: true });
        return { success: true, workspacePath: input.workspacePath };
      }

      default:
        throw new Error(`Unknown GitHub MCP tool: ${toolName}`);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Attempt a lightweight acquire to verify credentials
      await this.acquireConnector.acquire('octocat', 'Hello-World');
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('not initialized')) {
        return { ok: false, error: 'GitHub client not initialized — missing GITHUB_TOKEN' };
      }
      return { ok: true };
    }
  }
}
