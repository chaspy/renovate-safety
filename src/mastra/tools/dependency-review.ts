import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import type { Endpoints } from '@octokit/types';
import { getEnvironmentConfig } from '../../lib/env-config.js';

/**
 * Extract dependency changes from PR diff as fallback
 */
async function extractDependenciesFromPRDiff(
  owner: string,
  repo: string,
  branchOrPrNumber: string,
  auth: string
): Promise<Array<{
  name: string;
  fromVersion: string;
  toVersion: string;
  type: string;
  changeType: string;
  vulnerabilities: any[];
  manifest: string;
  scope: string;
}>> {
  const octokit = new Octokit({ auth });
  
  // Get PR number - try different strategies
  let actualPrNumber: number;
  
  try {
    // Strategy 1: Direct PR number
    if (!isNaN(parseInt(branchOrPrNumber)) && !branchOrPrNumber.includes('/')) {
      actualPrNumber = parseInt(branchOrPrNumber);
    }
    // Strategy 2: Extract from PR-style branch name (e.g., "PR-16")
    else if (branchOrPrNumber.startsWith('PR-') || branchOrPrNumber.includes('PR-')) {
      const prMatch = branchOrPrNumber.match(/PR-(\d+)/);
      if (prMatch) {
        actualPrNumber = parseInt(prMatch[1]);
      } else {
        throw new Error(`Cannot extract PR number from ${branchOrPrNumber}`);
      }
    }
    // Strategy 3: Find PR by branch name
    else {
      const { data: pulls } = await octokit.rest.pulls.list({
        owner,
        repo,
        head: `${owner}:${branchOrPrNumber}`,
        state: 'open',
      });
      
      if (pulls.length === 0) {
        throw new Error(`No open PR found for branch ${branchOrPrNumber}`);
      }
      
      actualPrNumber = pulls[0].number;
    }
    
    // Get PR files
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: actualPrNumber,
    });
    
    const changes: Array<{
      name: string;
      fromVersion: string;
      toVersion: string;
      type: string;
      changeType: string;
      vulnerabilities: any[];
      manifest: string;
      scope: string;
    }> = [];
    
    // Look for package.json changes
    const packageJsonFile = files.find(f => f.filename === 'package.json');
    
    if (packageJsonFile && packageJsonFile.patch) {
      const patch = packageJsonFile.patch;
      
      // Extract dependency changes from patch
      const lines = patch.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for removed dependency lines (-)
        if (line.startsWith('-') && line.includes(':') && line.includes('"^')) {
          const removedMatch = line.match(/-\s*"([^"]+)":\s*"([^"]+)"/);
          if (removedMatch) {
            const [, packageName, fromVersion] = removedMatch;
            
            // Look for corresponding added line (+)
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
              const nextLine = lines[j];
              if (nextLine.startsWith('+') && nextLine.includes(`"${packageName}"`)) {
                const addedMatch = nextLine.match(/\+\s*"[^"]+":\s*"([^"]+)"/);
                if (addedMatch) {
                  const [, toVersion] = addedMatch;
                  
                  changes.push({
                    name: packageName,
                    fromVersion: fromVersion.replace('^', ''),
                    toVersion: toVersion.replace('^', ''),
                    type: 'dependencies',
                    changeType: 'updated',
                    vulnerabilities: [],
                    manifest: 'package.json',
                    scope: 'runtime',
                  });
                  break;
                }
              }
            }
          }
        }
      }
    }
    
    return changes;
  } catch (error) {
    console.error('Error in extractDependenciesFromPRDiff:', error);
    throw error;
  }
}

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

      // Try fallback with PR diff
      try {
        console.log('🔄 Trying fallback: PR diff analysis...');
        const fallbackData = await extractDependenciesFromPRDiff(owner, repo, head, auth);
        
        if (fallbackData.length > 0) {
          return {
            success: true,
            data: fallbackData,
            totalChanges: fallbackData.length,
            fallback: 'Used PR diff analysis as fallback',
          };
        }
      } catch (fallbackError) {
        console.error('Fallback PR diff analysis failed:', fallbackError);
      }

      return {
        success: false,
        error: errorMessage,
        fallback: 'Use package.json diff as fallback',
      };
    }
  },
});