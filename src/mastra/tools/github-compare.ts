import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import type { Endpoints } from '@octokit/types';
import { getEnvironmentConfig } from '../../lib/env-config.js';

type CompareCommitsResponse = Endpoints['GET /repos/{owner}/{repo}/compare/{basehead}']['response'];

const inputSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  base: z.string().describe('Base commit/branch'),
  head: z.string().describe('Head commit/branch'),
});

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    totalFiles: z.number(),
    isLockfileOnly: z.boolean(),
    lockfileCount: z.number(),
    sourceFileCount: z.number(),
    files: z.array(z.object({
      filename: z.string(),
      status: z.string(),
      additions: z.number(),
      deletions: z.number(),
      changes: z.number(),
      patch: z.string().optional(),
      isLockfile: z.boolean(),
    })),
    commits: z.object({
      ahead: z.number(),
      behind: z.number(),
      total: z.number(),
    }),
  }).optional(),
  error: z.string().optional(),
  status: z.number().optional(),
});

export const githubCompareTool = createTool({
  id: 'github-compare',
  description: 'Compare two commits to check if only lockfile changed and get file differences',
  inputSchema,
  outputSchema,
  execute: async ({ context: { owner, repo, base, head } }) => {
    const config = getEnvironmentConfig();
    const auth = config.githubToken || process.env.GH_TOKEN;

    if (!auth) {
      return {
        success: false,
        error: 'No GitHub authentication available',
      };
    }

    const octokit = new Octokit({ auth });

    try {
      // Compare two commits
      const response: CompareCommitsResponse = await octokit.repos.compareCommits({
        owner,
        repo,
        base,
        head,
      });

      const files = response.data.files || [];

      // Define lockfile patterns
      const lockfilePatterns = [
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'poetry.lock',
        'Pipfile.lock',
        'Cargo.lock',
        'composer.lock',
        'mix.lock',
        'Gemfile.lock',
      ];

      // Check if only lockfiles changed
      const isLockfileOnly = files.length > 0 && files.every(file => 
        lockfilePatterns.some(pattern => file.filename?.endsWith(pattern))
      );

      // Categorize files
      const lockfiles = files.filter(file =>
        lockfilePatterns.some(pattern => file.filename?.endsWith(pattern))
      );

      const sourceFiles = files.filter(file =>
        !lockfilePatterns.some(pattern => file.filename?.endsWith(pattern))
      );

      return {
        success: true,
        data: {
          totalFiles: files.length,
          isLockfileOnly,
          lockfileCount: lockfiles.length,
          sourceFileCount: sourceFiles.length,
          files: files.map(f => ({
            filename: f.filename || '',
            status: f.status || '',
            additions: f.additions || 0,
            deletions: f.deletions || 0,
            changes: f.changes || 0,
            patch: f.patch,
            isLockfile: lockfilePatterns.some(pattern => f.filename?.endsWith(pattern) || false),
          })),
          commits: {
            ahead: response.data.ahead_by,
            behind: response.data.behind_by,
            total: response.data.total_commits,
          },
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('GitHub Compare API failed:', errorMessage);
      
      let status: number | undefined;
      if (error && typeof error === 'object' && 'status' in error) {
        status = typeof error.status === 'number' ? error.status : undefined;
      } else {
        status = undefined;
      }
      
      return {
        success: false,
        error: errorMessage,
        status,
      };
    }
  },
});