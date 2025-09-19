import type {
  BreakingChange,
  APIUsage,
  LLMSummary,
  RiskLevel,
  RiskAssessment,
  PackageUpdate,
} from '../types/index.js';

type RiskFactors = {
  hasBreakingChanges: boolean;
  breakingChangeCount: number;
  hasHighSeverityChanges: boolean;
  hasAPIUsage: boolean;
  apiUsageCount: number;
  llmIdentifiedBreaking: boolean;
  llmBreakingCount: number;
  isMajorVersionUpdate: boolean;
  hasChangelogData: boolean;
};

export async function assessRisk(
  breakingChanges: BreakingChange[],
  apiUsages: APIUsage[],
  llmSummary: LLMSummary | null,
  packageUpdate?: PackageUpdate,
  hasChangelog?: boolean
): Promise<RiskAssessment> {
  const factors = await calculateRiskFactors(
    breakingChanges,
    apiUsages,
    llmSummary,
    packageUpdate,
    hasChangelog
  );
  const riskFactors: string[] = [];
  let level: RiskLevel = 'safe';
  let estimatedEffort: RiskAssessment['estimatedEffort'] = 'none';
  let testingScope: RiskAssessment['testingScope'] = 'none';

  // Critical risk conditions
  if (factors.hasAPIUsage && factors.hasHighSeverityChanges && factors.apiUsageCount > 10) {
    level = 'critical';
    riskFactors.push(`${factors.apiUsageCount} API usages with high severity breaking changes`);
    estimatedEffort = 'significant';
    testingScope = 'full';
  }
  // High risk conditions
  else if (factors.hasAPIUsage && factors.hasBreakingChanges) {
    level = 'high';
    riskFactors.push(`${factors.apiUsageCount} API usages affected by breaking changes`);
    estimatedEffort = 'moderate';
    testingScope = 'integration';
  } else if (
    factors.apiUsageCount > 5 &&
    (factors.hasBreakingChanges || factors.llmIdentifiedBreaking)
  ) {
    level = 'high';
    riskFactors.push(
      `Extensive API usage (${factors.apiUsageCount} locations) with breaking changes`
    );
    estimatedEffort = 'moderate';
    testingScope = 'integration';
  }
  // Medium risk conditions
  else if (factors.isMajorVersionUpdate && factors.hasAPIUsage) {
    level = 'medium';
    riskFactors.push('Major version update with API usage in codebase');
    estimatedEffort = 'moderate';
    testingScope = 'integration';
  } else if (factors.hasBreakingChanges || factors.llmIdentifiedBreaking) {
    level = 'low';
    riskFactors.push('Breaking changes detected but no direct API usage found');
    estimatedEffort = 'minimal';
    testingScope = 'unit';
  }
  // Low risk conditions
  else if (factors.isMajorVersionUpdate && !factors.hasChangelogData) {
    level = 'low';
    riskFactors.push('Major version update without available changelog');
    estimatedEffort = 'minimal';
    testingScope = 'unit';
  } else if (factors.isMajorVersionUpdate && factors.hasChangelogData) {
    level = 'low';
    riskFactors.push('Major version update with no detected breaking changes');
    estimatedEffort = 'minimal';
    testingScope = 'unit';
  }
  // Safe
  else {
    riskFactors.push('No breaking changes or API usage detected');
  }

  // Add additional context to risk factors
  if (factors.breakingChangeCount > 0) {
    riskFactors.push(`${factors.breakingChangeCount} breaking changes in changelog`);
  }
  if (factors.llmBreakingCount > 0) {
    riskFactors.push(`${factors.llmBreakingCount} AI-identified breaking changes`);
  }
  if (!factors.hasChangelogData) {
    riskFactors.push('No changelog data available');
  }

  return {
    level,
    factors: riskFactors,
    estimatedEffort,
    testingScope,
  };
}

async function calculateRiskFactors(
  breakingChanges: BreakingChange[],
  apiUsages: APIUsage[],
  llmSummary: LLMSummary | null,
  packageUpdate?: PackageUpdate,
  hasChangelog?: boolean
): Promise<RiskFactors> {
  const hasBreakingChanges = breakingChanges.some((change) => change.severity === 'breaking');
  const hasHighSeverityChanges = breakingChanges.some(
    (change) => change.severity === 'breaking' || change.severity === 'removal'
  );

  const llmBreakingCount = llmSummary?.breakingChanges.length || 0;
  const llmIdentifiedBreaking = llmBreakingCount > 0;

  // Check if this is a major version update
  let isMajorVersionUpdate = false;
  if (packageUpdate) {
    try {
      const semver = await import('semver');
      const fromMajor = semver.major(packageUpdate.fromVersion);
      const toMajor = semver.major(packageUpdate.toVersion);
      isMajorVersionUpdate = toMajor > fromMajor;
    } catch {
      // If semver parsing fails, fallback to false
      isMajorVersionUpdate = false;
    }
  }

  return {
    hasBreakingChanges,
    breakingChangeCount: breakingChanges.filter((c) => c.severity === 'breaking').length,
    hasHighSeverityChanges,
    hasAPIUsage: apiUsages.length > 0,
    apiUsageCount: apiUsages.length,
    llmIdentifiedBreaking,
    llmBreakingCount,
    isMajorVersionUpdate,
    hasChangelogData: hasChangelog || false,
  };
}

export function getRiskEmoji(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'safe':
      return '✅';
    case 'low':
      return '🟡';
    case 'medium':
      return '🟠';
    case 'high':
      return '🔴';
    case 'critical':
      return '🚨';
    case 'unknown':
      return '❓';
  }
}

export function getRiskColor(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'safe':
      return 'green';
    case 'low':
      return 'yellow';
    case 'medium':
      return 'orange';
    case 'high':
      return 'red';
    case 'critical':
      return 'darkred';
    case 'unknown':
      return 'gray';
  }
}

export function getRiskDescription(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'safe':
      return 'No significant risks detected. This update appears safe to merge.';
    case 'low':
      return 'Low risk update. Minor changes detected that may require minimal verification.';
    case 'medium':
      return 'Medium risk update. Some changes require targeted testing and review.';
    case 'high':
      return 'High risk update. Breaking changes will affect your codebase. Comprehensive testing required.';
    case 'critical':
      return 'Critical risk update. Extensive breaking changes affecting many parts of your codebase. Manual intervention required.';
    case 'unknown':
      return 'Unable to determine risk level. Manual review recommended.';
  }
}
