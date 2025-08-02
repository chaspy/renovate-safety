/**
 * Common path operation utilities to reduce code duplication
 */

import { join, resolve, dirname, basename, extname } from 'path';
import { homedir } from 'os';

/**
 * Get absolute path relative to current working directory
 * @param paths Path segments to join
 * @returns Absolute path
 */
export function getProjectPath(...paths: string[]): string {
  return resolve(process.cwd(), ...paths);
}

/**
 * Get absolute path relative to home directory
 * @param paths Path segments to join
 * @returns Absolute path
 */
export function getHomePath(...paths: string[]): string {
  return join(homedir(), ...paths);
}

/**
 * Get cache directory path
 * @param paths Additional path segments within cache
 * @returns Cache directory path
 */
export function getCachePath(...paths: string[]): string {
  const cacheBase =
    process.env.RENOVATE_SAFETY_CACHE_DIR || join(homedir(), '.cache', 'renovate-safety');
  return join(cacheBase, ...paths);
}

/**
 * Get data directory path
 * @param paths Additional path segments within data
 * @returns Data directory path
 */
export function getDataPath(...paths: string[]): string {
  return join(dirname(import.meta.url), '../../data', ...paths);
}

/**
 * Normalize path for cross-platform compatibility
 * @param path Path to normalize
 * @returns Normalized path
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Get file name without extension
 * @param filePath File path
 * @returns File name without extension
 */
export function getFileNameWithoutExt(filePath: string): string {
  return basename(filePath, extname(filePath));
}

/**
 * Check if path is absolute
 * @param path Path to check
 * @returns True if path is absolute
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path);
}

/**
 * Ensure path is absolute
 * @param path Path to ensure
 * @param basePath Base path if relative (default: cwd)
 * @returns Absolute path
 */
export function ensureAbsolutePath(path: string, basePath?: string): string {
  if (isAbsolutePath(path)) {
    return path;
  }
  return resolve(basePath || process.cwd(), path);
}

/**
 * Get relative path from one path to another
 * @param from Source path
 * @param to Target path
 * @returns Relative path
 */
export function getRelativePath(from: string, to: string): string {
  const fromParts = normalizePath(resolve(from)).split('/');
  const toParts = normalizePath(resolve(to)).split('/');

  let commonLength = 0;
  for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
    if (fromParts[i] === toParts[i]) {
      commonLength++;
    } else {
      break;
    }
  }

  const upCount = fromParts.length - commonLength - 1;
  const upPath = '../'.repeat(upCount);
  const downPath = toParts.slice(commonLength).join('/');

  return upPath + downPath;
}

/**
 * Common path patterns used in the project
 */
export const PATH_PATTERNS = {
  nodeModules: 'node_modules',
  packageJson: 'package.json',
  gitignore: '.gitignore',
  readme: 'README.md',
  src: 'src',
  dist: 'dist',
  test: 'test',
  docs: 'docs',
} as const;
