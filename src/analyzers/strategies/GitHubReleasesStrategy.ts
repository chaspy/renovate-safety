import { AnalysisStrategy, StrategyAnalysisResult } from './base.js';
import type { PackageUpdate } from '../../types/index.js';
import { Octokit } from '@octokit/rest';
import { extractBreakingChanges } from '../../lib/breaking.js';
import { getPackageRepository, extractGitHubRepo } from '../../lib/npm-registry.js';
import { compareVersions, normalizeVersion, isVersionInRange } from '../../lib/version-utils.js';
import { getGitHubClient } from '../../lib/github-client.js';

export class GitHubReleasesStrategy extends AnalysisStrategy {
  name = 'GitHub Releases';
  private readonly octokit: Octokit;

  constructor() {
    super();
    this.octokit = getGitHubClient();
  }

  async isApplicable(pkg: PackageUpdate): Promise<boolean> {
    // Try to determine if package has a GitHub repository
    const repoInfo = await this.getGitHubRepoInfo(pkg.name);
    return repoInfo !== null;
  }

  async tryAnalyze(pkg: PackageUpdate): Promise<StrategyAnalysisResult | null> {
    try {
      const repoInfo = await this.getGitHubRepoInfo(pkg.name);
      if (!repoInfo) return null;

      const { owner, repo } = repoInfo;

      // Fetch releases between versions
      const releases = await this.fetchReleasesBetweenVersions(
        owner,
        repo,
        pkg.fromVersion,
        pkg.toVersion
      );

      if (releases.length === 0) {
        return null;
      }

      // Combine release notes
      const combinedContent = releases
        .map(release => `## ${release.tag_name || release.name}\n\n${release.body || 'No release notes'}`)
        .join('\n\n');

      // Extract breaking changes
      const breakingChanges = extractBreakingChanges(combinedContent, undefined, 'github-releases');

      return {
        content: combinedContent,
        breakingChanges: breakingChanges.map(bc => bc.line),
        confidence: 0.9, // High confidence for official releases
        source: this.name,
        metadata: {
          releaseCount: releases.length,
          hasPrerelease: releases.some(r => r.prerelease)
        }
      };
    } catch (error) {
      console.warn(`Failed to fetch GitHub releases:`, error);
      return null;
    }
  }

  private async getGitHubRepoInfo(packageName: string): Promise<{ owner: string; repo: string } | null> {
    try {
      // Use centralized npm registry utility
      const repoUrl = await getPackageRepository(packageName);
      
      if (repoUrl) {
        return extractGitHubRepo(repoUrl);
      }
    } catch (error) {
      console.warn(`Failed to get GitHub repo info for ${packageName}:`, error);
    }

    // Common patterns for package names to GitHub repos
    const patterns = [
      { pattern: /^@([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/, transform: (m: RegExpMatchArray) => ({ owner: m[1], repo: m[2] }) },
      { pattern: /^([a-zA-Z0-9_.-]+)$/, transform: (m: RegExpMatchArray) => ({ owner: m[1], repo: m[1] }) }
    ];

    for (const { pattern, transform } of patterns) {
      const match = pattern.exec(packageName);
      if (match) {
        const repoInfo = transform(match);
        // Verify the repo exists
        try {
          await this.octokit.repos.get(repoInfo);
          return repoInfo;
        } catch {
          // Continue to next pattern
        }
      }
    }

    return null;
  }

  private async fetchReleasesBetweenVersions(
    owner: string,
    repo: string,
    fromVersion: string,
    toVersion: string
  ): Promise<any[]> {
    const allReleases: any[] = [];
    let page = 1;
    const perPage = 100;

    // Normalize version strings (remove 'v' prefix if present)
    const fromVersionNorm = normalizeVersion(fromVersion);
    const toVersionNorm = normalizeVersion(toVersion);

    while (true) {
      const { data: releases } = await this.octokit.repos.listReleases({
        owner,
        repo,
        per_page: perPage,
        page
      });

      if (releases.length === 0) break;

      for (const release of releases) {
        const releaseVersion = normalizeVersion(release.tag_name || '');
        
        // Check if this release is in our version range
        if (isVersionInRange(releaseVersion, fromVersionNorm, toVersionNorm)) {
          allReleases.push(release);
        }
      }

      if (releases.length < perPage) break;
      page++;
    }

    // Sort by version (newest first)
    return allReleases.sort((a, b) => {
      const aVersion = normalizeVersion(a.tag_name || '');
      const bVersion = normalizeVersion(b.tag_name || '');
      return compareVersions(bVersion, aVersion);
    });
  }
}