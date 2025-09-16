import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Endpoints } from '@octokit/types';
import { getEnvironmentConfig } from '../../lib/env-config.js';
import { secureSystemExec } from '../../lib/secure-exec.js';
import {
  fetchPRWithGHCLI,
  fetchPRWithOctokit,
  createErrorResponse,
} from './get-pr-info-helpers.js';

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

    // Try using gh CLI first
    const ghResult = await fetchPRWithGHCLI(prNumber, includeBaseRepository, getRepoInfo);
    if (ghResult.success) {
      return ghResult;
    }

    // Fallback to Octokit if gh CLI fails
    const auth = config.githubToken || process.env.GH_TOKEN;
    if (!auth) {
      return createErrorResponse(ghResult.error, undefined);
    }

    const octokitResult = await fetchPRWithOctokit(prNumber, includeBaseRepository, auth, getRepoInfo);
    if (octokitResult.success) {
      return octokitResult;
    }

    return createErrorResponse(ghResult.error, octokitResult.error, octokitResult.status);
  },
});