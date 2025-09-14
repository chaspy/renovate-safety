import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import { getGitHubClient } from '../../lib/github-client.js';
import { normalizeVersion, isVersionInRange, compareVersions } from '../../lib/version-utils.js';

// Zod schemas
const releaseSchema = z.object({
  version: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  prerelease: z.boolean(),
  draft: z.boolean(),
});

const inputSchema = z.object({
  repoUrl: z.string().describe('GitHub repository URL'),
  fromVersion: z.string().describe('Starting version'),
  toVersion: z.string().describe('Ending version'),
});

const outputSchema = z.object({
  success: z.boolean(),
  releases: z.array(releaseSchema).optional(),
  totalCount: z.number().optional(),
  error: z.string().optional(),
});

export const githubReleasesFetcher = createTool({
  id: 'githubReleases',
  description: 'Fetch release notes from GitHub between two versions',
  inputSchema,
  outputSchema,
  
  execute: async ({ context: { repoUrl, fromVersion, toVersion } }) => {
    try {
      // Extract owner and repo from URL
      const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!match) {
        return {
          success: false,
          error: `Invalid GitHub URL format: ${repoUrl}`,
        };
      }

      const [, owner, repo] = match;
      const cleanRepo = repo.replace(/\.git$/, ''); // Remove .git suffix if present
      const octokit = getGitHubClient();

      // Normalize versions
      const fromVersionNorm = normalizeVersion(fromVersion);
      const toVersionNorm = normalizeVersion(toVersion);

      // Fetch releases
      const releases = await fetchReleasesBetweenVersions(
        octokit,
        owner,
        cleanRepo,
        fromVersionNorm,
        toVersionNorm
      );

      if (releases.length === 0) {
        return {
          success: true,
          releases: [],
          totalCount: 0,
        };
      }

      // Map to our output schema
      const formattedReleases = releases.map(release => ({
        version: release.tag_name || 'unknown',
        name: release.name,
        body: release.body,
        url: release.html_url,
        publishedAt: release.published_at,
        prerelease: release.prerelease || false,
        draft: release.draft || false,
      }));

      return {
        success: true,
        releases: formattedReleases,
        totalCount: formattedReleases.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to fetch GitHub releases: ${errorMessage}`,
      };
    }
  },
});

async function fetchReleasesBetweenVersions(
  octokit: Octokit,
  owner: string,
  repo: string,
  fromVersion: string,
  toVersion: string
): Promise<any[]> {
  const allReleases: any[] = [];
  let page = 1;
  const perPage = 100;
  const maxPages = 10; // Limit to prevent excessive API calls

  while (page <= maxPages) {
    try {
      const { data: releases } = await octokit.repos.listReleases({
        owner,
        repo,
        per_page: perPage,
        page,
      });

      if (releases.length === 0) break;

      for (const release of releases) {
        const releaseVersion = normalizeVersion(release.tag_name || '');
        
        // Check if this release is in our version range
        if (releaseVersion && isVersionInRange(releaseVersion, fromVersion, toVersion)) {
          allReleases.push(release);
        }
      }

      // Stop if we've gone past our range (assuming releases are sorted newest first)
      const oldestRelease = releases[releases.length - 1];
      if (oldestRelease) {
        const oldestVersion = normalizeVersion(oldestRelease.tag_name || '');
        if (oldestVersion && compareVersions(oldestVersion, fromVersion) < 0) {
          break; // We've gone past our range
        }
      }

      if (releases.length < perPage) break;
      page++;
    } catch (error) {
      console.warn(`Error fetching releases page ${page}:`, error);
      break;
    }
  }

  // Sort by version (newest first)
  return allReleases.sort((a, b) => {
    const aVersion = normalizeVersion(a.tag_name || '');
    const bVersion = normalizeVersion(b.tag_name || '');
    return compareVersions(bVersion, aVersion);
  });
}