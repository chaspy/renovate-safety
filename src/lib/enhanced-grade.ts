import type { PackageUpdate, RiskAssessment, BreakingChange, LLMSummary } from '../types/index.js';
import type { UsageAnalysis } from '../analyzers/base.js';
import {
  analyzeVersionJump,
  determineDiffDepth,
  determineMigrationComplexity,
  calculateBaseRiskScore,
  isTypeDefinitionPackage,
  VersionJump,
} from './risk-assessment-utils.js';

export interface RiskFactors {
  versionJump: VersionJump;
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

  // Usage analysis with improved critical path detection
  const usage = {
    directUsageCount: usageAnalysis?.productionUsageCount || 0,
    criticalPathUsage: determineCriticalPathUsage(usageAnalysis),
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
    // Feature tracked in Issue #20 - GitHub API integration for file change analysis
    // Will enable lockfile-only detection through PR file changes
    isLockfileOnly: false, // Will be enhanced when we have access to file changes
  };

  return { versionJump, usage, confidence, packageSpecific };
}

// analyzeVersionJump is now imported from risk-assessment-utils.ts

function determineCriticalPathUsage(usageAnalysis: UsageAnalysis | null): boolean {
  if (!usageAnalysis?.criticalPaths) return false;

  // Consider it critical if used in key entry point files
  const criticalFilePatterns = [
    /index\.[jt]sx?$/,
    /main\.[jt]sx?$/,
    /app\.[jt]sx?$/,
    /server\.[jt]sx?$/,
    /handler\.[jt]sx?$/,
    /api\/.*\.[jt]sx?$/,
    /routes\/.*\.[jt]sx?$/,
    /src\/(?:index|main|app)\.[jt]sx?$/,
  ];

  // Check if any critical path matches key patterns
  const hasCriticalFiles = usageAnalysis.criticalPaths.some((path) =>
    criticalFilePatterns.some((pattern) => pattern.test(path))
  );

  // Also consider it critical if used in multiple production files
  const multipleProductionFiles = usageAnalysis.productionUsageCount >= 3;

  return hasCriticalFiles || multipleProductionFiles;
}

function estimateTestCoverage(usageAnalysis: UsageAnalysis | null): number {
  if (!usageAnalysis) return 0;

  const { productionUsageCount, testUsageCount } = usageAnalysis;
  if (productionUsageCount === 0) return 100;

  // Improved heuristic: consider test coverage as percentage of production code tested
  // Not just ratio, but whether tests exist at all
  if (testUsageCount === 0) return 0;
  if (testUsageCount > 0 && productionUsageCount > 0) {
    // Assume ~30% coverage per test file that uses the package
    return Math.min(30 + testUsageCount * 10, 80);
  }
  return 50; // Default moderate coverage
}

// determineDiffDepth and determineMigrationComplexity are now imported from risk-assessment-utils.ts

function calculateRiskScore(factors: RiskFactors): number {
  // Use the shared base calculation
  return calculateBaseRiskScore(factors);
}

function determineRiskLevel(score: number, factors: RiskFactors): RiskAssessment['level'] {
  // Check for type definition package special cases
  const typeDefLevel = getTypeDefinitionRiskLevel(factors, score);
  if (typeDefLevel) {
    return typeDefLevel;
  }

  // Check if we have insufficient information
  if (hasInsufficientInformation(factors)) {
    return 'unknown';
  }

  // Return risk level based on score thresholds
  return getRiskLevelByScore(score);
}

function getTypeDefinitionRiskLevel(
  factors: RiskFactors,
  score: number
): RiskAssessment['level'] | null {
  if (!factors.packageSpecific.isTypeDefinition) {
    return null;
  }

  // @types/* patch updates are always safe
  if (isPatchOnlyUpdate(factors.versionJump)) {
    return 'safe';
  }

  // @types/* minor updates are low risk at most
  if (isMinorOnlyUpdate(factors.versionJump)) {
    return score <= 10 ? 'safe' : 'low';
  }

  return null;
}

function isPatchOnlyUpdate(versionJump: VersionJump): boolean {
  return versionJump.patch > 0 && versionJump.major === 0 && versionJump.minor === 0;
}

function isMinorOnlyUpdate(versionJump: VersionJump): boolean {
  return versionJump.minor > 0 && versionJump.major === 0;
}

function hasInsufficientInformation(factors: RiskFactors): boolean {
  return (
    factors.confidence.diffAnalysisDepth === 'none' &&
    factors.packageSpecific.breakingChangePatterns.length === 0 &&
    !factors.packageSpecific.isTypeDefinition
  );
}

function getRiskLevelByScore(score: number): RiskAssessment['level'] {
  if (score <= 1) return 'safe';
  if (score <= 10) return 'low';
  if (score < 30) return 'medium';
  if (score < 50) return 'high';
  return 'critical';
}

function calculateConfidence(factors: RiskFactors): number {
  let confidence = 0;

  if (factors.confidence.changelogAvailable) confidence += 0.4;
  if (factors.confidence.diffAnalysisDepth === 'full') confidence += 0.4;
  else if (factors.confidence.diffAnalysisDepth === 'partial') confidence += 0.2;

  if (factors.usage.testCoverage > 50) confidence += 0.2;

  return Math.min(confidence, 1);
}

// isTypeDefinitionPackage is now imported from risk-assessment-utils.ts

// Feature tracked in Issue #20 - GitHub API integration pending
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
