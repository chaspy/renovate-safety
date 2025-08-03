/**
 * Common version utilities
 * Provides centralized version comparison and manipulation functions
 */

import semver from 'semver';

/**
 * Compare two version strings
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  // Try semver comparison first
  try {
    const cleanA = semver.clean(a);
    const cleanB = semver.clean(b);

    if (cleanA && cleanB) {
      return semver.compare(cleanA, cleanB);
    }
  } catch {
    // Fallback to simple comparison
  }

  // Fallback to simple numeric comparison
  const aParts = a.split('.').map((p) => parseInt(p) || 0);
  const bParts = b.split('.').map((p) => parseInt(p) || 0);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;

    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }

  return 0;
}

/**
 * Normalize version string by removing common prefixes
 */
export function normalizeVersion(version: string): string {
  return version.replace(/^v/, '');
}

/**
 * Check if a version is in range (exclusive of from, inclusive of to)
 */
export function isVersionInRange(version: string, fromVersion: string, toVersion: string): boolean {
  const versionCompare = compareVersions(version, fromVersion);
  const toCompare = compareVersions(version, toVersion);

  return versionCompare > 0 && toCompare <= 0;
}

/**
 * Sort versions in descending order (newest first)
 */
export function sortVersionsDescending(versions: string[]): string[] {
  return versions.sort((first, second) => compareVersions(second, first));
}

/**
 * Extract version from various formats (e.g., package@version, v1.2.3)
 */
export function extractVersion(versionString: string): string | null {
  // Handle package@version format
  const atIndex = versionString.lastIndexOf('@');
  if (atIndex > 0) {
    return versionString.substring(atIndex + 1);
  }

  // Handle v-prefix
  if (versionString.startsWith('v')) {
    return versionString.substring(1);
  }

  // Return as-is if it looks like a version
  if (/^\d+\.\d+/.test(versionString)) {
    return versionString;
  }

  return null;
}
