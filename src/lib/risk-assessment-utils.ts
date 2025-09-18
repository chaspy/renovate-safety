/**
 * Shared utilities for risk assessment
 * Extracted to reduce code duplication between risk-arbiter.ts and enhanced-grade.ts
 */

import semver from 'semver';

export type VersionJump {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Analyze version jump between two versions
 */
export function analyzeVersionJump(fromVersion: string, toVersion: string): VersionJump {
  try {
    const from = semver.coerce(fromVersion);
    const to = semver.coerce(toVersion);

    if (!from || !to) {
      // Fallback to simple parsing
      return { major: 1, minor: 0, patch: 0 };
    }

    return {
      major: semver.major(to) - semver.major(from),
      minor: semver.minor(to) - semver.minor(from),
      patch: semver.patch(to) - semver.patch(from),
    };
  } catch {
    return { major: 1, minor: 0, patch: 0 };
  }
}

/**
 * Determine the depth of diff analysis available
 */
export function determineDiffDepth(
  hasChangelog: boolean,
  hasDiff: boolean
): 'full' | 'partial' | 'none' {
  if (hasChangelog && hasDiff) return 'full';
  if (hasChangelog || hasDiff) return 'partial';
  return 'none';
}

/**
 * Determine migration complexity based on breaking changes and usage
 */
export function determineMigrationComplexity(
  breakingChanges: string[] | unknown[],
  usageCount: number
): 'simple' | 'moderate' | 'complex' {
  if (breakingChanges.length === 0) return 'simple';
  if (breakingChanges.length > 5 || usageCount > 20) return 'complex';
  if (breakingChanges.length > 2 || usageCount > 10) return 'moderate';
  return 'simple';
}

/**
 * Check if a package is a type definition package
 */
export function isTypeDefinitionPackage(packageName: string): boolean {
  return packageName.startsWith('@types/');
}

/**
 * Common risk score calculation logic
 */
export function calculateBaseRiskScore(factors: {
  versionJump: VersionJump;
  usage: {
    directUsageCount: number;
    criticalPathUsage: boolean;
    testCoverage: number;
  };
  confidence: {
    diffAnalysisDepth: 'full' | 'partial' | 'none';
  };
  packageSpecific: {
    breakingChangePatterns: string[] | unknown[];
    isTypeDefinition?: boolean;
    isDevDependency?: boolean;
    isLockfileOnly?: boolean;
  };
}): number {
  let score = 0;

  // Version jump impact (0-40 points)
  score += factors.versionJump.major * 20;
  score += factors.versionJump.minor * 5;
  score += Number(factors.versionJump.patch) * 1;

  // Usage impact (0-30 points)
  score += Math.min(factors.usage.directUsageCount * 2, 20);
  score += factors.usage.criticalPathUsage ? 10 : 0;

  // Breaking changes impact (0-20 points)
  score += Math.min(factors.packageSpecific.breakingChangePatterns.length * 5, 20);

  // Confidence penalty (0-10 points)
  if (factors.confidence.diffAnalysisDepth === 'none') score += 10;
  else if (factors.confidence.diffAnalysisDepth === 'partial') score += 5;

  // Test coverage mitigation (-20 to 0 points)
  score -= (factors.usage.testCoverage / 100) * 20;

  // Special handling for @types/* packages
  if (factors.packageSpecific.isTypeDefinition) {
    if (
      factors.versionJump.patch > 0 &&
      factors.versionJump.major === 0 &&
      factors.versionJump.minor === 0
    ) {
      score = Math.max(0, score - 10); // Patch updates for @types/* are very safe
    } else if (factors.versionJump.minor > 0 && factors.versionJump.major === 0) {
      score = Math.max(0, score - 5); // Minor updates for @types/* are relatively safe
    } else if (factors.versionJump.major > 0) {
      // Major updates should maintain at least LOW risk (score 10)
      score = Math.max(score * 0.3, 10);
    } else {
      // Other cases: reduce overall risk for type definitions
      score *= 0.3;
    }
  }

  // DevDependencies have lower risk
  if (factors.packageSpecific.isDevDependency) {
    score -= 1;
  }

  // Lockfile-only changes have significantly lower risk
  if (factors.packageSpecific.isLockfileOnly) {
    score = Math.min(score * 0.3, 10);
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Determine risk level based on score
 */
export function determineBaseRiskLevel(
  score: number,
  isTypeDefinition: boolean = false
): 'safe' | 'low' | 'medium' | 'high' | 'critical' {
  // Special handling for @types/* packages
  if (isTypeDefinition && score < 5) {
    return 'safe';
  }

  if (score <= 5) return 'safe';
  if (score <= 15) return 'low';
  if (score <= 30) return 'medium';
  if (score <= 50) return 'high';
  return 'critical';
}
