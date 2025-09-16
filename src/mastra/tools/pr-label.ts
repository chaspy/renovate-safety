import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import type { Endpoints } from '@octokit/types';
import { getEnvironmentConfig } from '../../lib/env-config.js';
import { secureSystemExec } from '../../lib/secure-exec.js';

type ListLabelsResponse = Endpoints['GET /repos/{owner}/{repo}/issues/{issue_number}/labels']['response'];

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
  prNumber: z.number().describe('PR number'),
  labels: z.array(z.string()).describe('Labels to add'),
  removePrefix: z.string().optional().describe('Remove labels with this prefix (e.g., "renovate-safety:")'),
  operation: z.enum(['add', 'replace', 'remove']).default('add').describe('Label operation type'),
});

const outputSchema = z.object({
  success: z.boolean(),
  operation: z.enum(['add', 'replace', 'remove']),
  labelsAdded: z.array(z.string()),
  labelsRemoved: z.array(z.string()),
  currentLabels: z.array(z.string()),
  error: z.string().optional(),
  status: z.number().optional(),
});

// Get current labels on PR
async function getCurrentLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ names: string[]; labels: any[] }> {
  const labelsResponse: ListLabelsResponse = await octokit.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number: prNumber,
  });

  return {
    names: labelsResponse.data.map(label => label.name),
    labels: labelsResponse.data,
  };
}

// Remove labels matching criteria
async function removeLabelsMatchingCriteria(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  currentLabels: any[],
  removePrefix: string | undefined,
  operation: string
): Promise<void> {
  if (!removePrefix && operation !== 'replace') {
    return;
  }

  const toRemove = currentLabels
    .filter(label => removePrefix ? label.name.startsWith(removePrefix) : true)
    .map(label => label.name);

  for (const label of toRemove) {
    if (operation === 'replace' || (removePrefix && label.startsWith(removePrefix))) {
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: prNumber,
        name: label,
      });
    }
  }
}

// Remove specific labels
async function removeSpecificLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  labels: string[]
): Promise<void> {
  for (const label of labels) {
    try {
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: prNumber,
        name: label,
      });
    } catch (error: any) {
      // 404 errors are expected if label doesn't exist
      if (error.status !== 404) {
        throw error;
      }
    }
  }
}

// Add labels to PR
async function addLabelsToPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  labels: string[]
): Promise<void> {
  if (labels.length > 0) {
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels,
    });
  }
}

// Calculate removed labels
function calculateRemovedLabels(
  operation: string,
  labels: string[],
  removePrefix: string | undefined,
  currentLabelNames: string[]
): string[] {
  if (operation === 'remove') {
    return labels;
  }
  if (removePrefix) {
    return currentLabelNames.filter(name => name.startsWith(removePrefix));
  }
  return [];
}

// Extract error status
function extractErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    return typeof error.status === 'number' ? error.status : undefined;
  }
  return undefined;
}

// Create error response
function createErrorResponse(
  operation: 'add' | 'replace' | 'remove',
  error: unknown,
  prNumber: number
): any {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('PR Label operation failed:', errorMessage);

  const status = extractErrorStatus(error);

  if (status === 404) {
    return {
      success: false,
      operation,
      labelsAdded: [],
      labelsRemoved: [],
      currentLabels: [],
      error: `PR #${prNumber} not found or repository not accessible`,
    };
  }

  if (status === 403) {
    return {
      success: false,
      operation,
      labelsAdded: [],
      labelsRemoved: [],
      currentLabels: [],
      error: 'Insufficient permissions to modify labels',
    };
  }

  return {
    success: false,
    operation,
    labelsAdded: [],
    labelsRemoved: [],
    currentLabels: [],
    error: errorMessage,
    status,
  };
}

export const prLabelTool = createTool({
  id: 'pr-label',
  description: 'Add, remove, or update labels on PR',
  inputSchema,
  outputSchema,
  execute: async ({ context: {
    prNumber,
    labels,
    removePrefix,
    operation = 'add'
  } }) => {
    const config = getEnvironmentConfig();
    const auth = config.githubToken || process.env.GH_TOKEN;

    if (!auth) {
      return {
        success: false,
        operation,
        labelsAdded: [],
        labelsRemoved: [],
        currentLabels: [],
        error: 'No GitHub authentication available',
      };
    }

    try {
      const [owner, repo] = await getRepoInfo();
      const octokit = new Octokit({ auth });

      // Get current labels
      const { names: currentLabelNames, labels: currentLabels } = await getCurrentLabels(
        octokit,
        owner,
        repo,
        prNumber
      );

      // Remove labels matching criteria (for replace or prefix removal)
      await removeLabelsMatchingCriteria(
        octokit,
        owner,
        repo,
        prNumber,
        currentLabels,
        removePrefix,
        operation
      );

      let resultLabels: string[];

      // Execute label operation
      if (operation === 'remove') {
        await removeSpecificLabels(octokit, owner, repo, prNumber, labels);
      } else {
        await addLabelsToPR(octokit, owner, repo, prNumber, labels);
      }

      // Get updated labels
      const { names: updatedLabels } = await getCurrentLabels(
        octokit,
        owner,
        repo,
        prNumber
      );
      resultLabels = updatedLabels;

      return {
        success: true,
        operation,
        labelsAdded: operation !== 'remove' ? labels : [],
        labelsRemoved: calculateRemovedLabels(
          operation,
          labels,
          removePrefix,
          currentLabelNames
        ),
        currentLabels: resultLabels,
      };
    } catch (error: unknown) {
      return createErrorResponse(operation, error, prNumber);
    }
  },
});