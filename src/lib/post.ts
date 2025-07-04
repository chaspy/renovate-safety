import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

export async function postToPR(prNumber: number, report: string): Promise<void> {
  // Create a temporary file for the report content
  const tempFile = path.join(tmpdir(), `renovate-safety-report-${Date.now()}.md`);

  try {
    // Write report to temp file to handle large content and special characters
    await fs.writeFile(tempFile, report, 'utf-8');

    // Check if gh CLI is available
    await checkGhCli();

    // Post comment using gh CLI
    await execa('gh', ['pr', 'comment', prNumber.toString(), '--body-file', tempFile]);
  } catch (error) {
    if (error instanceof Error) {
      // Check for specific error cases
      if (error.message.includes('gh: command not found')) {
        throw new Error(
          'GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/'
        );
      }

      if (error.message.includes('not authenticated')) {
        throw new Error('GitHub CLI is not authenticated. Run "gh auth login" first.');
      }

      if (error.message.includes('404')) {
        throw new Error(`PR #${prNumber} not found. Make sure you're in the correct repository.`);
      }

      throw new Error(`Failed to post comment: ${error.message}`);
    }

    throw error;
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function checkGhCli(): Promise<void> {
  try {
    const { stdout } = await execa('gh', ['--version']);

    // Check version (optional, for future compatibility checks)
    const versionMatch = stdout.match(/gh version (\d+\.\d+\.\d+)/);
    if (versionMatch) {
      const [major] = versionMatch[1].split('.').map(Number);
      if (major < 2) {
        console.warn(
          'Warning: gh CLI version is older than 2.0. Some features may not work correctly.'
        );
      }
    }

    // Check authentication status
    await execa('gh', ['auth', 'status']);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('command not found')) {
        throw new Error('GitHub CLI (gh) is not installed');
      }

      if (error.message.includes('not logged') || error.message.includes('not authenticated')) {
        throw new Error('GitHub CLI is not authenticated');
      }
    }

    throw error;
  }
}

export async function checkPRExists(prNumber: number): Promise<boolean> {
  try {
    await execa('gh', ['pr', 'view', prNumber.toString(), '--json', 'number']);
    return true;
  } catch {
    return false;
  }
}

export async function findExistingComment(prNumber: number): Promise<number | null> {
  try {
    // Get all comments for the PR
    const { stdout } = await execa('gh', [
      'api',
      `repos/{owner}/{repo}/issues/${prNumber}/comments`,
      '--jq',
      '.[] | select(.body | contains("Generated by [renovate-safety]")) | .id'
    ]);
    
    if (stdout.trim()) {
      // Return the first matching comment ID
      const commentIds = stdout.trim().split('\n');
      return parseInt(commentIds[0], 10);
    }
    
    return null;
  } catch (error) {
    // If the command fails, assume no comments exist
    return null;
  }
}

export async function updateComment(commentId: number, report: string): Promise<void> {
  // Create a temporary file for the report content
  const tempFile = path.join(tmpdir(), `renovate-safety-update-${Date.now()}.md`);

  try {
    // Write report to temp file
    await fs.writeFile(tempFile, report, 'utf-8');

    // Update comment using gh CLI
    await execa('gh', [
      'api',
      `repos/{owner}/{repo}/issues/comments/${commentId}`,
      '-X', 'PATCH',
      '-F', `body=@${tempFile}`
    ]);
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
