import type { BreakingChange, APIUsage, LLMSummary, RiskLevel } from '../types/index.js';

interface RiskFactors {
  hasBreakingChanges: boolean;
  breakingChangeCount: number;
  hasHighSeverityChanges: boolean;
  hasAPIUsage: boolean;
  apiUsageCount: number;
  llmIdentifiedBreaking: boolean;
  llmBreakingCount: number;
}

export function assessRisk(
  breakingChanges: BreakingChange[],
  apiUsages: APIUsage[],
  llmSummary: LLMSummary | null
): RiskLevel {
  const factors = calculateRiskFactors(breakingChanges, apiUsages, llmSummary);

  // High risk conditions - requires manual review
  if (factors.hasAPIUsage && factors.hasBreakingChanges) {
    return 'review';
  }

  if (factors.hasAPIUsage && factors.hasHighSeverityChanges) {
    return 'review';
  }

  if (factors.apiUsageCount > 5 && (factors.hasBreakingChanges || factors.llmIdentifiedBreaking)) {
    return 'review';
  }

  // Medium risk conditions - low risk but worth noting
  if (factors.hasBreakingChanges || factors.llmIdentifiedBreaking) {
    return 'low';
  }

  if (factors.hasHighSeverityChanges) {
    return 'low';
  }

  if (factors.hasAPIUsage && (factors.breakingChangeCount > 0 || factors.llmBreakingCount > 0)) {
    return 'low';
  }

  // Low risk - safe to proceed
  return 'safe';
}

function calculateRiskFactors(
  breakingChanges: BreakingChange[],
  apiUsages: APIUsage[],
  llmSummary: LLMSummary | null
): RiskFactors {
  const hasBreakingChanges = breakingChanges.some((change) => change.severity === 'breaking');
  const hasHighSeverityChanges = breakingChanges.some(
    (change) => change.severity === 'breaking' || change.severity === 'removal'
  );

  const llmBreakingCount = llmSummary?.breakingChanges.length || 0;
  const llmIdentifiedBreaking = llmBreakingCount > 0;

  return {
    hasBreakingChanges,
    breakingChangeCount: breakingChanges.filter((c) => c.severity === 'breaking').length,
    hasHighSeverityChanges,
    hasAPIUsage: apiUsages.length > 0,
    apiUsageCount: apiUsages.length,
    llmIdentifiedBreaking,
    llmBreakingCount,
  };
}

export function getRiskEmoji(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'safe':
      return '✅';
    case 'low':
      return '⚠️';
    case 'review':
      return '🔍';
  }
}

export function getRiskColor(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'safe':
      return 'green';
    case 'low':
      return 'yellow';
    case 'review':
      return 'red';
  }
}

export function getRiskDescription(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'safe':
      return 'No significant risks detected. This update appears safe to merge.';
    case 'low':
      return 'Low risk update. Breaking changes detected but no direct usage found in codebase.';
    case 'review':
      return 'Manual review required. Breaking changes may affect your codebase.';
  }
}
