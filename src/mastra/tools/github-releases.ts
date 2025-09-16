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
      const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
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

// Fetch a single page of releases
async function fetchReleasesPage(
  octokit: Octokit,
  owner: string,
  repo: string,
  page: number,
  perPage: number
): Promise<any[]> {
  try {
    const { data: releases } = await octokit.repos.listReleases({
      owner,
      repo,
      per_page: perPage,
      page,
    });
    return releases;
  } catch (error) {
    console.warn(`Error fetching releases page ${page}:`, error);
    return [];
  }
}

// Filter releases within version range
function filterReleasesInRange(
  releases: any[],
  fromVersion: string,
  toVersion: string
): any[] {
  const filtered: any[] = [];

  for (const release of releases) {
    const releaseVersion = normalizeVersion(release.tag_name || '');
    if (releaseVersion && isVersionInRange(releaseVersion, fromVersion, toVersion)) {
      filtered.push(release);
    }
  }

  return filtered;
}

// Check if we've gone past the version range
function isPageBeyondRange(
  releases: any[],
  fromVersion: string
): boolean {
  if (releases.length === 0) return false;

  const oldestRelease = releases[releases.length - 1];
  if (!oldestRelease) return false;

  const oldestVersion = normalizeVersion(oldestRelease.tag_name || '');
  return oldestVersion ? compareVersions(oldestVersion, fromVersion) < 0 : false;
}

// Sort releases by version (newest first)
function sortReleasesByVersion(releases: any[]): any[] {
  return releases.sort((a, b) => {
    const aVersion = normalizeVersion(a.tag_name || '');
    const bVersion = normalizeVersion(b.tag_name || '');
    return compareVersions(bVersion, aVersion);
  });
}

async function fetchReleasesBetweenVersions(
  octokit: Octokit,
  owner: string,
  repo: string,
  fromVersion: string,
  toVersion: string
): Promise<any[]> {
  const allReleases: any[] = [];
  const perPage = 100;
  const maxPages = 10; // Limit to prevent excessive API calls

  for (let page = 1; page <= maxPages; page++) {
    const releases = await fetchReleasesPage(octokit, owner, repo, page, perPage);

    if (releases.length === 0) break;

    const filteredReleases = filterReleasesInRange(releases, fromVersion, toVersion);
    allReleases.push(...filteredReleases);

    // Check if we've gone past our range
    if (isPageBeyondRange(releases, fromVersion)) break;

    // Check if this was the last page
    if (releases.length < perPage) break;
  }

  return sortReleasesByVersion(allReleases);
}