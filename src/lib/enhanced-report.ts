import type { AnalysisResult, BreakingChange } from '../types/index.js';
import { packageKnowledgeBase } from './package-knowledge.js';

export async function generateEnhancedReport(
  result: AnalysisResult,
  format: 'markdown' | 'json'
): Promise<string> {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  // Generate enhanced markdown report
  let report = '# Renovate Safety Analysis Report\n\n';

  // Risk level with emoji and enhanced description
  const riskEmoji = getRiskEmoji(result.riskAssessment.level);
  const riskDescription = getRiskDescription(result.riskAssessment.level);
  report += `## ${riskEmoji} Risk Assessment: ${result.riskAssessment.level.toUpperCase()}\n`;
  report += `${riskDescription}\n\n`;

  // Package information section
  report += '### 📦 Package Update\n';
  report += `- **Package**: \`${result.package.name}\`\n`;
  report += `- **Version**: ${result.package.fromVersion} → ${result.package.toVersion}\n`;

  // Add version jump information
  const versionJump = calculateVersionJump(result.package.fromVersion, result.package.toVersion);
  if (versionJump) {
    report += `- **Version Jump**: ${versionJump}\n`;
  }

  report += `- **Changelog Source**: ${result.changelogDiff?.source || 'Not found'}\n`;
  const codeDiffStatus = result.codeDiff
    ? result.codeDiff.filesChanged + ' files changed'
    : 'Not available';
  report += `- **Code Diff**: ${codeDiffStatus}\n`;
  report += `- **Dependency Type**: ${result.dependencyUsage?.isDirect ? 'Direct' : 'Transitive'} ${result.dependencyUsage?.usageType || 'dependencies'}\n`;

  // Information confidence indicator
  const confidence = calculateConfidence(result);
  report += `- **Analysis Confidence**: ${getConfidenceIndicator(confidence)} (${Math.round(confidence * 100)}%)\n`;
  report += '\n';

  // Summary section
  if (result.llmSummary) {
    report += '### 📝 Summary\n';
    report += result.llmSummary.summary + '\n\n';

    if (result.llmSummary.breakingChanges.length > 0) {
      report += '**AI-Identified Breaking Changes:**\n';
      result.llmSummary.breakingChanges.forEach((change) => {
        report += `- ${change}\n`;
      });
      report += '\n';
    }
  }

  // Knowledge base insights
  const knowledgeInfo = await packageKnowledgeBase.getMigrationInfo(
    result.package.name,
    result.package.fromVersion,
    result.package.toVersion
  );

  if (knowledgeInfo) {
    report += '### 📚 Known Migration Information\n';
    report += `**Summary**: ${knowledgeInfo.summary}\n\n`;

    if (knowledgeInfo.migrationSteps.length > 0) {
      report += '**Migration Steps**:\n';
      knowledgeInfo.migrationSteps.forEach((step, index) => {
        report += `${index + 1}. ${step}\n`;
      });
      report += '\n';
    }
  }

  // Dependency usage with enhanced visualization
  if (result.dependencyUsage) {
    report += '### 🌳 Dependency Usage\n';
    report += `- **Type**: ${result.dependencyUsage.isDirect ? 'Direct' : 'Transitive'} dependency\n`;
    report += `- **Category**: ${result.dependencyUsage.usageType}\n`;
    report += `- **Impact**: Affects ${result.dependencyUsage.dependents.length} packages\n\n`;

    if (!result.dependencyUsage.isDirect) {
      const paths = result.dependencyUsage.dependents.slice(0, 5);
      const dependencyType = paths[0].type === 'direct' ? 'Direct' : 'Transitive';
      const displayCount = Math.min(5, result.dependencyUsage.dependents.length);
      const totalCount = result.dependencyUsage.dependents.length;
      const countSuffix = totalCount > 5 ? ' of ' + totalCount : '';

      report += `**${dependencyType} Dependencies (${displayCount}${countSuffix}):**\n`;
      paths.forEach((dep) => {
        const pathStr = dep.path.join(' → ');
        report += `- ${dep.name} (${dep.version}) - via ${pathStr}\n`;
      });
      if (totalCount > 5) {
        report += `- ... and ${totalCount - 5} more\n`;
      }
      report += '\n';
    }
  }

  // Breaking changes section
  if (result.breakingChanges.length > 0) {
    report += `### ⚠️ Breaking Changes (${result.breakingChanges.length})\n`;
    const grouped = groupBreakingChanges(result.breakingChanges);

    for (const [severity, changes] of Object.entries(grouped)) {
      if (changes.length > 0) {
        report += `\n**${severity.charAt(0).toUpperCase() + severity.slice(1)} Changes:**\n`;
        changes.forEach((change) => {
          report += `- ${formatBreakingChange(change.line)}\n`;
        });
      }
    }
    report += '\n';
  }

  // API usage analysis
  if (result.apiUsages.length > 0) {
    report += `### 🔍 API Usage Analysis\n`;
    report += `Found ${result.apiUsages.length} usage locations:\n\n`;

    // Group by file
    const byFile = groupBy(result.apiUsages, 'filePath');
    const fileList = Object.entries(byFile).slice(0, 10);

    fileList.forEach(([file, usages]) => {
      report += `**${file}** (${usages.length} usages)\n`;
      usages.slice(0, 3).forEach((usage) => {
        report += `- Line ${usage.line}: ${usage.context || usage.usageType || 'usage'}\n`;
      });
      if (usages.length > 3) {
        report += `- ... and ${usages.length - 3} more\n`;
      }
      report += '\n';
    });

    if (Object.keys(byFile).length > 10) {
      report += `... and ${Object.keys(byFile).length - 10} more files\n\n`;
    }
  }

  // Deep analysis results
  if (result.deepAnalysis) {
    report += '### 🔬 Deep Analysis Results\n';
    report += `- **Files analyzed**: ${result.deepAnalysis.totalFiles}\n`;
    report += `- **Files using package**: ${result.deepAnalysis.filesUsingPackage}\n`;
    report += `- **Test vs Production**: ${result.deepAnalysis.usageSummary.testVsProduction.test} test files, ${result.deepAnalysis.usageSummary.testVsProduction.production} production files\n`;

    if (result.deepAnalysis.usageSummary.mostUsedAPIs.length > 0) {
      report += '\n**Most Used APIs:**\n';
      result.deepAnalysis.usageSummary.mostUsedAPIs.slice(0, 5).forEach((api) => {
        report += `- \`${api.api}\`: ${api.count} usages\n`;
      });
    }
    report += '\n';
  }

  // Actionable recommendations
  report += '### 🎯 Actionable Recommendations\n\n';

  const priority = getPriorityFromRisk(result.riskAssessment.level);
  const timeRequired = getTimeEstimate(result.riskAssessment.estimatedEffort);
  const automatable = isAutomatable(result);

  report += `#### ${priority} Verification\n`;
  report += `**Priority:** ${priority} | **Time Required:** ${timeRequired} | **Automatable:** ${automatable}\n\n`;

  report += '**Actions:**\n';
  const actions = generateDetailedActions(result);
  actions.forEach((action) => {
    report += `- ${action}\n`;
  });
  report += '\n';

  // Summary and recommendation
  report += '### 💡 Summary\n';
  report += result.recommendation + '\n\n';

  // Risk analysis details
  report += '### 📊 Risk Analysis Details\n';
  report += `- **Risk Level**: ${result.riskAssessment.level}\n`;

  if (result.riskAssessment.level === 'unknown') {
    report += `- **Reason**: Insufficient information for accurate assessment\n`;
  } else {
    const description = getRiskLevelDescription(result.riskAssessment.level);
    report += `- **Description**: ${description}\n`;
  }

  report += `- **Estimated Effort**: ${result.riskAssessment.estimatedEffort}\n`;
  report += `- **Required Testing Scope**: ${result.riskAssessment.testingScope}\n`;
  report += `- **Breaking Changes Found**: ${result.breakingChanges.length}\n`;
  report += `- **API Usages Found**: ${result.apiUsages.length}\n`;
  report += `- **AI Analysis**: ${result.llmSummary ? 'Completed' : 'Skipped'}\n`;
  report += `- **Deep Analysis**: ${result.deepAnalysis ? 'Completed' : 'Disabled'}\n\n`;

  report += '**Risk Factors:**\n';
  result.riskAssessment.factors.forEach((factor) => {
    report += `- ${factor}\n`;
  });

  report += '\n---\n';
  report += '*Generated by [renovate-safety](https://github.com/chaspy/renovate-safety) v1.1.0*';

  return report;
}

function getRiskEmoji(level: string): string {
  const emojis = {
    safe: '✅',
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
    unknown: '❓',
  };
  return emojis[level as keyof typeof emojis] || '❓';
}

function getRiskDescription(level: string): string {
  const descriptions = {
    safe: 'This update appears to be safe with no breaking changes detected.',
    low: 'This update has low risk with minimal changes that should not affect your code.',
    medium: 'This update requires attention as it may contain changes affecting your code.',
    high: 'This update has significant changes that will likely require code modifications.',
    critical: 'This update contains major breaking changes requiring immediate attention.',
    unknown: 'Unable to determine risk level due to insufficient information.',
  };
  return descriptions[level as keyof typeof descriptions] || 'Risk level could not be determined.';
}

function getRiskLevelDescription(level: string): string {
  const descriptions = {
    safe: 'No breaking changes or risks detected. Safe to merge.',
    low: 'Low risk update. Minor changes detected that may require minimal verification.',
    medium: 'Medium risk update. Changes detected that require review and testing.',
    high: 'High risk update. Significant changes that require careful review and testing.',
    critical: 'Critical risk update. Major breaking changes that require extensive review.',
    unknown: 'Risk cannot be determined due to lack of information.',
  };
  return descriptions[level as keyof typeof descriptions] || 'Unknown risk level';
}

function calculateVersionJump(from: string, to: string): string | null {
  try {
    const fromParts = from.split('.').map((p) => parseInt(p) || 0);
    const toParts = to.split('.').map((p) => parseInt(p) || 0);

    const majorJump = (toParts[0] || 0) - (fromParts[0] || 0);
    const minorJump = (toParts[1] || 0) - (fromParts[1] || 0);
    const patchJump = (toParts[2] || 0) - (fromParts[2] || 0);

    if (majorJump > 0) return `Major version jump (+${majorJump})`;
    if (minorJump > 0) return `Minor version jump (+${minorJump})`;
    if (patchJump > 0) return `Patch version jump (+${patchJump})`;

    return null;
  } catch {
    return null;
  }
}

function calculateConfidence(result: AnalysisResult): number {
  let confidence = 0;

  if (result.changelogDiff) confidence += 0.3;
  if (result.codeDiff) confidence += 0.2;
  if (result.llmSummary) confidence += 0.2;
  if (result.apiUsages.length > 0) confidence += 0.15;
  if (result.deepAnalysis) confidence += 0.15;

  return Math.min(confidence, 1);
}

function getConfidenceIndicator(confidence: number): string {
  if (confidence >= 0.8) return '🟢 High';
  if (confidence >= 0.5) return '🟡 Medium';
  return '🔴 Low';
}

function groupBreakingChanges(changes: BreakingChange[]): Record<string, BreakingChange[]> {
  const grouped: Record<string, BreakingChange[]> = {
    breaking: [],
    warning: [],
    removal: [],
  };

  changes.forEach((change) => {
    const severity = change.severity || 'breaking';
    if (grouped[severity]) {
      grouped[severity].push(change);
    } else {
      grouped.breaking.push(change);
    }
  });

  return grouped;
}

function formatBreakingChange(change: string): string {
  // Clean up and format breaking change text
  return change
    .replace(/^[\s-*]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce(
    (result, item) => {
      const value = item[key];
      const group =
        typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      if (!result[group]) result[group] = [];
      result[group].push(item);
      return result;
    },
    {} as Record<string, T[]>
  );
}

function getPriorityFromRisk(level: string): string {
  const priorities = {
    safe: '✅ No Action Required',
    low: '🟢 Low Priority',
    medium: '🟡 Medium Priority',
    high: '🟠 High Priority',
    critical: '🔴 Critical Priority',
    unknown: '❓ Manual Review Required',
  };
  return priorities[level as keyof typeof priorities] || '❓ Unknown';
}

function getTimeEstimate(effort: string): string {
  const estimates = {
    none: 'No time required',
    minimal: '15-30 minutes',
    moderate: '1-4 hours',
    significant: '1-2 days',
    unknown: 'Cannot estimate',
  };
  return estimates[effort as keyof typeof estimates] || 'Unknown';
}

function isAutomatable(result: AnalysisResult): string {
  if (result.riskAssessment.level === 'safe') return 'Yes';
  if (result.riskAssessment.level === 'unknown') return 'No';
  if (result.breakingChanges.length === 0) return 'Yes';
  if (result.apiUsages.length === 0) return 'Partially';
  return 'No';
}

function generateDetailedActions(result: AnalysisResult): string[] {
  const actions: string[] = [];

  switch (result.riskAssessment.level) {
    case 'safe':
      actions.push('Merge the PR - no action required');
      break;

    case 'low':
      actions.push('Review the changelog for any subtle changes');
      actions.push('Run your test suite to confirm');
      actions.push('Merge if tests pass');
      break;

    case 'medium':
      actions.push('Review all breaking changes listed above');
      actions.push('Check affected files for necessary updates');
      actions.push('Run comprehensive tests on affected features');
      actions.push('Update code as needed before merging');
      break;

    case 'high':
    case 'critical':
      actions.push('Carefully review all breaking changes');
      actions.push('Update all affected code locations');
      actions.push('Add or update tests for changed functionality');
      actions.push('Run full regression test suite');
      actions.push('Consider staging deployment before production');
      break;

    case 'unknown':
      actions.push('Manually review package documentation');
      actions.push('Check package repository for migration guides');
      actions.push('Search for community discussions about this update');
      actions.push('Consider testing in isolated environment first');
      break;
  }

  // Add specific actions based on the type of changes
  if (result.apiUsages.length > 0) {
    actions.push(`Update ${result.apiUsages.length} code locations using the package APIs`);
  }

  if (result.deepAnalysis && result.deepAnalysis.configUsages.length > 0) {
    actions.push('Review and update configuration files');
  }

  return actions;
}
