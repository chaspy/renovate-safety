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
    knownIssues: any[];
    migrationComplexity: 'simple' | 'moderate' | 'complex';
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
    mitigationSteps: generateMitigationSteps(factors, level, breakingChanges)
  };
}

function calculateRiskFactors(
  packageUpdate: PackageUpdate,
  breakingChanges: BreakingChange[],
  usageAnalysis: UsageAnalysis | null,
  llmSummary: LLMSummary | null,
  hasChangelog: boolean,
  hasDiff: boolean
): RiskFactors {
  // Version jump analysis
  const versionJump = analyzeVersionJump(packageUpdate.fromVersion, packageUpdate.toVersion);
  
  // Usage analysis
  const usage = {
    directUsageCount: usageAnalysis?.productionUsageCount || 0,
    criticalPathUsage: usageAnalysis?.criticalPaths.length > 0,
    testCoverage: estimateTestCoverage(usageAnalysis)
  };

  // Confidence analysis
  const confidence = {
    changelogAvailable: hasChangelog,
    diffAnalysisDepth: determineDiffDepth(hasChangelog, hasDiff),
    communitySignals: 0 // Could be enhanced with GitHub stars, issues, etc.
  };

  // Package-specific analysis
  const packageSpecific = {
    breakingChangePatterns: breakingChanges.map(bc => bc.line),
    knownIssues: [],
    migrationComplexity: determineMigrationComplexity(breakingChanges, usage.directUsageCount)
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
      patch: semver.patch(to) - semver.patch(from)
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
  
  return Math.max(0, Math.min(100, score));
}

function determineRiskLevel(score: number, factors: RiskFactors): RiskAssessment['level'] {
  // If we have no information, return unknown
  if (factors.confidence.diffAnalysisDepth === 'none' && 
      factors.packageSpecific.breakingChangePatterns.length === 0) {
    return 'unknown' as any; // Type assertion for now
  }
  
  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'medium';
  if (score >= 10) return 'low';
  return 'safe';
}

function calculateConfidence(factors: RiskFactors): number {
  let confidence = 0;
  
  if (factors.confidence.changelogAvailable) confidence += 0.4;
  if (factors.confidence.diffAnalysisDepth === 'full') confidence += 0.4;
  else if (factors.confidence.diffAnalysisDepth === 'partial') confidence += 0.2;
  
  if (factors.usage.testCoverage > 50) confidence += 0.2;
  
  return Math.min(confidence, 1);
}

function generateRiskFactorDescriptions(factors: RiskFactors, level: string): string[] {
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

function estimateEffort(factors: RiskFactors, level: string): string {
  if (level === 'safe') return 'none';
  if (level === 'unknown') return 'unknown';
  
  const complexity = factors.packageSpecific.migrationComplexity;
  const usageCount = factors.usage.directUsageCount;
  
  if (level === 'critical' || complexity === 'complex') return 'significant (1-2 days)';
  if (level === 'high' || complexity === 'moderate') return 'moderate (2-4 hours)';
  if (level === 'medium' && usageCount > 5) return 'moderate (2-4 hours)';
  if (level === 'medium') return 'minimal (30-60 minutes)';
  return 'minimal (< 30 minutes)';
}

function determineTestingScope(factors: RiskFactors, level: string): string {
  if (level === 'safe') return 'none';
  if (level === 'unknown') return 'full regression recommended';
  
  if (factors.usage.criticalPathUsage || level === 'critical') {
    return 'full regression';
  }
  
  if (level === 'high' || factors.usage.directUsageCount > 10) {
    return 'integration + affected features';
  }
  
  if (level === 'medium') {
    return 'affected features';
  }
  
  return 'unit tests';
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
  breakingChanges.slice(0, 3).forEach(change => {
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