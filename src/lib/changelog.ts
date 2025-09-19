import pacote from 'pacote';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generatePackageCacheKey } from './cache-utils.js';
import { loggers } from './logger.js';
import semver from 'semver';
import type { PackageUpdate, ChangelogDiff } from '../types/index.js';
import { httpGet } from './http-client.js';
import { fileExists, readJsonFile, ensureDirectory } from './file-helpers.js';
import { getGitHubClient } from './github-client.js';
import { executeInParallel } from './parallel-helpers.js';

export async function fetchChangelogDiff(
  packageUpdate: PackageUpdate,
  cacheDir: string
): Promise<ChangelogDiff | null> {
  // Check cache first
  const cached = await getCachedChangelog(packageUpdate, cacheDir);
  if (cached) {
    return cached;
  }

  // Detect package type and use appropriate fetcher
  const packageType = detectPackageType(packageUpdate.name);

  if (packageType === 'python') {
    // Try PyPI for Python packages
    const pypiChangelog = await fetchFromPyPI(packageUpdate);
    if (pypiChangelog) {
      await cacheChangelog(packageUpdate, pypiChangelog, cacheDir);
      return pypiChangelog;
    }
  }

  // Try GitHub releases first (preferred for all package types)
  const githubChangelog = await fetchFromGitHubReleases(packageUpdate);
  if (githubChangelog) {
    await cacheChangelog(packageUpdate, githubChangelog, cacheDir);
    return githubChangelog;
  }

  // Fall back to npm registry for JavaScript packages
  if (packageType === 'javascript') {
    const npmChangelog = await fetchFromNpmRegistry(packageUpdate);
    if (npmChangelog) {
      await cacheChangelog(packageUpdate, npmChangelog, cacheDir);
      return npmChangelog;
    }
  }

  return null;
}

async function getCachedChangelog(
  packageUpdate: PackageUpdate,
  cacheDir: string
): Promise<ChangelogDiff | null> {
  try {
    const cacheKey = getCacheKey(packageUpdate);
    const cachePath = path.join(cacheDir, `${cacheKey}.json`);

    const exists = await fileExists(cachePath);
    if (!exists) return null;

    return await readJsonFile<ChangelogDiff>(cachePath);
  } catch {
    return null;
  }
}

async function cacheChangelog(
  packageUpdate: PackageUpdate,
  changelog: ChangelogDiff,
  cacheDir: string
): Promise<void> {
  try {
    await ensureDirectory(cacheDir);

    const cacheKey = getCacheKey(packageUpdate);
    const cachePath = path.join(cacheDir, `${cacheKey}.json`);

    await fs.writeFile(cachePath, JSON.stringify(changelog, null, 2));
  } catch (error) {
    loggers.genericFailed('cache changelog', error);
  }
}

function getCacheKey(packageUpdate: PackageUpdate): string {
  return generatePackageCacheKey(packageUpdate);
}

async function fetchFromGitHubReleases(
  packageUpdate: PackageUpdate
): Promise<ChangelogDiff | null> {
  try {
    // Extract GitHub info from package
    const githubInfo = await getGitHubInfo(packageUpdate.name);
    if (!githubInfo) return null;

    const octokit = getGitHubClient();

    // Fetch releases
    const { data: releases } = await octokit.repos.listReleases({
      owner: githubInfo.owner,
      repo: githubInfo.repo,
      per_page: 100,
    });

    // Find releases in version range
    const relevantReleases = releases.filter((release) => {
      const version = normalizeVersion(release.tag_name);
      if (!version) return false;

      return (
        semver.gt(version, packageUpdate.fromVersion) &&
        semver.lte(version, packageUpdate.toVersion)
      );
    });

    if (relevantReleases.length === 0) return null;

    // Combine release notes
    const content = relevantReleases
      .sort((a, b) => {
        const vA = normalizeVersion(a.tag_name);
        const vB = normalizeVersion(b.tag_name);
        if (!vA || !vB) return 0;
        return semver.compare(vA, vB);
      })
      .map((release) => {
        const version = normalizeVersion(release.tag_name);
        return `## ${version}\n\n${release.body || 'No release notes'}`;
      })
      .join('\n\n---\n\n');

    return {
      content,
      source: 'github',
    };
  } catch (error) {
    loggers.debug('Failed to fetch from GitHub:', error);
    return null;
  }
}

async function fetchFromNpmRegistry(packageUpdate: PackageUpdate): Promise<ChangelogDiff | null> {
  try {
    // Fetch both versions - we only use the to version for extraction
    await executeInParallel(
      [
        () => pacote.manifest(`${packageUpdate.name}@${packageUpdate.fromVersion}`),
        () => pacote.manifest(`${packageUpdate.name}@${packageUpdate.toVersion}`),
      ],
      { concurrency: 2 }
    );

    // Extract tarball and look for changelog
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), '.tmp-'));

    try {
      // Extract to version
      await pacote.extract(`${packageUpdate.name}@${packageUpdate.toVersion}`, tempDir);

      // Look for changelog files
      const changelogPath = await findChangelogFile(tempDir);
      if (!changelogPath) return null;

      const fullContent = await fs.readFile(changelogPath, 'utf-8');

      // Extract relevant sections
      const relevantContent = extractRelevantSections(
        fullContent,
        packageUpdate.fromVersion,
        packageUpdate.toVersion
      );

      return relevantContent
        ? {
            content: relevantContent,
            source: 'npm',
          }
        : null;
    } finally {
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    loggers.debug('Failed to fetch from npm:', error);
    return null;
  }
}

async function getGitHubInfo(packageName: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const manifest = await pacote.manifest(packageName);

    if (manifest.repository && typeof manifest.repository === 'object' && manifest.repository.url) {
      const repoRegex = /github\.com[:/]([^/]+)\/([^/.]+)/;
      const match = repoRegex.exec(manifest.repository.url);
      if (match) {
        return {
          owner: match[1],
          repo: match[2],
        };
      }
    }

    // Try homepage
    if (manifest.homepage) {
      const homepageRegex = /github\.com\/([^/]+)\/([^/]+)/;
      const match = homepageRegex.exec(manifest.homepage);
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

async function findChangelogFile(dir: string): Promise<string | null> {
  const possibleNames = [
    'CHANGELOG.md',
    'CHANGELOG',
    'CHANGES.md',
    'CHANGES',
    'HISTORY.md',
    'HISTORY',
    'changelog.md',
    'changes.md',
    'history.md',
  ];

  for (const name of possibleNames) {
    const filePath = path.join(dir, name);
    const exists = await fileExists(filePath);
    if (exists) {
      return filePath;
    }
  }

  // Check in docs directory
  const docsDir = path.join(dir, 'docs');
  const docsExists = await fs
    .access(docsDir)
    .then(() => true)
    .catch(() => false);
  if (docsExists) {
    for (const name of possibleNames) {
      const filePath = path.join(docsDir, name);
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        return filePath;
      }
    }
  }

  return null;
}

function extractRelevantSections(
  content: string,
  fromVersion: string,
  toVersion: string
): string | null {
  const lines = content.split('\n');
  const relevantLines: string[] = [];
  let inRelevantSection = false;
  let foundAnyVersion = false;

  for (const line of lines) {
    // Check if this is a version header
    const versionRegex = /^#+\s*v?(\d+\.\d+\.\d+)/;
    const versionMatch = versionRegex.exec(line);
    if (versionMatch) {
      const version = normalizeVersion(versionMatch[1]);
      if (!version) continue;

      foundAnyVersion = true;

      // Check if this version is in our range
      if (semver.gt(version, fromVersion) && semver.lte(version, toVersion)) {
        inRelevantSection = true;
        relevantLines.push(line);
      } else if (semver.lte(version, fromVersion)) {
        // We've gone past our range
        break;
      } else {
        inRelevantSection = false;
      }
    } else if (inRelevantSection) {
      relevantLines.push(line);
    }
  }

  if (!foundAnyVersion || relevantLines.length === 0) {
    return null;
  }

  return relevantLines.join('\n').trim();
}

function normalizeVersion(version: string): string | null {
  const cleaned = version.replace(/^v/, '');

  // Try to coerce to valid semver if it's not already valid
  const valid = semver.valid(cleaned);
  if (valid) {
    return valid;
  }

  // Try to coerce partial versions (e.g., "16" -> "16.0.0", "16.2" -> "16.2.0")
  const coerced = semver.coerce(cleaned);
  if (coerced) {
    return coerced.version;
  }

  return null;
}

function detectPackageType(packageName: string): 'javascript' | 'python' | 'unknown' {
  // Common Python package patterns
  const pythonPatterns = [
    /^(django|flask|numpy|pandas|scipy|matplotlib|requests|pytest|pylint|black|mypy|flake8|poetry|setuptools|pip|wheel)/i,
    /^(tensorflow|torch|keras|scikit-learn|jupyter|ipython|beautifulsoup|selenium|sqlalchemy|celery|redis|pymongo)/i,
    /^(lxml|pillow|cryptography|pyyaml|boto3|aiohttp|fastapi|pydantic|uvicorn|gunicorn)/i,
  ];

  // Check if it matches Python patterns
  for (const pattern of pythonPatterns) {
    if (pattern.test(packageName)) {
      return 'python';
    }
  }

  // Check for Python-style naming (underscore instead of hyphen)
  if (packageName.includes('_') && !packageName.includes('-')) {
    return 'python';
  }

  // Default to JavaScript for now
  return 'javascript';
}

type PyPIPackageInfo = {
  info?: {
    project_urls?: Record<string, string>;
    home_page?: string;
  };
};

async function fetchFromPyPI(packageUpdate: PackageUpdate): Promise<ChangelogDiff | null> {
  try {
    // Fetch package info from PyPI
    const packageName = packageUpdate.name.toLowerCase();
    const response = await httpGet<unknown>(`https://pypi.org/pypi/${packageName}/json`);

    if (!response.ok || !response.data) {
      return null;
    }

    const data = response.data as PyPIPackageInfo;

    // Try to find GitHub URL from project URLs
    const projectUrls = data.info?.project_urls || {};
    let githubUrl = null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [_key, url] of Object.entries(projectUrls)) {
      if (typeof url === 'string' && url.includes('github.com')) {
        githubUrl = url;
        break;
      }
    }

    // Also check home_page
    if (!githubUrl && data.info?.home_page?.includes('github.com')) {
      githubUrl = data.info.home_page;
    }

    // If we found a GitHub URL, try to fetch changelog from there
    if (githubUrl) {
      const githubRegex = /github\.com\/([^/]+)\/([^/]+)/;
      const match = githubRegex.exec(githubUrl);
      if (match) {
        const githubInfo = { owner: match[1], repo: match[2].replace(/\.git$/, '') };
        // Use the existing GitHub releases fetcher with custom package name format
        const githubPackageUpdate = {
          ...packageUpdate,
          name: `${githubInfo.owner}/${githubInfo.repo}`,
        };
        return await fetchFromGitHubReleases(githubPackageUpdate);
      }
    }

    // Try to extract from package description or release notes
    // const fromRelease = data.releases?.[packageUpdate.fromVersion]?.[0];
    const toRelease = (
      data as unknown as { releases?: Record<string, Array<{ description?: string }>> }
    ).releases?.[packageUpdate.toVersion]?.[0];

    if (toRelease?.description) {
      // PyPI descriptions often contain changelog info
      return {
        source: 'PyPI',
        content: `# ${packageUpdate.name} Changelog\n\n## Version ${packageUpdate.toVersion}\n\n${toRelease.description}`,
        fromVersion: packageUpdate.fromVersion,
        toVersion: packageUpdate.toVersion,
      };
    }

    return null;
  } catch (error) {
    loggers.genericFailed('fetch from PyPI', error);
    return null;
  }
}
