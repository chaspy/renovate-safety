import type { PackageUpdate, RiskAssessment, BreakingChange, LLMSummary } from '../types/index.js';
import type { UsageAnalysis } from '../analyzers/base.js';
import semver from 'semver';

export interface RiskFactors {
  versionJump: {
    major: number;
    minor: number;
    patch: number;
  };
  usage: {
    directUsageCount: number;
    criticalPathUsage: boolean;
    testCoverage: number;
  };
  confidence: {
    changelogAvailable: boolean;
    diffAnalysisDepth: 'full' | 'partial' | 'none';
    communitySignals: number;
  };
  packageSpecific: {
    breakingChangePatterns: string[];
    knownIssues: unknown[];
    migrationComplexity: 'simple' | 'moderate' | 'complex';
    isTypeDefinition?: boolean;
    isDevDependency?: boolean;
    isLockfileOnly?: boolean;
  };
}

export interface EnhancedRiskAssessment extends RiskAssessment {
  confidence: number;
  detailedFactors: RiskFactors;
  mitigationSteps?: string[];
}

export async function assessEnhancedRisk(
  packageUpdate: PackageUpdate,
  breakingChanges: BreakingChange[],
  usageAnalysis: UsageAnalysis | null,
  llmSummary: LLMSummary | null,
  hasChangelog: boolean,
  hasDiff: boolean
): Promise<EnhancedRiskAssessment> {
  const factors = calculateRiskFactors(
    packageUpdate,
    breakingChanges,
    usageAnalysis,
    llmSummary,
    hasChangelog,
    hasDiff
  );

  const riskScore = calculateRiskScore(factors);
  const level = determineRiskLevel(riskScore, factors);

  return {
    level,
    factors: generateRiskFactorDescriptions(factors, level),
    estimatedEffort: estimateEffort(factors, level),
    testingScope: determineTestingScope(factors, level),
    confidence: calculateConfidence(factors),
    detailedFactors: factors,
    mitigationSteps: generateMitigationSteps(factors, level, breakingChanges),
  };
}

function calculateRiskFactors(
  packageUpdate: PackageUpdate,
  breakingChanges: BreakingChange[],
  usageAnalysis: UsageAnalysis | null,
  _llmSummary: LLMSummary | null,
  hasChangelog: boolean,
  hasDiff: boolean
): RiskFactors {
  // Version jump analysis
  const versionJump = analyzeVersionJump(packageUpdate.fromVersion, packageUpdate.toVersion);

  // Usage analysis
  const usage = {
    directUsageCount: usageAnalysis?.productionUsageCount || 0,
    criticalPathUsage: (usageAnalysis?.criticalPaths?.length || 0) > 0,
    testCoverage: estimateTestCoverage(usageAnalysis),
  };

  // Confidence analysis
  const confidence = {
    changelogAvailable: hasChangelog,
    diffAnalysisDepth: determineDiffDepth(hasChangelog, hasDiff),
    communitySignals: 0, // Could be enhanced with GitHub stars, issues, etc.
  };

  // Package-specific analysis
  const packageSpecific = {
    breakingChangePatterns: breakingChanges.map((bc) => bc.line),
    knownIssues: [],
    migrationComplexity: determineMigrationComplexity(breakingChanges, usage.directUsageCount),
    isTypeDefinition: isTypeDefinitionPackage(packageUpdate.name),
    isDevDependency: false, // Will be enhanced when we have access to package.json context
    // TODO: Issue #20 - GitHub API統合で実装予定
    // PRのfile changesを解析してlockfile-onlyを判定
    isLockfileOnly: false, // Will be enhanced when we have access to file changes
  };

  return { versionJump, usage, confidence, packageSpecific };
}

function analyzeVersionJump(fromVersion: string, toVersion: string): RiskFactors['versionJump'] {
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

function estimateTestCoverage(usageAnalysis: UsageAnalysis | null): number {
  if (!usageAnalysis) return 0;

  const { productionUsageCount, testUsageCount } = usageAnalysis;
  if (productionUsageCount === 0) return 100;

  // Simple heuristic: ratio of test usage to production usage
  const ratio = testUsageCount / productionUsageCount;
  return Math.min(ratio * 100, 100);
}

function determineDiffDepth(hasChangelog: boolean, hasDiff: boolean): 'full' | 'partial' | 'none' {
  if (hasChangelog && hasDiff) return 'full';
  if (hasChangelog || hasDiff) return 'partial';
  return 'none';
}

function determineMigrationComplexity(
  breakingChanges: BreakingChange[],
  usageCount: number
): 'simple' | 'moderate' | 'complex' {
  if (breakingChanges.length === 0) return 'simple';
  if (breakingChanges.length > 5 || usageCount > 20) return 'complex';
  if (breakingChanges.length > 2 || usageCount > 10) return 'moderate';
  return 'simple';
}

function calculateRiskScore(factors: RiskFactors): number {
  let score = 0;

  // Version jump impact (0-40 points)
  score += factors.versionJump.major * 20;
  score += factors.versionJump.minor * 5;
  score += factors.versionJump.patch * 1;

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

  // Special handling for @types/* packages - apply reduction after all calculations
  if (factors.packageSpecific.isTypeDefinition) {
    // @types/* packages have much lower risk
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
      score *= 0.3; // More aggressive reduction for @types/* packages
    }
  }

  // DevDependencies have lower risk
  if (factors.packageSpecific.isDevDependency) {
    score -= 1;
  }

  // Lockfile-only changes have significantly lower risk
  if (factors.packageSpecific.isLockfileOnly) {
    // Lockfile-only changes are capped at score 10 (LOW risk threshold)
    // This ensures lockfile-only changes are never higher than LOW risk
    score = Math.min(score * 0.3, 10);
  }

  return Math.max(0, Math.min(100, score));
}

function determineRiskLevel(score: number, factors: RiskFactors): RiskAssessment['level'] {
  // Special handling for @types/* packages
  if (factors.packageSpecific.isTypeDefinition) {
    // @types/* patch updates are always safe
    if (
      factors.versionJump.patch > 0 &&
      factors.versionJump.major === 0 &&
      factors.versionJump.minor === 0
    ) {
      return 'safe';
    }
    // @types/* minor updates are low risk at most
    if (factors.versionJump.minor > 0 && factors.versionJump.major === 0) {
      return score <= 10 ? 'safe' : 'low';
    }
  }

  // If we have no information and it's not a special package, return unknown
  if (
    factors.confidence.diffAnalysisDepth === 'none' &&
    factors.packageSpecific.breakingChangePatterns.length === 0 &&
    !factors.packageSpecific.isTypeDefinition
  ) {
    return 'unknown'; // 'unknown' is valid RiskAssessment level
  }

  // Adjusted thresholds for better calibration
  if (score <= 1) return 'safe'; // Very low score is safe
  if (score <= 3) return 'low'; // Low score is low risk
  if (score <= 10) return 'low'; // Keep existing threshold
  if (score < 30) return 'medium';
  if (score < 50) return 'high';
  if (score >= 50) return 'critical';
  return 'medium'; // Default to medium if somehow we get here
}

function calculateConfidence(factors: RiskFactors): number {
  let confidence = 0;

  if (factors.confidence.changelogAvailable) confidence += 0.4;
  if (factors.confidence.diffAnalysisDepth === 'full') confidence += 0.4;
  else if (factors.confidence.diffAnalysisDepth === 'partial') confidence += 0.2;

  if (factors.usage.testCoverage > 50) confidence += 0.2;

  return Math.min(confidence, 1);
}

function isTypeDefinitionPackage(packageName: string): boolean {
  return packageName.startsWith('@types/');
}

// TODO: Issue #20 - GitHub API統合で実装予定
// PRのfile changesを取得して、lockfile-onlyの変更かを判定する
// function isLockfileOnlyChange(files: string[]): boolean {
//   return files.every(f => 
//     f.endsWith('package-lock.json') ||
//     f.endsWith('yarn.lock') ||
//     f.endsWith('pnpm-lock.yaml')
//   );
// }

function generateRiskFactorDescriptions(factors: RiskFactors, _level: string): string[] {
  const descriptions: string[] = [];

  // Version jump
  if (factors.versionJump.major > 0) {
    descriptions.push(`Major version upgrade (${factors.versionJump.major} major versions)`);
  } else if (factors.versionJump.minor > 0) {
    descriptions.push(`Minor version upgrade (${factors.versionJump.minor} minor versions)`);
  }

  // Breaking changes
  const breakingCount = factors.packageSpecific.breakingChangePatterns.length;
  if (breakingCount > 0) {
    descriptions.push(`${breakingCount} breaking changes detected`);
  }

  // Usage
  if (factors.usage.directUsageCount > 0) {
    descriptions.push(`Used in ${factors.usage.directUsageCount} production locations`);
  }

  if (factors.usage.criticalPathUsage) {
    descriptions.push('Used in critical paths');
  }

  // Confidence
  if (factors.confidence.diffAnalysisDepth === 'none') {
    descriptions.push('Limited information available (no changelog or diff)');
  }

  // Test coverage
  if (factors.usage.testCoverage > 70) {
    descriptions.push(`Good test coverage (${Math.round(factors.usage.testCoverage)}%)`);
  } else if (factors.usage.testCoverage < 30 && factors.usage.directUsageCount > 0) {
    descriptions.push(`Low test coverage (${Math.round(factors.usage.testCoverage)}%)`);
  }

  return descriptions;
}

function estimateEffort(factors: RiskFactors, level: string): RiskAssessment['estimatedEffort'] {
  if (level === 'safe') return 'none';
  if (level === 'unknown') return 'unknown';

  const complexity = factors.packageSpecific.migrationComplexity;
  const usageCount = factors.usage.directUsageCount;

  if (level === 'critical' || complexity === 'complex') return 'significant';
  if (level === 'high' || complexity === 'moderate') return 'moderate';
  if (level === 'medium' && usageCount > 5) return 'moderate';
  if (level === 'medium') return 'minimal';
  return 'minimal';
}

function determineTestingScope(
  factors: RiskFactors,
  level: string
): RiskAssessment['testingScope'] {
  if (level === 'safe') return 'none';
  if (level === 'unknown') return 'full regression recommended';

  if (factors.usage.criticalPathUsage || level === 'critical') {
    return 'full regression';
  }

  if (level === 'high' || factors.usage.directUsageCount > 10) {
    return 'integration';
  }

  if (level === 'medium') {
    return 'unit';
  }

  return 'unit';
}

function generateMitigationSteps(
  factors: RiskFactors,
  level: string,
  breakingChanges: BreakingChange[]
): string[] {
  const steps: string[] = [];

  // Information gathering steps
  if (factors.confidence.diffAnalysisDepth === 'none') {
    steps.push('Review package documentation for migration guide');
    steps.push('Check GitHub issues for known problems');
  }

  // Testing steps
  if (factors.usage.testCoverage < 50 && factors.usage.directUsageCount > 0) {
    steps.push('Add tests for affected functionality before upgrading');
  }

  // Migration steps
  if (factors.versionJump.major > 0) {
    steps.push('Review breaking changes in release notes');
    steps.push('Update code to accommodate API changes');
  }

  // Specific breaking change steps
  breakingChanges.slice(0, 3).forEach((change) => {
    if (change.line.includes('removed') || change.line.includes('deleted')) {
      steps.push(`Replace removed functionality: ${change.line.substring(0, 50)}...`);
    } else if (change.line.includes('renamed')) {
      steps.push(`Update renamed APIs: ${change.line.substring(0, 50)}...`);
    }
  });

  // Rollback plan
  if (level === 'high' || level === 'critical') {
    steps.push('Prepare rollback plan in case of issues');
  }

  return steps;
}
