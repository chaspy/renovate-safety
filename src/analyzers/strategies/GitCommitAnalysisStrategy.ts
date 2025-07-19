import { AnalysisStrategy, StrategyAnalysisResult } from './base.js';
import type { PackageUpdate } from '../../types/index.js';
import { Octokit } from '@octokit/rest';
import { getPackageRepository, extractGitHubRepo } from '../../lib/npm-registry.js';

export class GitCommitAnalysisStrategy extends AnalysisStrategy {
  name = 'Git Commit Analysis';
  private readonly octokit: Octokit;

  constructor() {
    super();
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
  }

  async isApplicable(pkg: PackageUpdate): Promise<boolean> {
    const repoInfo = await this.getGitHubRepoInfo(pkg.name);
    return repoInfo !== null;
  }

  async tryAnalyze(pkg: PackageUpdate): Promise<StrategyAnalysisResult | null> {
    try {
      const repoInfo = await this.getGitHubRepoInfo(pkg.name);
      if (!repoInfo) return null;

      const { owner, repo } = repoInfo;

      // Get commits between versions
      const commits = await this.getCommitsBetweenVersions(
        owner,
        repo,
        pkg.fromVersion,
        pkg.toVersion
      );

      if (commits.length === 0) {
        return null;
      }

      // Analyze commit messages for breaking changes
      const breakingCommits = this.analyzeCommitMessages(commits);
      
      // Generate content summary
      const content = this.generateCommitSummary(commits, breakingCommits);

      return {
        content,
        breakingChanges: breakingCommits.map(c => c.message),
        confidence: 0.7, // Medium-high confidence
        source: this.name,
        metadata: {
          totalCommits: commits.length,
          breakingCommitCount: breakingCommits.length,
          authors: [...new Set(commits.map(c => c.author))]
        }
      };
    } catch (error) {
      console.warn(`Failed to analyze commits:`, error);
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

    return null;
  }

  private async getCommitsBetweenVersions(
    owner: string,
    repo: string,
    fromVersion: string,
    toVersion: string
  ): Promise<any[]> {
    try {
      // Try to find tags for versions
      const fromTag = await this.findTagForVersion(owner, repo, fromVersion);
      const toTag = await this.findTagForVersion(owner, repo, toVersion);

      if (!fromTag || !toTag) {
        return [];
      }

      // Get comparison between tags
      const { data: comparison } = await this.octokit.repos.compareCommits({
        owner,
        repo,
        base: fromTag,
        head: toTag
      });

      return comparison.commits.map(commit => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author?.name || 'unknown',
        date: commit.commit.author?.date,
        files: commit.files?.map(f => f.filename) || []
      }));
    } catch (error) {
      console.warn('Failed to get commits between versions:', error);
      return [];
    }
  }

  private async findTagForVersion(owner: string, repo: string, version: string): Promise<string | null> {
    const possibleTags = [
      version,
      `v${version}`,
      `${version}.0`,
      `v${version}.0`,
      version.replace(/\.\d+$/, '') // Try without patch version
    ];

    for (const tag of possibleTags) {
      try {
        await this.octokit.git.getRef({
          owner,
          repo,
          ref: `tags/${tag}`
        });
        return tag;
      } catch {
        // Continue trying
      }
    }

    return null;
  }

  private analyzeCommitMessages(commits: any[]): any[] {
    const breakingIndicators = [
      /BREAKING[\s-]CHANGE/i,
      /BREAKING:/i,
      /\[BREAKING\]/i,
      /💥/,
      /\bbc\b:/i,
      /incompatible/i,
      /\bmajor\b.*\bchange/i
    ];

    return commits.filter(commit => {
      return breakingIndicators.some(pattern => pattern.test(commit.message));
    });
  }

  private generateCommitSummary(commits: any[], breakingCommits: any[]): string {
    let summary = `# Commit Analysis Summary\n\n`;
    summary += `Total commits between versions: ${commits.length}\n`;
    summary += `Breaking changes detected: ${breakingCommits.length}\n\n`;

    if (breakingCommits.length > 0) {
      summary += `## Breaking Changes\n\n`;
      breakingCommits.forEach(commit => {
        const firstLine = commit.message.split('\n')[0];
        summary += `- ${firstLine} (${commit.sha.substring(0, 7)})\n`;
      });
      summary += '\n';
    }

    // Group commits by type (if conventional commits are used)
    const commitsByType = this.groupCommitsByType(commits);
    
    if (Object.keys(commitsByType).length > 0) {
      summary += `## Changes by Type\n\n`;
      for (const [type, typeCommits] of Object.entries(commitsByType)) {
        summary += `### ${this.formatCommitType(type)} (${typeCommits.length})\n`;
        typeCommits.slice(0, 5).forEach((commit: any) => {
          const firstLine = commit.message.split('\n')[0];
          summary += `- ${firstLine}\n`;
        });
        if (typeCommits.length > 5) {
          summary += `- ... and ${typeCommits.length - 5} more\n`;
        }
        summary += '\n';
      }
    }

    return summary;
  }

  private groupCommitsByType(commits: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    
    // Conventional commit pattern
    const conventionalPattern = /^(\w+)(?:\(.+?\))?:/;
    
    commits.forEach(commit => {
      const match = commit.message.match(conventionalPattern);
      const type = match ? match[1] : 'other';
      
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(commit);
    });

    return groups;
  }

  private formatCommitType(type: string): string {
    const typeMap: Record<string, string> = {
      feat: 'Features',
      fix: 'Bug Fixes',
      docs: 'Documentation',
      style: 'Style Changes',
      refactor: 'Refactoring',
      perf: 'Performance',
      test: 'Tests',
      build: 'Build System',
      ci: 'CI/CD',
      chore: 'Chores',
      revert: 'Reverts',
      other: 'Other Changes'
    };

    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1);
  }
}