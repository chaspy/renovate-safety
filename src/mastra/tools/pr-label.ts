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

      // 既存のラベルを取得
      const labelsResponse: ListLabelsResponse = await octokit.issues.listLabelsOnIssue({
        owner,
        repo,
        issue_number: prNumber,
      });

      const currentLabels = labelsResponse.data;
      const currentLabelNames = currentLabels.map(label => label.name);

      // プレフィックス付きラベルを削除
      if (removePrefix || operation === 'replace') {
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

      let resultLabels = [];

      // ラベル操作を実行
      if (operation === 'remove') {
        // ラベルを削除
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
        
        // 残ったラベルを取得
        const remainingResponse: ListLabelsResponse = await octokit.issues.listLabelsOnIssue({
          owner,
          repo,
          issue_number: prNumber,
        });
        resultLabels = remainingResponse.data.map(label => label.name);
      } else {
        // ラベルを追加（add または replace）
        if (labels.length > 0) {
          await octokit.issues.addLabels({
            owner,
            repo,
            issue_number: prNumber,
            labels,
          });
        }

        // 更新後のラベルを取得
        const updatedResponse: ListLabelsResponse = await octokit.issues.listLabelsOnIssue({
          owner,
          repo,
          issue_number: prNumber,
        });
        resultLabels = updatedResponse.data.map(label => label.name);
      }

      return {
        success: true,
        operation,
        labelsAdded: operation !== 'remove' ? labels : [],
        labelsRemoved: operation === 'remove' ? labels : (removePrefix ? currentLabelNames.filter(name => name.startsWith(removePrefix)) : []),
        currentLabels: resultLabels,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('PR Label operation failed:', errorMessage);

      const status = error && typeof error === 'object' && 'status' in error ? 
        (typeof error.status === 'number' ? error.status : undefined) : undefined;

      // Handle specific errors
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
  },
});