/**
 * Common npm registry operations
 * Provides centralized npm command patterns to reduce code duplication
 */

import { secureNpmExec, parseJsonOutput, isSuccessful } from './secure-exec.js';
import { loggers } from './logger.js';
import { tryWithLogging } from './error-handlers.js';

export interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  repository?: string | { type: string; url: string };
  license?: string;
  time?: Record<string, string>;
  deprecated?: boolean | string;
  downloads?: number;
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Get repository URL from package metadata
 * Consolidates the duplicate pattern across multiple files
 */
export async function getPackageRepository(packageName: string): Promise<string | null> {
  const result = await tryWithLogging(
    async () => {
      const result = await secureNpmExec('view', [packageName, 'repository.url', '--json']);

      if (!isSuccessful(result)) {
        return null;
      }

      const data = parseJsonOutput(result.stdout);
      if (!data) return null;

      // Handle different response formats
      if (typeof data === 'string') {
        return data;
      }

      if (typeof data === 'object' && (data as { repository?: unknown }).repository) {
        const repo = (data as { repository?: string | { url?: string } }).repository;
        if (typeof repo === 'string') {
          return repo;
        } else if (repo && typeof repo.url === 'string') {
          return repo.url;
        } else {
          return null;
        }
      }

      return null;
    },
    'fetch repository',
    packageName
  );

  return result ?? null;
}

/**
 * Get package metadata from npm registry
 * Replaces multiple instances of npm view --json
 */
export async function getPackageMetadata(packageSpec: string): Promise<PackageInfo | null> {
  return tryWithLogging(
    async () => {
      const result = await secureNpmExec('view', [packageSpec, '--json']);

      if (!isSuccessful(result)) {
        return null;
      }

      const data = parseJsonOutput<PackageInfo>(result.stdout);
      return data;
    },
    'fetch metadata',
    packageSpec
  );
}

/**
 * Get raw package metadata for processing
 */
export async function getPackageRawData(
  packageSpec: string
): Promise<Record<string, unknown> | null> {
  return tryWithLogging(
    async () => {
      const result = await secureNpmExec('view', [packageSpec, '--json']);

      if (!isSuccessful(result)) {
        return null;
      }

      const data = parseJsonOutput<Record<string, unknown>>(result.stdout);
      return data;
    },
    'fetch raw metadata',
    packageSpec
  );
}

/**
 * Get specific package fields
 */
export async function getPackageFields(
  packageSpec: string,
  fields: string[]
): Promise<Record<string, unknown> | null> {
  try {
    const result = await secureNpmExec('view', [packageSpec, ...fields, '--json']);

    if (!isSuccessful(result)) {
      return null;
    }

    return parseJsonOutput(result.stdout);
  } catch (error) {
    loggers.npmOperationFailed('fetch fields', packageSpec, error);
    return null;
  }
}

/**
 * Get package readme content
 */
export async function getPackageReadme(packageSpec: string): Promise<string | null> {
  try {
    const result = await secureNpmExec('view', [packageSpec, 'readme']);

    if (!isSuccessful(result)) {
      return null;
    }

    return result.stdout;
  } catch (error) {
    loggers.npmOperationFailed('fetch readme', packageSpec, error);
    return null;
  }
}

/**
 * Get npm diff between two package versions
 * Fixed: Now uses correct --diff syntax instead of positional arguments
 */
export async function getNpmDiff(fromSpec: string, toSpec: string): Promise<string | null> {
  return tryWithLogging(
    async () => {
      // npm diff requires --diff flag for each package spec
      const result = await secureNpmExec('diff', [`--diff=${fromSpec}`, `--diff=${toSpec}`]);

      if (!isSuccessful(result)) {
        console.warn(`npm diff failed for ${fromSpec} -> ${toSpec}`);
        return null;
      }

      return result.stdout;
    },
    'npm diff',
    `${fromSpec} -> ${toSpec}`
  );
}

/**
 * List package dependencies
 */
export async function listPackageDependencies(
  packageName: string,
  options: {
    depth?: number;
    prod?: boolean;
    dev?: boolean;
  } = {}
): Promise<unknown> {
  try {
    const args = ['ls', packageName, '--json'];

    if (options.depth !== undefined) {
      args.push(`--depth=${options.depth}`);
    }

    if (options.prod) {
      args.push('--prod');
    }

    if (options.dev) {
      args.push('--dev');
    }

    const result = await secureNpmExec('ls', args.slice(1));

    if (!isSuccessful(result)) {
      return null;
    }

    return parseJsonOutput(result.stdout);
  } catch (error) {
    loggers.npmOperationFailed('list dependencies', packageName, error);
    return null;
  }
}

/**
 * Run npm audit
 */
export async function runNpmAudit(
  options: {
    json?: boolean;
    level?: 'low' | 'moderate' | 'high' | 'critical';
  } = {}
): Promise<unknown> {
  try {
    const args = ['audit'];

    if (options.json) {
      args.push('--json');
    }

    if (options.level) {
      args.push(`--audit-level=${options.level}`);
    }

    const result = await secureNpmExec('audit', args.slice(1));

    // npm audit returns non-zero exit code when vulnerabilities are found
    // but we still want to parse the output
    if (options.json) {
      return parseJsonOutput(result.stdout);
    }

    return result.stdout;
  } catch (error) {
    loggers.genericFailed('run npm audit', error);
    return null;
  }
}

/**
 * Check if a package exists in npm registry
 */
export async function packageExists(packageName: string): Promise<boolean> {
  const metadata = await getPackageMetadata(packageName);
  return metadata !== null;
}

/**
 * Get package download stats
 */
export async function getPackageDownloads(packageName: string): Promise<number | null> {
  try {
    const data = await getPackageFields(packageName, ['downloads']);
    const downloads = data?.downloads;
    return typeof downloads === 'number' ? downloads : null;
  } catch (error) {
    loggers.npmOperationFailed('fetch downloads', packageName, error);
    return null;
  }
}

/**
 * Extract GitHub repository info from various formats
 */
export function extractGitHubRepo(repositoryUrl: string | undefined): {
  owner: string;
  repo: string;
} | null {
  if (!repositoryUrl) return null;

  // Common patterns
  const patterns = [
    /github\.com[/:]([\w-]+)\/([\w-]+)/,
    /^([\w-]+)\/([\w-]+)$/, // shorthand format
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(repositoryUrl);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
      };
    }
  }

  return null;
}
