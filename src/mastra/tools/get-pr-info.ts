import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import type { Endpoints } from '@octokit/types';
import { getEnvironmentConfig } from '../../lib/env-config.js';
import { secureSystemExec } from '../../lib/secure-exec.js';
import { safeJsonParse } from '../../lib/safe-json.js';

type PullRequestResponse = Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}']['response'];

// Helper function to get repo info
async function getRepoInfo(): Promise<[string, string]> {
  try {
    const result = await secureSystemExec('git', ['remote', 'get-url', 'origin']);

    if (!result.success) {
      throw new Error(`Failed to get git remote URL: ${result.error}`);
    }

    const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(result.stdout);
    if (match) {
      return [match[1], match[2]];
    }
  } catch {
    // Failed to get git remote URL
  }

  throw new Error('Could not determine repository owner and name');
}

const inputSchema = z.object({
  prNumber: z.number().describe('PR number to get information for'),
  includeBaseRepository: z.boolean().default(false).describe('Include base repository information'),
});

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string(),
    base: z.string(),
    head: z.string(),
    state: z.string(),
    author: z.string(),
    repository: z.object({
      owner: z.string(),
      name: z.string(),
    }).optional(),
    headRepository: z.object({
      owner: z.string(),
      name: z.string(),
    }).optional(),
  }).optional(),
  error: z.string().optional(),
  fallback: z.string().optional(),
  status: z.number().optional(),
});

export const getPRInfoTool = createTool({
  id: 'get-pr-info',
  description: 'Get PR information including base/head commits, title, and body',
  inputSchema,
  outputSchema,
  execute: async ({ context: {
    prNumber, 
    includeBaseRepository = false
  } }) => {
    const config = getEnvironmentConfig();

    try {
      // Try using gh CLI first
      const fields = [
        'number',
        'title',
        'body',
        'baseRefName',
        'headRefName',
        'state',
        'author'
      ];

      if (includeBaseRepository) {
        fields.push('headRepository', 'headRepositoryOwner');
      }

      const result = await secureSystemExec('gh', [
        'pr',
        'view',
        prNumber.toString(),
        '--json',
        fields.join(','),
      ]);

      if (result.success) {
        const data = safeJsonParse(result.stdout, {}) as Record<string, any>;
        
        const prInfo = {
          number: typeof data.number === 'number' ? data.number : prNumber,
          title: typeof data.title === 'string' ? data.title : '',
          body: typeof data.body === 'string' ? data.body : '',
          base: typeof data.baseRefName === 'string' ? data.baseRefName : '',
          head: typeof data.headRefName === 'string' ? data.headRefName : '',
          state: typeof data.state === 'string' ? data.state : 'unknown',
          author: data.author?.login || '',
        };

        if (includeBaseRepository) {
          // For base repository, we need to get it from git remote since GitHub CLI doesn't expose it directly
          let baseOwner = '';
          let baseName = '';
          try {
            const [repoOwner, repoName] = await getRepoInfo();
            baseOwner = repoOwner;
            baseName = repoName;
          } catch {
            // Fallback to headRepositoryOwner if we can't get repo info
            baseOwner = data.headRepositoryOwner?.login || '';
            baseName = data.headRepository?.name || '';
          }

          return {
            success: true,
            data: {
              ...prInfo,
              repository: {
                owner: baseOwner,
                name: baseName,
              },
              headRepository: data.headRepository ? {
                owner: data.headRepository.owner?.login || '',
                name: data.headRepository.name || '',
              } : undefined,
            },
          };
        }

        return {
          success: true,
          data: prInfo,
        };
      }

      throw new Error(`gh CLI failed: ${result.error}`);
    } catch (error: any) {
      // Fallback to Octokit if gh CLI fails
      const auth = config.githubToken || process.env.GH_TOKEN;

      if (!auth) {
        return {
          success: false,
          error: `GitHub CLI failed and no GitHub token available: ${error.message}`,
          fallback: 'Please install gh CLI or set GITHUB_TOKEN',
        };
      }

      try {
        const [owner, repo] = await getRepoInfo();
        const octokit = new Octokit({ auth });

        const response: PullRequestResponse = await octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });
        
        const data = response.data;

        const prInfo = {
          number: data.number,
          title: data.title,
          body: data.body || '',
          base: data.base.ref,
          head: data.head.ref,
          state: data.state,
          author: data.user?.login || '',
        };

        if (includeBaseRepository) {
          return {
            success: true,
            data: {
              ...prInfo,
              repository: {
                owner: data.base.repo.owner.login,
                name: data.base.repo.name,
              },
              headRepository: {
                owner: data.head.repo.owner.login,
                name: data.head.repo.name,
              },
            },
          };
        }

        return {
          success: true,
          data: prInfo,
        };
      } catch (octokitError: unknown) {
        const octokitErrorMessage = octokitError instanceof Error ? octokitError.message : String(octokitError);
        console.error('Octokit fallback failed:', octokitErrorMessage);

        const octokitStatus = octokitError && typeof octokitError === 'object' && 'status' in octokitError ? 
          (typeof octokitError.status === 'number' ? octokitError.status : undefined) : undefined;

        const errorMessage = error instanceof Error ? error.message : String(error);

        return {
          success: false,
          error: `Both gh CLI and GitHub API failed: ${errorMessage}, ${octokitErrorMessage}`,
          status: octokitStatus,
        };
      }
    }
  },
});