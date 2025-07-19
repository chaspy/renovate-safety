import { Octokit } from '@octokit/rest';
import { secureSystemExec } from './secure-exec.js';
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

export async function getRenovatePRs(): Promise<PRInfo[]> {
  try {
    // Try using gh CLI first
    const result = await secureSystemExec('gh', [
      'pr',
      'list',
      '--json',
      'number,title,author,headRefName,body',
      '--limit',
      '100',
    ]);
    
    if (!result.success) {
      throw new Error(`gh CLI failed: ${result.error}`);
    }

    const allPRs = JSON.parse(result.stdout);

    // Filter for Renovate PRs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renovatePRs = allPRs.filter((pr: any) => {
      const isRenovateAuthor =
        pr.author?.login === 'renovate' ||
        pr.author?.login === 'renovate[bot]' ||
        pr.author?.login?.includes('renovate');
      const isRenovateBranch = pr.headRefName?.startsWith('renovate/');
      const isRenovateTitle =
        pr.title?.toLowerCase().includes('update dependency') ||
        pr.title?.toLowerCase().includes('chore(deps)');

      return isRenovateAuthor || isRenovateBranch || isRenovateTitle;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return renovatePRs.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName,
      body: pr.body || '',
    }));
  } catch (error) {
    // Fallback to Octokit if gh CLI fails
    try {
      const [owner, repo] = await getRepoInfo();
      const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
      });

      const { data: allPRs } = await octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        per_page: 100,
      });

      const renovatePRs = allPRs.filter((pr) => {
        const isRenovateAuthor =
          pr.user?.login === 'renovate' ||
          pr.user?.login === 'renovate[bot]' ||
          pr.user?.login?.includes('renovate');
        const isRenovateBranch = pr.head.ref?.startsWith('renovate/');
        const isRenovateTitle =
          pr.title?.toLowerCase().includes('update dependency') ||
          pr.title?.toLowerCase().includes('chore(deps)');

        return isRenovateAuthor || isRenovateBranch || isRenovateTitle;
      });

      return renovatePRs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        branch: pr.head.ref,
        body: pr.body || '',
      }));
    } catch {
      console.error('Failed to fetch PRs:', error);
      return [];
    }
  }
}

interface PRInfo {
  number: number;
  title: string;
  branch: string;
  body: string;
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
      const result = await secureSystemExec('gh', [
        'pr',
        'view',
        prNumber.toString(),
        '--json',
        'title,headRefName,body',
      ]);
      
      if (!result.success) {
        throw new Error(`gh CLI failed: ${result.error}`);
      }
      
      const data = JSON.parse(result.stdout);
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
    const branchResult = await secureSystemExec('git', ['branch', '--show-current']);
    
    if (!branchResult.success) {
      throw new Error(`Failed to get current branch: ${branchResult.error}`);
    }
    
    const branch = branchResult.stdout.trim();

    // Try to find PR for this branch
    try {
      const prResult = await secureSystemExec('gh', ['pr', 'view', '--json', 'title,body']);
      
      if (!prResult.success) {
        throw new Error('No PR found for current branch');
      }
      
      const data = JSON.parse(prResult.stdout);
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
    const result = await secureSystemExec('git', ['remote', 'get-url', 'origin']);
    
    if (!result.success) {
      throw new Error(`Failed to get git remote URL: ${result.error}`);
    }
    
    const match = result.stdout.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      return [match[1], match[2]];
    }
  } catch {
    // Failed to get git remote URL
  }

  throw new Error('Could not determine repository owner and name');
}

function extractFromRenovatePR(prData: PRData): PackageUpdate | null {
  // Handle monorepo cases first - extract from body table
  if (prData.title.toLowerCase().includes('monorepo')) {
    // For monorepos, parse the markdown table structure
    // Handle both direct backticks and markdown-wrapped versions:
    // | [@types/jest](...) | `^29.5.12` -> `^30.0.0` | ... |
    // | [jest](...) | [`^29.7.0` -> `^30.0.0`](url) | ... |
    const patterns = [
      // Pattern for versions wrapped in markdown links
      /\|\s*\[([^\]]+)\][^|]*\|\s*\[`([^`]+)`\s*->\s*`([^`]+)`\][^|]*\|/g,
      // Pattern for direct backtick versions
      /\|\s*\[?([^|\]]+)\]?(?:\([^)]*\))?\s*\|\s*`([^`]+)`\s*->\s*`([^`]+)`\s*\|/g,
    ];
    
    let matches: RegExpMatchArray[] = [];
    
    // Try both patterns
    for (const pattern of patterns) {
      const patternMatches = [...prData.body.matchAll(pattern)];
      if (patternMatches.length > 0) {
        matches = patternMatches;
        break;
      }
    }
    
    for (const match of matches) {
      if (match && match[1] && match[2] && match[3]) {
        const packageName = match[1].trim();
        const fromVersion = match[2].trim();
        const toVersion = match[3].trim();
        
        // Skip header rows
        if (packageName.toLowerCase() === 'package') {
          continue;
        }
        
        // For monorepos, return the first valid package found
        // Prefer the main package (e.g., 'jest' over '@types/jest')
        const normalizedFrom = normalizeVersion(fromVersion);
        const normalizedTo = normalizeVersion(toVersion);
        
        if (normalizedFrom && normalizedTo) {
          // If we find the main package, use it; otherwise use the first valid one
          if (!packageName.startsWith('@types/')) {
            return {
              name: packageName,
              fromVersion: normalizedFrom,
              toVersion: normalizedTo,
            };
          }
        }
      }
    }
    
    // If we only found @types packages, use the first one
    if (matches.length > 0 && matches[0][1] && matches[0][2] && matches[0][3]) {
      const firstMatch = matches[0];
      const normalizedFrom = normalizeVersion(firstMatch[2].trim());
      const normalizedTo = normalizeVersion(firstMatch[3].trim());
      
      if (normalizedFrom && normalizedTo) {
        return {
          name: firstMatch[1].trim(),
          fromVersion: normalizedFrom,
          toVersion: normalizedTo,
        };
      }
    }
  }

  // Common Renovate patterns
  const patterns = [
    // "Update dependency @types/node to v20.11.5"
    /Update dependency (.+?) to v?(.+)$/,
    // "Update @types/node from 20.11.4 to 20.11.5"
    /Update (.+?) from v?(.+?) to v?(.+)$/,
    // "chore(deps): update dependency @types/node to v20.11.5"
    /chore\(deps\): update dependency (.+?) to v?(.+)$/,
    // "fix(deps): update dependency @types/node to v20.11.5"
    /fix\(deps\): update dependency (.+?) to v?(.+)$/,
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
        const packageName = match[1];
        const toVersionFromTitle = match[2];
        
        // Extract full versions from body
        const fromVersion = extractFromVersion(prData.body, packageName);
        const toVersion = extractToVersion(prData.body, packageName);
        
        // Use body version if available, otherwise try to use title version
        if (fromVersion && toVersion) {
          return {
            name: packageName,
            fromVersion: normalizeVersion(fromVersion),
            toVersion: normalizeVersion(toVersion),
          };
        } else if (fromVersion && toVersionFromTitle) {
          // If we only have from version from body, use title for to version
          // But only if it looks like a complete version
          if (/^\d+\.\d+\.\d+/.test(toVersionFromTitle)) {
            return {
              name: packageName,
              fromVersion: normalizeVersion(fromVersion),
              toVersion: normalizeVersion(toVersionFromTitle),
            };
          }
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
  // Clean HTML entities from body to avoid issues like &#8203;
  const cleanBody = body.replace(/&#\d+;/g, '');
  
  const patterns = [
    // Markdown table with caret/tilde: | globals | `^14.0.0` -> `^16.2.0` |
    new RegExp(
      `\\|\\s*\\[?${escapeRegex(packageName)}\\]?[^|]*\\|[^|]*\`[~^]?([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)\`\\s*->`,
      'i'
    ),
    // Standard markdown table: | [@types/node](...) | `24.0.6` -> `24.0.7` |
    new RegExp(
      `\\|\\s*\\[?${escapeRegex(packageName)}\\]?[^|]*\\|[^|]*\`([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)\`\\s*->`,
      'i'
    ),
    // Python format: | lxml | `==5.4.0` -> `==6.0.0` |
    new RegExp(
      `\\|\\s*\\[?${escapeRegex(packageName)}\\]?[^|]*\\|[^|]*\`(?:==)?([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)\`\\s*->`,
      'i'
    ),
    // Fallback patterns
    new RegExp(`${escapeRegex(packageName)}[\\s\\S]*?from[\\s\\S]*?v?([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)`, 'i'),
    new RegExp(`"${escapeRegex(packageName)}":[\\s]*"[~^]?([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)"`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = cleanBody.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function extractToVersion(body: string, packageName: string): string | null {
  // Clean HTML entities from body to avoid issues like &#8203;
  const cleanBody = body.replace(/&#\d+;/g, '');
  
  const patterns = [
    // Markdown table with caret/tilde: | globals | `^14.0.0` -> `^16.2.0` |
    new RegExp(
      `\\|\\s*\\[?${escapeRegex(packageName)}\\]?[^|]*\\|[^|]*->[\\s]*\`[~^]?([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)\``,
      'i'
    ),
    // Standard markdown table: | [@types/node](...) | `24.0.6` -> `24.0.7` |
    new RegExp(
      `\\|\\s*\\[?${escapeRegex(packageName)}\\]?[^|]*\\|[^|]*->[\\s]*\`([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)\``,
      'i'
    ),
    // Python format: | lxml | `==5.4.0` -> `==6.0.0` |
    new RegExp(
      `\\|\\s*\\[?${escapeRegex(packageName)}\\]?[^|]*\\|[^|]*->[\\s]*\`(?:==)?([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)\``,
      'i'
    ),
    // Fallback patterns
    new RegExp(`${escapeRegex(packageName)}[\\s\\S]*?to[\\s\\S]*?v?([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)`, 'i'),
    new RegExp(`"${escapeRegex(packageName)}":[\\s]*"[~^]?([\\d]+\\.[\\d]+\\.[\\d]+(?:-[\\w.]+)?)"[\\s\\S]*?###`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = cleanBody.match(pattern);
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
