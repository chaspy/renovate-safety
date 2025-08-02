import { Octokit } from '@octokit/rest';
import type { PackageUpdate } from '../types/index.js';
import { getEnvironmentConfig } from './env-config.js';
import { loggers } from './logger.js';

export interface CodeDiff {
  content: string;
  source: 'github-compare';
  filesChanged: number;
  additions: number;
  deletions: number;
  fromTag: string;
  toTag: string;
}

export async function fetchCodeDiff(packageUpdate: PackageUpdate): Promise<CodeDiff | null> {
  try {
    // Get GitHub repository info for the package
    const githubInfo = await getGitHubInfo(packageUpdate.name);
    if (!githubInfo) {
      loggers.debug(`No GitHub repository found for ${packageUpdate.name}`);
      return null;
    }

    const config = getEnvironmentConfig();
    const octokit = new Octokit({
      auth: config.githubToken,
    });

    // Try to find appropriate tags for comparison
    const fromTag = await findClosestTag(octokit, githubInfo, packageUpdate.fromVersion);
    const toTag = await findClosestTag(octokit, githubInfo, packageUpdate.toVersion);

    if (!fromTag || !toTag) {
      console.debug(
        `Could not find matching tags for ${packageUpdate.fromVersion} -> ${packageUpdate.toVersion}`
      );
      return null;
    }

    // Get comparison data
    const { data: comparison } = await octokit.repos.compareCommits({
      owner: githubInfo.owner,
      repo: githubInfo.repo,
      base: fromTag,
      head: toTag,
      per_page: 100,
    });

    if (!comparison.files || comparison.files.length === 0) {
      loggers.debug('No file changes found in comparison');
      return null;
    }

    // Filter and format the diff content
    const relevantFiles = (comparison.files as GitHubFile[]).filter(
      (file) => isRelevantFile(file.filename) && file.patch && file.patch.length > 0
    );

    if (relevantFiles.length === 0) {
      loggers.debug('No relevant file changes found');
      return null;
    }

    // Create formatted diff content
    const diffContent = formatDiffContent(relevantFiles, packageUpdate);

    return {
      content: diffContent,
      source: 'github-compare',
      filesChanged: relevantFiles.length,
      additions: comparison.ahead_by || 0,
      deletions: comparison.behind_by || 0,
      fromTag,
      toTag,
    };
  } catch (error) {
    loggers.debug('Failed to fetch GitHub diff:', error);
    return null;
  }
}

async function getGitHubInfo(packageName: string): Promise<{ owner: string; repo: string } | null> {
  try {
    // For npm packages, try to get repository info from pacote
    const pacote = await import('pacote');
    const manifest = await pacote.manifest(packageName);

    if (manifest.repository && typeof manifest.repository === 'object' && manifest.repository.url) {
      const match = manifest.repository.url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (match) {
        return {
          owner: match[1],
          repo: match[2],
        };
      }
    }

    // Try homepage
    if (manifest.homepage) {
      const match = manifest.homepage.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        return {
          owner: match[1],
          repo: match[2],
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function findClosestTag(
  octokit: Octokit,
  githubInfo: { owner: string; repo: string },
  version: string
): Promise<string | null> {
  try {
    const { data: tags } = await octokit.repos.listTags({
      owner: githubInfo.owner,
      repo: githubInfo.repo,
      per_page: 100,
    });

    // Try exact match first
    const exactMatch = tags.find(
      (tag) => normalizeTagVersion(tag.name) === normalizeVersion(version)
    );
    if (exactMatch) return exactMatch.name;

    // Try with v prefix
    const vPrefixMatch = tags.find((tag) => tag.name === `v${version}` || tag.name === version);
    if (vPrefixMatch) return vPrefixMatch.name;

    // Try partial match for major.minor versions
    const partialMatch = tags.find((tag) => {
      const tagVersion = normalizeTagVersion(tag.name);
      return tagVersion.startsWith(version) || version.startsWith(tagVersion);
    });
    if (partialMatch) return partialMatch.name;

    return null;
  } catch {
    return null;
  }
}

function normalizeTagVersion(tagName: string): string {
  // Remove common prefixes like 'v', 'release-', etc.
  return tagName.replace(/^(v|release-|tag-|version-)/i, '');
}

function normalizeVersion(version: string): string {
  // Remove semver prefixes
  return version.replace(/^[v~^]/, '');
}

function isRelevantFile(filename: string): boolean {
  // Focus on source code files and important config files
  const relevantExtensions = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.rs',
    '.go',
    '.java',
    '.cs',
    '.cpp',
    '.c',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
  ];

  const irrelevantPatterns = [
    /test/i,
    /spec/i,
    /__tests__/i,
    /\.test\./i,
    /\.spec\./i,
    /docs?/i,
    /examples?/i,
    /demo/i,
    /\.md$/i,
    /\.txt$/i,
    /license/i,
    /readme/i,
    /node_modules/i,
    /dist/i,
    /build/i,
    /coverage/i,
    /\.lock$/i,
    /package-lock\.json$/i,
    /yarn\.lock$/i,
  ];

  // Skip irrelevant files
  if (irrelevantPatterns.some((pattern) => pattern.test(filename))) {
    return false;
  }

  // Include files with relevant extensions
  if (relevantExtensions.some((ext) => filename.endsWith(ext))) {
    return true;
  }

  // Include important root files
  const importantFiles = [
    'package.json',
    'tsconfig.json',
    'babel.config.js',
    'webpack.config.js',
    'rollup.config.js',
    'vite.config.js',
  ];

  return importantFiles.some((file) => filename.endsWith(file));
}

interface GitHubFile {
  filename: string;
  additions?: number;
  deletions?: number;
  status: string;
  patch?: string;
}

function formatDiffContent(files: GitHubFile[], packageUpdate: PackageUpdate): string {
  const header = `# Code Changes Analysis\nPackage: ${packageUpdate.name}\nVersion: ${packageUpdate.fromVersion} → ${packageUpdate.toVersion}\n\n`;

  let content = header;

  // Add summary
  content += `## Summary\n`;
  content += `- Files changed: ${files.length}\n`;
  content += `- Total additions: ${files.reduce((sum, file) => sum + (file.additions || 0), 0)}\n`;
  content += `- Total deletions: ${files.reduce((sum, file) => sum + (file.deletions || 0), 0)}\n\n`;

  // Add file changes (limit to most significant files)
  content += `## Key File Changes\n\n`;

  const significantFiles = files
    .filter((file) => (file.additions || 0) + (file.deletions || 0) > 5) // Filter small changes
    .sort(
      (a, b) => (b.additions || 0) + (b.deletions || 0) - ((a.additions || 0) + (a.deletions || 0))
    )
    .slice(0, 10); // Limit to top 10 files

  for (const file of significantFiles) {
    content += `### ${file.filename}\n`;
    content += `- Status: ${file.status}\n`;
    content += `- Changes: +${file.additions || 0} -${file.deletions || 0}\n\n`;

    if (file.patch) {
      // Truncate very long patches
      let patch = file.patch;
      if (patch.length > 2000) {
        const lines = patch.split('\n');
        const truncatedLines = lines.slice(0, 50);
        patch = truncatedLines.join('\n') + '\n... (truncated for brevity)';
      }
      content += `\`\`\`diff\n${patch}\n\`\`\`\n\n`;
    }
  }

  // Limit total content size
  if (content.length > 15000) {
    content = content.substring(0, 15000) + '\n... (content truncated for analysis)';
  }

  return content;
}
