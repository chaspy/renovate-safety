import type { AnalysisResult } from '../types/index.js';
import { getRiskEmoji, getRiskDescription } from './grade.js';
import {
  generateActionableRecommendations,
  generateMigrationChecklist,
} from './recommendations.js';
import { analyzeSecurityImplications, generateSecurityChecklist } from './security-analysis.js';

export function generateReportHeader(riskAssessment: AnalysisResult['riskAssessment']): string[] {
  return [
    `# Renovate Safety Analysis Report\n`,
    `## ${getRiskEmoji(riskAssessment.level)} Risk Assessment: ${riskAssessment.level.toUpperCase()}\n`,
  ];
}

export function generatePackageInfoSection(result: AnalysisResult): string[] {
  const { package: pkg, changelogDiff, codeDiff, dependencyUsage } = result;
  const sections = [];

  sections.push(`### 📦 Package Update`);
  sections.push(`- **Package**: \`${pkg.name}\``);
  sections.push(`- **Version**: ${pkg.fromVersion} → ${pkg.toVersion}`);
  sections.push(`- **Changelog Source**: ${changelogDiff ? changelogDiff.source : 'Not found'}`);

  const codeDiffInfo = codeDiff
    ? codeDiff.filesChanged + ' files changed (' + codeDiff.fromTag + ' → ' + codeDiff.toTag + ')'
    : 'Not available';
  sections.push(`- **Code Diff**: ${codeDiffInfo}`);

  let dependencyTypeInfo = 'Unknown';
  if (dependencyUsage) {
    const directType = dependencyUsage.isDirect ? 'Direct' : 'Transitive';
    dependencyTypeInfo = `${directType} ${dependencyUsage.usageType}`;
  }
  sections.push(`- **Dependency Type**: ${dependencyTypeInfo}\n`);

  return sections;
}

export function generateSummarySection(llmSummary: AnalysisResult['llmSummary']): string[] {
  if (!llmSummary) return [];

  const sections = [];
  sections.push(`### 📝 Summary`);
  sections.push(llmSummary.summary);

  if (llmSummary.breakingChanges.length > 0) {
    sections.push(`\n**AI-Identified Breaking Changes:**`);
    for (const change of llmSummary.breakingChanges) {
      sections.push(`- ${change}`);
    }
  }
  sections.push('');

  return sections;
}

export function generateDependencyUsageSection(
  dependencyUsage: AnalysisResult['dependencyUsage']
): string[] {
  if (!dependencyUsage) return [];

  const sections = [];
  sections.push(`### 🌳 Dependency Usage`);
  sections.push(`- **Type**: ${dependencyUsage.isDirect ? 'Direct' : 'Transitive'} dependency`);
  sections.push(`- **Category**: ${dependencyUsage.usageType}`);
  sections.push(
    `- **Impact**: Affects ${dependencyUsage.dependents.length} package${dependencyUsage.dependents.length > 1 ? 's' : ''}`
  );

  if (dependencyUsage.dependents.length > 0) {
    const directDeps = dependencyUsage.dependents.filter((dep) => dep.type === 'direct');
    const transitiveDeps = dependencyUsage.dependents.filter((dep) => dep.type === 'transitive');

    if (directDeps.length > 0) {
      sections.push(`\n**Direct Dependencies (${directDeps.length}):**`);
      for (const dep of directDeps.slice(0, 5)) {
        sections.push(`- ${dep.name} (${dep.version})`);
      }
      if (directDeps.length > 5) {
        sections.push(`- ... and ${directDeps.length - 5} more`);
      }
    }

    if (transitiveDeps.length > 0) {
      sections.push(`\n**Transitive Dependencies (${transitiveDeps.length}):**`);
      for (const dep of transitiveDeps.slice(0, 3)) {
        sections.push(`- ${dep.name} (${dep.version}) - via ${dep.path.join(' → ')}`);
      }
      if (transitiveDeps.length > 3) {
        sections.push(`- ... and ${transitiveDeps.length - 3} more`);
      }
    }
  }
  sections.push('');

  return sections;
}

export function generateCodeChangesSection(codeDiff: AnalysisResult['codeDiff']): string[] {
  if (!codeDiff) return [];

  return [
    `### 🔧 Code Changes`,
    `- **Files Changed**: ${codeDiff.filesChanged}`,
    `- **Additions**: ${codeDiff.additions}`,
    `- **Deletions**: ${codeDiff.deletions}`,
    `- **Comparison**: ${codeDiff.fromTag} → ${codeDiff.toTag}`,
    `- **Source**: GitHub repository comparison\n`,
  ];
}

export function generateBreakingChangesSection(
  breakingChanges: AnalysisResult['breakingChanges']
): string[] {
  if (breakingChanges.length === 0) return [];

  const sections = [];
  sections.push(`### ⚠️ Breaking Changes Detected`);

  const grouped = groupBySeverity(breakingChanges);

  if (grouped.breaking.length > 0) {
    sections.push(`\n**🔴 Breaking (${grouped.breaking.length}):**`);
    for (const change of grouped.breaking) {
      sections.push(`- ${formatBreakingChange(change.line)}`);
    }
  }

  if (grouped.removal.length > 0) {
    sections.push(`\n**🟠 Removals (${grouped.removal.length}):**`);
    for (const change of grouped.removal) {
      sections.push(`- ${formatBreakingChange(change.line)}`);
    }
  }

  if (grouped.warning.length > 0) {
    sections.push(`\n**🟡 Warnings (${grouped.warning.length}):**`);
    for (const change of grouped.warning) {
      sections.push(`- ${formatBreakingChange(change.line)}`);
    }
  }

  sections.push('');
  return sections;
}

export function generateApiUsageSection(apiUsages: AnalysisResult['apiUsages']): string[] {
  if (apiUsages.length === 0) return [];

  const sections = [];
  sections.push(`### 🔍 Affected Code Locations`);
  sections.push(`Found ${apiUsages.length} usage(s) of potentially affected APIs:\n`);

  const byApi = groupByApi(apiUsages);

  for (const [apiName, usages] of Object.entries(byApi)) {
    sections.push(`**\`${apiName}\`** (${usages.length} usage${usages.length > 1 ? 's' : ''}):`);
    for (const usage of usages.slice(0, 5)) {
      const file = usage.file || usage.filePath || 'unknown';
      const snippet = usage.snippet || usage.context || '';
      sections.push(`- ${file}:${usage.line}`);
      sections.push(`  \`\`\`typescript`);
      sections.push(`  ${snippet}`);
      sections.push(`  \`\`\``);
    }
    if (usages.length > 5) {
      sections.push(`- ... and ${usages.length - 5} more\n`);
    }
  }
  sections.push('');

  return sections;
}

export function generateDeepAnalysisSection(
  deepAnalysis: AnalysisResult['deepAnalysis']
): string[] {
  if (!deepAnalysis) return [];

  const sections = [];
  sections.push(`### 🔬 Deep Code Analysis`);
  sections.push(`**Package Usage Overview:**`);
  sections.push(`- **Total Files Scanned**: ${deepAnalysis.totalFiles}`);
  sections.push(
    `- **Files Using Package**: ${deepAnalysis.filesUsingPackage} (${Math.round((deepAnalysis.filesUsingPackage / deepAnalysis.totalFiles) * 100)}%)`
  );
  sections.push(`- **Import Statements**: ${deepAnalysis.imports.length}`);
  sections.push(`- **API Usages**: ${deepAnalysis.apiUsages.length}\n`);

  // Usage Summary
  sections.push(...generateUsageSummary(deepAnalysis.usageSummary));
  sections.push(...generateImportTypes(deepAnalysis.imports));
  sections.push(...generateConfigUsages(deepAnalysis.configUsages));
  sections.push(...generateFileClassifications(deepAnalysis.fileClassifications));
  sections.push(...generateDeepAnalysisRecommendations(deepAnalysis.recommendations));

  sections.push('');
  return sections;
}

function generateUsageSummary(usageSummary: any): string[] {
  const sections = [];
  sections.push(`**Usage Distribution:**`);
  const { testVsProduction, byFileType, byAPIType, mostUsedAPIs } = usageSummary;

  if (testVsProduction.test > 0 || testVsProduction.production > 0) {
    sections.push(`- **Test Files**: ${testVsProduction.test}`);
    sections.push(`- **Production Files**: ${testVsProduction.production}`);
  }

  if (Object.keys(byFileType).length > 0) {
    sections.push(
      `- **By File Type**: ${Object.entries(byFileType)
        .map(([type, count]) => `${type}: ${count}`)
        .join(', ')}`
    );
  }

  if (Object.keys(byAPIType).length > 0) {
    sections.push(
      `- **By Usage Type**: ${Object.entries(byAPIType)
        .map(([type, count]) => `${type}: ${count}`)
        .join(', ')}`
    );
  }

  if (mostUsedAPIs.length > 0) {
    sections.push(`\n**Most Used APIs:**`);
    for (const api of mostUsedAPIs.slice(0, 5)) {
      sections.push(`- \`${api.api}\`: ${api.count} usage${api.count > 1 ? 's' : ''}`);
    }
  }

  return sections;
}

function generateImportTypes(imports: any[]): string[] {
  if (imports.length === 0) return [];

  const sections = [];
  sections.push(`\n**Import Types:**`);
  const importsByType = imports.reduce(
    (acc, imp) => {
      acc[imp.type] = (acc[imp.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  for (const [type, count] of Object.entries(importsByType)) {
    sections.push(`- ${type.replace('-', ' ')}: ${count}`);
  }

  return sections;
}

function generateConfigUsages(configUsages: any[]): string[] {
  if (configUsages.length === 0) return [];

  const sections = [];
  sections.push(`\n**Configuration Files:**`);
  for (const config of configUsages) {
    sections.push(`- **${config.file}** (${config.configType}): ${config.usage}`);
  }

  return sections;
}

function generateFileClassifications(fileClassifications: any[]): string[] {
  if (fileClassifications.length === 0) return [];

  const sections = [];
  sections.push(`\n**File Classifications:**`);
  const classificationSummary = fileClassifications.reduce(
    (acc, file) => {
      acc[file.category] = (acc[file.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  for (const [category, count] of Object.entries(classificationSummary)) {
    sections.push(`- ${category}: ${count} file${count > 1 ? 's' : ''}`);
  }

  return sections;
}

function generateDeepAnalysisRecommendations(recommendations: string[]): string[] {
  if (recommendations.length === 0) return [];

  const sections = [];
  sections.push(`\n**Deep Analysis Recommendations:**`);
  for (const rec of recommendations) {
    sections.push(`- ${rec}`);
  }

  return sections;
}

export function generateActionableRecommendationsSection(result: AnalysisResult): string[] {
  const actionableRecs = generateActionableRecommendations(result, result.riskAssessment);
  if (actionableRecs.length === 0) return [];

  const sections = [];
  sections.push(`### 🎯 Actionable Recommendations\n`);

  for (const rec of actionableRecs) {
    let priorityEmoji = '🟡';
    if (rec.priority === 'immediate') {
      priorityEmoji = '🚨';
    } else if (rec.priority === 'high') {
      priorityEmoji = '🔴';
    } else if (rec.priority === 'medium') {
      priorityEmoji = '🟠';
    }

    sections.push(`#### ${priorityEmoji} ${rec.title}`);
    sections.push(
      `**Priority:** ${rec.priority.toUpperCase()} | **Time Required:** ${rec.estimatedTime} | **Automatable:** ${rec.automatable ? 'Yes' : 'No'}\n`
    );

    sections.push('**Actions:**');
    for (const action of rec.actions) {
      sections.push(`- ${action}`);
    }

    if (rec.resources && rec.resources.length > 0) {
      sections.push('\n**Helpful Commands/Resources:**');
      for (const resource of rec.resources) {
        sections.push(`- \`${resource}\``);
      }
    }
    sections.push('');
  }

  return sections;
}

export function generateMigrationChecklistSection(result: AnalysisResult): string[] {
  const { riskAssessment } = result;
  if (riskAssessment.level !== 'high' && riskAssessment.level !== 'critical') {
    return [];
  }

  const actionableRecs = generateActionableRecommendations(result, riskAssessment);
  const checklist = generateMigrationChecklist(result, actionableRecs);
  return [`### 📋 Migration Checklist\n`, ...checklist, ''];
}

export async function generateSecurityAnalysisSection(result: AnalysisResult): Promise<string[]> {
  const { package: pkg, codeDiff, changelogDiff } = result;
  const securityIssues = await analyzeSecurityImplications(pkg, codeDiff, changelogDiff);
  if (securityIssues.length === 0) return [];

  const sections = [];
  sections.push(`### 🔒 Security Considerations\n`);

  const criticalSecurity = securityIssues.filter((i) => i.severity === 'critical');
  if (criticalSecurity.length > 0) {
    sections.push('**🚨 CRITICAL SECURITY ISSUES DETECTED**\n');
  }

  for (const issue of securityIssues) {
    let severityEmoji = '🟡';
    if (issue.severity === 'critical') {
      severityEmoji = '🚨';
    } else if (issue.severity === 'high') {
      severityEmoji = '🔴';
    } else if (issue.severity === 'medium') {
      severityEmoji = '🟠';
    }
    sections.push(
      `${severityEmoji} **${issue.type.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}** (${issue.severity.toUpperCase()})`
    );
    sections.push(`- ${issue.description}`);
    sections.push(`- **Action:** ${issue.recommendation}\n`);
  }

  const securityChecklist = generateSecurityChecklist(securityIssues);
  sections.push(...securityChecklist);
  sections.push('');

  return sections;
}

export function generateSummaryAndRiskDetailsSection(result: AnalysisResult): string[] {
  const { riskAssessment, recommendation, breakingChanges, apiUsages, llmSummary, deepAnalysis } =
    result;
  const sections = [];

  // Original Recommendation
  sections.push(`### 💡 Summary`);
  sections.push(recommendation);
  sections.push('');

  // Risk details
  sections.push(`### 📊 Risk Analysis Details`);
  sections.push(`- **Risk Level**: ${riskAssessment.level}`);
  sections.push(`- **Description**: ${getRiskDescription(riskAssessment.level)}`);
  sections.push(`- **Estimated Effort**: ${riskAssessment.estimatedEffort}`);
  sections.push(`- **Required Testing Scope**: ${riskAssessment.testingScope}`);
  sections.push(`- **Breaking Changes Found**: ${breakingChanges.length}`);
  sections.push(`- **API Usages Found**: ${apiUsages.length}`);
  sections.push(`- **AI Analysis**: ${llmSummary ? 'Completed' : 'Skipped'}`);
  sections.push(`- **Deep Analysis**: ${deepAnalysis ? 'Enabled' : 'Disabled'}`);

  if (riskAssessment.factors.length > 0) {
    sections.push('\n**Risk Factors:**');
    for (const factor of riskAssessment.factors) {
      sections.push(`- ${factor}`);
    }
  }

  return sections;
}

export function generateReportFooter(): string[] {
  return [`\n---`, `*Generated by [renovate-safety](https://github.com/chaspy/renovate-safety)*`];
}

function groupBySeverity(changes: AnalysisResult['breakingChanges']) {
  return {
    breaking: changes.filter((c) => c.severity === 'breaking'),
    removal: changes.filter((c) => c.severity === 'removal'),
    warning: changes.filter((c) => c.severity === 'warning'),
  };
}

function groupByApi(usages: AnalysisResult['apiUsages']) {
  const grouped: Record<string, typeof usages> = {};

  for (const usage of usages) {
    if (!grouped[usage.apiName]) {
      grouped[usage.apiName] = [];
    }
    grouped[usage.apiName].push(usage);
  }

  return grouped;
}

function formatBreakingChange(line: string): string {
  // Clean up common prefixes
  return line
    .replace(/^[-*•]\s*/, '')
    .replace(/^\[BREAKING\]\s*/i, '')
    .replace(/^BREAKING:\s*/i, '')
    .replace(/^BREAKING CHANGE:\s*/i, '')
    .trim();
}
