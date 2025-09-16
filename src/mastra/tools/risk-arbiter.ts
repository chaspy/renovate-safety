import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  analyzeVersionJump,
  determineDiffDepth,
  determineMigrationComplexity,
  calculateBaseRiskScore,
} from '../../lib/risk-assessment-utils.js';

// Input schema for risk assessment
const inputSchema = z.object({
  packageName: z.string().describe('Package name to assess'),
  fromVersion: z.string().describe('Current version'),
  toVersion: z.string().describe('Target version'),
  isDevDependency: z.boolean().default(false).describe('Whether this is a devDependency'),
  isTypeDefinition: z.boolean().optional().describe('Whether this is a @types/* package'),
  isLockfileOnly: z.boolean().default(false).describe('Whether this is a lockfile-only change'),
  breakingChanges: z.array(z.string()).default([]).describe('List of breaking changes detected'),
  usageCount: z.number().default(0).describe('Number of usage locations in the codebase'),
  hasChangelog: z.boolean().default(false).describe('Whether changelog is available'),
  hasDiff: z.boolean().default(false).describe('Whether diff is available'),
  testCoverage: z.number().default(0).describe('Test coverage percentage'),
  criticalPathUsage: z.boolean().default(false).describe('Whether used in critical paths'),
});

// Output schema
const outputSchema = z.object({
  level: z.enum(['safe', 'low', 'medium', 'high', 'critical']),
  score: z.number(),
  factors: z.array(z.string()),
  confidence: z.number(),
  mitigationSteps: z.array(z.string()),
  estimatedEffort: z.enum(['none', 'minimal', 'moderate', 'significant', 'unknown']),
  testingScope: z.enum(['none', 'unit', 'integration', 'full regression', 'full regression recommended']),
});

export const riskArbiterTool = createTool({
  id: 'risk-arbiter',
  description: 'Assess risk level of package updates with enhanced logic for @types/* and lockfile-only changes',
  inputSchema,
  outputSchema,
  
  execute: async ({ context: {
    packageName,
    fromVersion,
    toVersion,
    isDevDependency,
    isTypeDefinition = packageName.startsWith('@types/'),
    isLockfileOnly,
    breakingChanges,
    usageCount,
    hasChangelog,
    hasDiff,
    testCoverage,
    criticalPathUsage,
  } }) => {

    // Analyze version jump
    const versionJump = analyzeVersionJump(fromVersion, toVersion);
    
    // Build risk factors
    const factors = {
      versionJump,
      usage: {
        directUsageCount: usageCount,
        criticalPathUsage,
        testCoverage,
      },
      confidence: {
        changelogAvailable: hasChangelog,
        diffAnalysisDepth: determineDiffDepth(hasChangelog, hasDiff),
        communitySignals: 0,
      },
      packageSpecific: {
        breakingChangePatterns: breakingChanges,
        knownIssues: [],
        migrationComplexity: determineMigrationComplexity(breakingChanges, usageCount),
        isTypeDefinition,
        isDevDependency,
        isLockfileOnly,
      },
    };

    // Calculate risk score
    const score = calculateRiskScore(factors);
    
    // Determine risk level
    const level = determineRiskLevel(score, factors);
    
    // Generate other outputs
    const factorDescriptions = generateRiskFactorDescriptions(factors, level);
    const confidence = calculateConfidence(factors);
    const mitigationSteps = generateMitigationSteps(factors, level, breakingChanges);
    const estimatedEffort = estimateEffort(factors, level);
    const testingScope = determineTestingScope(factors, level);

    return {
      level,
      score,
      factors: factorDescriptions,
      confidence,
      mitigationSteps,
      estimatedEffort,
      testingScope,
    };
  },
});

// These functions are now imported from risk-assessment-utils.ts

function calculateRiskScore(factors: any): number {
  // Use the shared base calculation
  return calculateBaseRiskScore(factors);
}

function determineRiskLevel(score: number, factors: any): 'safe' | 'low' | 'medium' | 'high' | 'critical' {
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

  // Adjusted thresholds for better calibration
  if (score <= 1) return 'safe'; // Very low score is safe
  if (score <= 10) return 'low'; // Keep existing threshold
  if (score < 30) return 'medium';
  if (score < 50) return 'high';
  if (score >= 50) return 'critical';
  return 'medium'; // Default to medium if somehow we get here
}

function calculateConfidence(factors: any): number {
  let confidence = 0;

  if (factors.confidence.changelogAvailable) confidence += 0.4;
  if (factors.confidence.diffAnalysisDepth === 'full') confidence += 0.4;
  else if (factors.confidence.diffAnalysisDepth === 'partial') confidence += 0.2;

  if (factors.usage.testCoverage > 50) confidence += 0.2;

  return Math.min(confidence, 1);
}

function generateRiskFactorDescriptions(factors: any, _level: string): string[] {
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

  // Special flags
  if (factors.packageSpecific.isTypeDefinition) {
    descriptions.push('Type definitions package (@types/*)');
  }

  if (factors.packageSpecific.isDevDependency) {
    descriptions.push('Development dependency');
  }

  if (factors.packageSpecific.isLockfileOnly) {
    descriptions.push('Lockfile-only change');
  }

  // Confidence
  if (factors.confidence.diffAnalysisDepth === 'none') {
    descriptions.push('Limited information available');
  }

  // Test coverage
  if (factors.usage.testCoverage > 70) {
    descriptions.push(`Good test coverage (${Math.round(factors.usage.testCoverage)}%)`);
  } else if (factors.usage.testCoverage < 30 && factors.usage.directUsageCount > 0) {
    descriptions.push(`Low test coverage (${Math.round(factors.usage.testCoverage)}%)`);
  }

  return descriptions;
}

function estimateEffort(factors: any, level: string): 'none' | 'minimal' | 'moderate' | 'significant' | 'unknown' {
  if (level === 'safe') return 'none';

  const complexity = factors.packageSpecific.migrationComplexity;
  const usageCount = factors.usage.directUsageCount;

  if (level === 'critical' || complexity === 'complex') return 'significant';
  if (level === 'high' || complexity === 'moderate') return 'moderate';
  if (level === 'medium' && usageCount > 5) return 'moderate';
  if (level === 'medium') return 'minimal';
  return 'minimal';
}

function determineTestingScope(
  factors: any,
  level: string
): 'none' | 'unit' | 'integration' | 'full regression' | 'full regression recommended' {
  if (level === 'safe') return 'none';

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
  factors: any,
  level: string,
  breakingChanges: string[]
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
    if (change.includes('removed') || change.includes('deleted')) {
      steps.push(`Replace removed functionality: ${change.substring(0, 50)}...`);
    } else if (change.includes('renamed')) {
      steps.push(`Update renamed APIs: ${change.substring(0, 50)}...`);
    }
  });

  // Rollback plan
  if (level === 'high' || level === 'critical') {
    steps.push('Prepare rollback plan in case of issues');
  }

  return steps;
}

// Convenience class for static method access
export class RiskArbiter {
  static async assess(input: z.infer<typeof inputSchema>) {
    return await riskArbiterTool.execute({
      context: input,
      runtimeContext: undefined as any,
    });
  }
}