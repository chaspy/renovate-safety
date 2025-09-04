import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import type { Endpoints } from '@octokit/types';
import { getEnvironmentConfig } from '../../lib/env-config.js';

type DependencyReviewResponse = Endpoints['GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}']['response'];

const inputSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  base: z.string().describe('Base commit/branch'),
  head: z.string().describe('Head commit/branch'),
});

const outputSchema = z.object({
  success: z.boolean(),
  data: z.array(z.object({
    name: z.string(),
    fromVersion: z.string(),
    toVersion: z.string(),
    type: z.string(),
    changeType: z.string(),
    vulnerabilities: z.array(z.any()),
    manifest: z.string(),
    scope: z.string(),
  })).optional(),
  totalChanges: z.number().optional(),
  error: z.string().optional(),
  fallback: z.string().optional(),
});

export const dependencyReviewTool = createTool({
  id: 'dependency-review',
  description: 'Get dependency changes between base and head commits using GitHub Dependency Review API',
  inputSchema,
  outputSchema,
  execute: async ({ context: { owner, repo, base, head } }) => {
    const config = getEnvironmentConfig();
    const auth = config.githubToken || process.env.GH_TOKEN;

    if (!auth) {
      return {
        success: false,
        error: 'No GitHub authentication available',
        fallback: 'Use package.json diff as fallback',
      };
    }

    const octokit = new Octokit({ auth });

    try {
      // GitHub Dependency Review API
      const response: DependencyReviewResponse = await octokit.request(
        'GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}',
        {
          owner,
          repo,
          basehead: `${base}...${head}`,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );

      // 依存関係の変更を解析  
      const changes = response.data.map((change) => {
        // GitHub API provides different fields based on change_type
        const changeWithVersions = change as any;
        return {
          name: change.name,
          fromVersion: changeWithVersions.version_before || '',
          toVersion: changeWithVersions.version_after || change.version || '',
          type: change.manifest && change.manifest.includes('dev') ? 'devDependencies' : 'dependencies',
          changeType: change.change_type,
          vulnerabilities: change.vulnerabilities || [],
          manifest: change.manifest || '',
          scope: change.scope || 'runtime',
        };
      });

      return {
        success: true,
        data: changes,
        totalChanges: changes.length,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Dependency Review API failed:', errorMessage);

      // Check if it's a 404 - dependency graph may not be available
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        return {
          success: false,
          error: 'Dependency graph not available for this repository',
          fallback: 'Repository may not have dependency graph enabled or is private',
        };
      }

      return {
        success: false,
        error: errorMessage,
        fallback: 'Use package.json diff as fallback',
      };
    }
  },
});