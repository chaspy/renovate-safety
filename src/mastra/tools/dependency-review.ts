import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import type { Endpoints } from '@octokit/types';
import { getEnvironmentConfig } from '../../lib/env-config.js';

// Type for dependency change
type DependencyChange = {
  name: string;
  fromVersion: string;
  toVersion: string;
  type: string;
  changeType: string;
  vulnerabilities: any[];
  manifest: string;
  scope: string;
};

// Extract PR number from direct number format
function extractDirectPrNumber(branchOrPrNumber: string): number | null {
  if (!isNaN(parseInt(branchOrPrNumber)) && !branchOrPrNumber.includes('/')) {
    return parseInt(branchOrPrNumber);
  }
  return null;
}

// Extract PR number from PR-style branch name (e.g., "PR-16")
function extractPrNumberFromBranch(branchOrPrNumber: string): number | null {
  if (branchOrPrNumber.startsWith('PR-') || branchOrPrNumber.includes('PR-')) {
    const prMatch = /PR-(\d+)/.exec(branchOrPrNumber);
    if (prMatch) {
      return parseInt(prMatch[1]);
    }
  }
  return null;
}

// Find PR number by branch name
async function findPrByBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string
): Promise<number> {
  const { data: pulls } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branchName}`,
    state: 'open',
  });

  if (pulls.length === 0) {
    throw new Error(`No open PR found for branch ${branchName}`);
  }

  return pulls[0].number;
}

// Determine PR number using various strategies
async function determinePrNumber(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchOrPrNumber: string
): Promise<number> {
  // Strategy 1: Direct PR number
  const directNumber = extractDirectPrNumber(branchOrPrNumber);
  if (directNumber !== null) {
    return directNumber;
  }

  // Strategy 2: Extract from PR-style branch name
  const prFromBranch = extractPrNumberFromBranch(branchOrPrNumber);
  if (prFromBranch !== null) {
    return prFromBranch;
  }

  // Strategy 3: Find PR by branch name
  return await findPrByBranch(octokit, owner, repo, branchOrPrNumber);
}

// Parse a removed dependency line from patch
function parseRemovedDependency(line: string): { name: string; version: string } | null {
  if (!line.startsWith('-') || !line.includes(':') || !line.includes('"^')) {
    return null;
  }

  const removedMatch = line.match(/-\s*"([^"]+)":\s*"([^"]+)"/);
  if (removedMatch) {
    const [, packageName, fromVersion] = removedMatch;
    return { name: packageName, version: fromVersion };
  }

  return null;
}

// Find matching added dependency line
function findAddedDependency(
  lines: string[],
  startIndex: number,
  packageName: string
): string | null {
  const endIndex = Math.min(startIndex + 5, lines.length);

  for (let j = startIndex + 1; j < endIndex; j++) {
    const nextLine = lines[j];
    if (nextLine.startsWith('+') && nextLine.includes(`"${packageName}"`)) {
      const addedMatch = nextLine.match(/\+\s*"[^"]+":\s*"([^"]+)"/);
      if (addedMatch) {
        return addedMatch[1];
      }
    }
  }

  return null;
}

// Extract dependency changes from patch lines
function extractChangesFromPatch(patch: string): DependencyChange[] {
  const changes: DependencyChange[] = [];
  const lines = patch.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const removedDep = parseRemovedDependency(lines[i]);
    if (!removedDep) continue;

    const toVersion = findAddedDependency(lines, i, removedDep.name);
    if (!toVersion) continue;

    changes.push({
      name: removedDep.name,
      fromVersion: removedDep.version.replace('^', ''),
      toVersion: toVersion.replace('^', ''),
      type: 'dependencies',
      changeType: 'updated',
      vulnerabilities: [],
      manifest: 'package.json',
      scope: 'runtime',
    });
  }

  return changes;
}

/**
 * Extract dependency changes from PR diff as fallback
 */
async function extractDependenciesFromPRDiff(
  owner: string,
  repo: string,
  branchOrPrNumber: string,
  auth: string
): Promise<DependencyChange[]> {
  const octokit = new Octokit({ auth });

  try {
    // Get PR number using various strategies
    const actualPrNumber = await determinePrNumber(octokit, owner, repo, branchOrPrNumber);

    // Get PR files
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: actualPrNumber,
    });

    // Look for package.json changes
    const packageJsonFile = files.find(f => f.filename === 'package.json');

    if (!packageJsonFile?.patch) {
      return [];
    }

    // Extract dependency changes from patch
    return extractChangesFromPatch(packageJsonFile.patch);
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
      const changes = response.data.map((change: any) => {
        // GitHub API provides different fields based on change_type
        return {
          name: change.name,
          fromVersion: change.version_before || '',
          toVersion: change.version_after || change.version || '',
          type: change.manifest?.includes('dev') ? 'devDependencies' : 'dependencies',
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