import { Octokit } from '@octokit/rest';
import { execa } from 'execa';
import type { CLIOptions, PackageUpdate } from '../types/index.js';

export async function extractPackageInfo(options: CLIOptions): Promise<PackageUpdate | null> {
  // If manual override provided, use it
  if (options.package && options.from && options.to) {
    return {
      name: options.package,
      fromVersion: options.from,
      toVersion: options.to,
    };
  }

  // Try to get info from PR or current branch
  let prData: PRData | null = null;

  if (options.pr) {
    prData = await getPRData(options.pr);
  } else {
    prData = await getPRDataFromCurrentBranch();
  }

  if (!prData) {
    throw new Error(
      'Could not determine PR information. Please provide --pr or manual package info.'
    );
  }

  // Extract package info from PR title/branch name
  const packageInfo = extractFromRenovatePR(prData);

  if (!packageInfo && (!options.package || !options.from || !options.to)) {
    throw new Error(
      'Could not extract package information from PR. Please provide manual overrides.'
    );
  }

  return (
    packageInfo || {
      name: options.package ?? '',
      fromVersion: options.from ?? '',
      toVersion: options.to ?? '',
    }
  );
}

interface PRData {
  title: string;
  branch: string;
  body: string;
}

async function getPRData(prNumber: number): Promise<PRData | null> {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      // Try using gh CLI
      const { stdout } = await execa('gh', [
        'pr',
        'view',
        prNumber.toString(),
        '--json',
        'title,headRefName,body',
      ]);
      const data = JSON.parse(stdout);
      return {
        title: data.title,
        branch: data.headRefName,
        body: data.body || '',
      };
    }

    // Use Octokit if token available
    const [owner, repo] = await getRepoInfo();
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      title: data.title,
      branch: data.head.ref,
      body: data.body || '',
    };
  } catch (error) {
    console.error('Failed to fetch PR data:', error);
    return null;
  }
}

async function getPRDataFromCurrentBranch(): Promise<PRData | null> {
  try {
    // Get current branch name
    const { stdout: branch } = await execa('git', ['branch', '--show-current']);

    // Try to find PR for this branch
    try {
      const { stdout } = await execa('gh', ['pr', 'view', '--json', 'title,body']);
      const data = JSON.parse(stdout);
      return {
        title: data.title,
        branch,
        body: data.body || '',
      };
    } catch {
      // No PR found, just use branch name
      return {
        title: branch,
        branch,
        body: '',
      };
    }
  } catch (error) {
    console.error('Failed to get current branch info:', error);
    return null;
  }
}

async function getRepoInfo(): Promise<[string, string]> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin']);
    const match = stdout.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      return [match[1], match[2]];
    }
  } catch {
    // Failed to get git remote URL
  }

  throw new Error('Could not determine repository owner and name');
}

function extractFromRenovatePR(prData: PRData): PackageUpdate | null {
  // Common Renovate patterns
  const patterns = [
    // "Update dependency @types/node to v20.11.5"
    /Update dependency (.+?) to v?(.+)$/,
    // "Update @types/node from 20.11.4 to 20.11.5"
    /Update (.+?) from v?(.+?) to v?(.+)$/,
    // "chore(deps): update dependency @types/node to v20.11.5"
    /chore\(deps\): update dependency (.+?) to v?(.+)$/,
    // Branch name patterns: "renovate/node-20.x"
    /renovate\/(.+?)-(.+)$/,
  ];

  // Try title first
  for (const pattern of patterns) {
    const match = prData.title.match(pattern);
    if (match) {
      if (match.length === 4) {
        // Pattern with from and to versions
        return {
          name: match[1],
          fromVersion: normalizeVersion(match[2]),
          toVersion: normalizeVersion(match[3]),
        };
      } else if (match.length === 3) {
        // Pattern with only to version - need to extract from version from PR body
        const fromVersion = extractFromVersion(prData.body, match[1]);
        if (fromVersion) {
          return {
            name: match[1],
            fromVersion: normalizeVersion(fromVersion),
            toVersion: normalizeVersion(match[2]),
          };
        }
      }
    }
  }

  // Try branch name
  const branchMatch = prData.branch.match(/renovate\/(.+?)-(.+)$/);
  if (branchMatch) {
    // Extract version info from PR body
    const fromVersion = extractFromVersion(prData.body, branchMatch[1]);
    const toVersion = extractToVersion(prData.body, branchMatch[1]);

    if (fromVersion && toVersion) {
      return {
        name: branchMatch[1],
        fromVersion: normalizeVersion(fromVersion),
        toVersion: normalizeVersion(toVersion),
      };
    }
  }

  return null;
}

function extractFromVersion(body: string, packageName: string): string | null {
  const patterns = [
    new RegExp(`${escapeRegex(packageName)}[\\s\\S]*?from[\\s\\S]*?v?([\\d.]+)`, 'i'),
    new RegExp(`"${escapeRegex(packageName)}":[\\s]*"[~^]?([\\d.]+)"`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function extractToVersion(body: string, packageName: string): string | null {
  const patterns = [
    new RegExp(`${escapeRegex(packageName)}[\\s\\S]*?to[\\s\\S]*?v?([\\d.]+)`, 'i'),
    new RegExp(`"${escapeRegex(packageName)}":[\\s]*"[~^]?([\\d.]+)"[\\s\\S]*?###`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function normalizeVersion(version: string): string {
  // Remove v prefix and any semver range operators
  return version.replace(/^[v~^]/, '');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
