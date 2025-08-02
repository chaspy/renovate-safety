/**
 * Shared GitHub API client instance
 */

import { Octokit } from '@octokit/rest';
import { getEnvironmentConfig } from './env-config.js';

let octokitInstance: Octokit | null = null;

/**
 * Get a singleton instance of the GitHub API client
 * @returns Octokit instance
 */
export function getGitHubClient(): Octokit {
  if (!octokitInstance) {
    const config = getEnvironmentConfig();
    octokitInstance = new Octokit({
      auth: config.githubToken,
      userAgent: 'renovate-safety',
    });
  }
  return octokitInstance;
}

/**
 * Reset the GitHub client instance (useful for testing)
 */
export function resetGitHubClient(): void {
  octokitInstance = null;
}

/**
 * Check if GitHub token is available
 * @returns true if token is set
 */
export function hasGitHubToken(): boolean {
  const config = getEnvironmentConfig();
  return Boolean(config.githubToken);
}
