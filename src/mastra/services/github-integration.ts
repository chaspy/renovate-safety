/**
 * GitHub Integration Service
 * Handles GitHub API interactions including PR comments and labels
 */

import { 
  getPRInfoTool,
  dependencyReviewTool,
  githubCompareTool,
  prCommentTool,
  prLabelTool
} from '../tools/index.js';
import { trackAgent } from '../tools/execution-tracker.js';

export interface PRInfo {
  number: number;
  title: string;
  base: string;
  head: string;
  repository: {
    owner: string;
    name: string;
  };
}

/**
 * Fetch PR information directly using tools (no Agent wrapper)
 */
export async function fetchPRInfo(prNumber: number): Promise<any> {
  try {
    const result = await getPRInfoTool.execute({
      context: {
        prNumber,
        includeBaseRepository: true
      }
    });
    
    if (!result.success || !result.data) {
      throw new Error(`Failed to get PR info: ${result.error || 'Unknown error'}`);
    }
    
    return result.data;
  } catch (error) {
    throw new Error(`Failed to fetch PR info: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get dependency changes directly using tools (no Agent wrapper)
 */
export async function getDependencyChanges(prInfo: PRInfo): Promise<any> {
  const owner = prInfo.repository?.owner || 'unknown';
  const repo = prInfo.repository?.name || 'unknown';
  
  try {
    const result = await dependencyReviewTool.execute({
      context: {
        owner,
        repo,
        base: prInfo.base,
        head: prInfo.head
      }
    });
    
    if (!result.success || !result.data) {
      throw new Error(`Failed to get dependencies: ${result.error || 'Unknown error'}`);
    }
    
    return result.data;
  } catch (error) {
    throw new Error(`Failed to get dependency changes: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Compare branches directly using tools (no Agent wrapper)
 */
export async function compareBranches(prInfo: PRInfo): Promise<any> {
  const owner = prInfo.repository?.owner || 'unknown';
  const repo = prInfo.repository?.name || 'unknown';
  
  try {
    const result = await githubCompareTool.execute({
      context: {
        owner,
        repo,
        base: prInfo.base,
        head: prInfo.head
      }
    });
    
    if (!result.success || !result.data) {
      throw new Error(`Failed to compare branches: ${result.error || 'Unknown error'}`);
    }
    
    return result.data;
  } catch (error) {
    throw new Error(`Failed to compare branches: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check for existing PR comments
 */
export async function checkExistingComment(prInfo: PRInfo): Promise<{ exists: boolean; commentId?: string }> {
  const owner = prInfo.repository?.owner || 'unknown';
  const repo = prInfo.repository?.name || 'unknown';
  
  try {
    const result = await prCommentTool.execute({
      context: {
        action: 'find',
        owner,
        repo,
        prNumber: prInfo.number
      }
    });
    
    return { exists: !!result.commentId, commentId: result.commentId };
  } catch (error) {
    console.warn('Failed to check existing comment:', error);
    return { exists: false };
  }
}

/**
 * Post or update PR comment
 */
export async function postPRComment(
  prInfo: PRInfo, 
  body: string, 
  mode: 'create' | 'update' = 'create',
  commentId?: string
): Promise<void> {
  const owner = prInfo.repository?.owner || 'unknown';
  const repo = prInfo.repository?.name || 'unknown';
  
  try {
    await prCommentTool.execute({
      context: {
        action: mode,
        owner,
        repo,
        prNumber: prInfo.number,
        body,
        commentId: mode === 'update' ? commentId : undefined
      }
    });
  } catch (error) {
    throw new Error(`Failed to ${mode} PR comment: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Add label to PR
 */
export async function addPRLabel(prInfo: PRInfo, label: string): Promise<void> {
  const owner = prInfo.repository?.owner || 'unknown';
  const repo = prInfo.repository?.name || 'unknown';
  
  try {
    await prLabelTool.execute({
      context: {
        owner,
        repo,
        prNumber: prInfo.number,
        labels: [label]
      }
    });
  } catch (error) {
    throw new Error(`Failed to add PR label: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Handle PR posting with proper mode detection
 */
export async function handlePRPosting(
  prInfo: PRInfo,
  reportBody: string,
  postMode: string,
  riskLevel: string
): Promise<boolean> {
  if (postMode === 'never') {
    return false;
  }

  try {
    // Check for existing comment
    const existingComment = await checkExistingComment(prInfo);
    
    const commentMode = existingComment.exists && postMode === 'update' 
      ? 'update' as const
      : 'create' as const;

    // Post or update comment
    await postPRComment(
      prInfo, 
      reportBody, 
      commentMode, 
      existingComment.commentId
    );

    // Add label based on risk level
    await addPRLabel(prInfo, `renovate-safety:${riskLevel}`);

    return true;
  } catch (error) {
    console.warn('Failed to post to PR:', error);
    return false;
  }
}