import { createHash } from 'crypto';
import type { PackageUpdate } from '../types/index.js';

/**
 * Generate a secure cache key using SHA-256 (instead of weaker MD5/SHA1)
 * for package updates to avoid SonarCloud security hotspots
 */
export function generatePackageCacheKey(packageUpdate: PackageUpdate, prefix = ''): string {
  const key = prefix
    ? `${prefix}-${packageUpdate.name}@${packageUpdate.fromVersion}->${packageUpdate.toVersion}`
    : `${packageUpdate.name}@${packageUpdate.fromVersion}->${packageUpdate.toVersion}`;

  // Use SHA-256 instead of SHA1/MD5 for better security
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a secure cache key for arbitrary content using SHA-256
 */
export function generateCacheKey(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Generate a secure cache key with multiple parameters
 */
export function generateMultiParamCacheKey(
  type: string,
  packageName: string,
  version: string,
  ...additionalParams: string[]
): string {
  const params = [type, packageName, version, ...additionalParams].join(':');
  return createHash('sha256').update(params).digest('hex');
}

