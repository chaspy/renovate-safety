// Helper functions for get-pr-info to reduce complexity
import { Octokit } from '@octokit/rest';
import { secureSystemExec } from '../../lib/secure-exec.js';
import { safeJsonParse } from '../../lib/safe-json.js';

export interface PRInfo {
  number: number;
  title: string;
  body: string;
  base: string;
  head: string;
  state: string;
  author: string;
  repository?: {
    owner: string;
    name: string;
  };
  headRepository?: {
    owner: string;
    name: string;
  };
}

export async function fetchPRWithGHCLI(
  prNumber: number,
  includeBaseRepository: boolean,
  getRepoInfo: () => Promise<[string, string]>
): Promise<{ success: boolean; data?: PRInfo; error?: string }> {
  const fields = [
    'number',
    'title',
    'body',
    'baseRefName',
    'headRefName',
    'state',
    'author'
  ];

  if (includeBaseRepository) {
    fields.push('headRepository', 'headRepositoryOwner');
  }

  const result = await secureSystemExec('gh', [
    'pr',
    'view',
    prNumber.toString(),
    '--json',
    fields.join(','),
  ]);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const data = safeJsonParse(result.stdout, {}) as Record<string, any>;
  const prInfo = transformGHCLIData(data, prNumber);

  if (includeBaseRepository) {
    const extendedInfo = await addRepositoryInfo(prInfo, data, getRepoInfo);
    return { success: true, data: extendedInfo };
  }

  return { success: true, data: prInfo };
}

function transformGHCLIData(data: Record<string, any>, prNumber: number): PRInfo {
  return {
    number: typeof data.number === 'number' ? data.number : prNumber,
    title: typeof data.title === 'string' ? data.title : '',
    body: typeof data.body === 'string' ? data.body : '',
    base: typeof data.baseRefName === 'string' ? data.baseRefName : '',
    head: typeof data.headRefName === 'string' ? data.headRefName : '',
    state: typeof data.state === 'string' ? data.state : 'unknown',
    author: data.author?.login || '',
  };
}

async function addRepositoryInfo(
  prInfo: PRInfo,
  data: Record<string, any>,
  getRepoInfo: () => Promise<[string, string]>
): Promise<PRInfo> {
  let baseOwner = '';
  let baseName = '';

  try {
    const [repoOwner, repoName] = await getRepoInfo();
    baseOwner = repoOwner;
    baseName = repoName;
  } catch {
    // Fallback to headRepositoryOwner if we can't get repo info
    baseOwner = data.headRepositoryOwner?.login || '';
    baseName = data.headRepository?.name || '';
  }

  return {
    ...prInfo,
    repository: {
      owner: baseOwner,
      name: baseName,
    },
    headRepository: data.headRepository ? {
      owner: data.headRepository.owner?.login || '',
      name: data.headRepository.name || '',
    } : undefined,
  };
}

export async function fetchPRWithOctokit(
  prNumber: number,
  includeBaseRepository: boolean,
  auth: string,
  getRepoInfo: () => Promise<[string, string]>
): Promise<{ success: boolean; data?: PRInfo; error?: string; status?: number }> {
  try {
    const [owner, repo] = await getRepoInfo();
    const octokit = new Octokit({ auth });

    const response = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const data = response.data;
    const prInfo = transformOctokitData(data);

    if (includeBaseRepository) {
      const extendedInfo = addOctokitRepositoryInfo(prInfo, data);
      return { success: true, data: extendedInfo };
    }

    return { success: true, data: prInfo };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = error && typeof error === 'object' && 'status' in error ?
      (typeof error.status === 'number' ? error.status : undefined) : undefined;

    return {
      success: false,
      error: `GitHub API failed: ${errorMessage}`,
      status,
    };
  }
}

function transformOctokitData(data: any): PRInfo {
  return {
    number: data.number,
    title: data.title,
    body: data.body || '',
    base: data.base.ref,
    head: data.head.ref,
    state: data.state,
    author: data.user?.login || '',
  };
}

function addOctokitRepositoryInfo(prInfo: PRInfo, data: any): PRInfo {
  return {
    ...prInfo,
    repository: {
      owner: data.base.repo.owner.login,
      name: data.base.repo.name,
    },
    headRepository: {
      owner: data.head.repo.owner.login,
      name: data.head.repo.name,
    },
  };
}

export function createErrorResponse(
  ghError: string | undefined,
  octokitError: string | undefined,
  octokitStatus?: number
): { success: false; error: string; fallback?: string; status?: number } {
  if (!octokitError) {
    return {
      success: false,
      error: `GitHub CLI failed and no GitHub token available: ${ghError}`,
      fallback: 'Please install gh CLI or set GITHUB_TOKEN',
    };
  }

  return {
    success: false,
    error: `Both gh CLI and GitHub API failed: ${ghError}, ${octokitError}`,
    status: octokitStatus,
  };
}