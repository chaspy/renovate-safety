import type { AnalysisResult } from '../types/index.js';
import {
  generateActionableRecommendations,
} from './recommendations.js';
import {
  generateReportHeader,
  generatePackageInfoSection,
  generateSummarySection,
  generateDependencyUsageSection,
  generateCodeChangesSection,
  generateBreakingChangesSection,
  generateApiUsageSection,
  generateDeepAnalysisSection,
  generateActionableRecommendationsSection,
  generateMigrationChecklistSection,
  generateSecurityAnalysisSection,
  generateSummaryAndRiskDetailsSection,
  generateReportFooter,
} from './report-helper-functions.js';

export async function generateReport(
  analysisResult: AnalysisResult,
  format: 'markdown' | 'json'
): Promise<string> {
  if (format === 'json') {
    return generateJSONReport(analysisResult);
  }
  return generateMarkdownReport(analysisResult);
}

async function generateMarkdownReport(result: AnalysisResult): Promise<string> {
  const sections: string[] = [];

  // Header
  sections.push(...generateReportHeader(result.riskAssessment));

  // Package info
  sections.push(...generatePackageInfoSection(result));

  // Summary
  sections.push(...generateSummarySection(result.llmSummary));

  // Dependency usage information
  sections.push(...generateDependencyUsageSection(result.dependencyUsage));

  // Code changes information
  sections.push(...generateCodeChangesSection(result.codeDiff));

  // Breaking changes
  sections.push(...generateBreakingChangesSection(result.breakingChanges));

  // API usage
  sections.push(...generateApiUsageSection(result.apiUsages));

  // Deep Analysis
  sections.push(...generateDeepAnalysisSection(result.deepAnalysis));

  // Actionable Recommendations
  sections.push(...generateActionableRecommendationsSection(result));

  // Migration Checklist for high-risk updates
  sections.push(...generateMigrationChecklistSection(result));

  // Security Analysis
  const securitySections = await generateSecurityAnalysisSection(result);
  sections.push(...securitySections);

  // Summary and risk details
  sections.push(...generateSummaryAndRiskDetailsSection(result));

  // Footer
  sections.push(...generateReportFooter());

  return sections.join('\n');
}

function generateJSONReport(result: AnalysisResult): string {
  const actionableRecs = generateActionableRecommendations(result, result.riskAssessment);
  const report = {
    package: result.package,
    riskAssessment: result.riskAssessment,
    recommendation: result.recommendation,
    actionableRecommendations: actionableRecs.map((rec) => ({
      title: rec.title,
      priority: rec.priority,
      actions: rec.actions,
      estimatedTime: rec.estimatedTime,
      automatable: rec.automatable,
      resources: rec.resources || [],
    })),
    changelogSource: result.changelogDiff?.source || null,
    codeDiff: result.codeDiff
      ? {
          filesChanged: result.codeDiff.filesChanged,
          additions: result.codeDiff.additions,
          deletions: result.codeDiff.deletions,
          fromTag: result.codeDiff.fromTag,
          toTag: result.codeDiff.toTag,
          source: result.codeDiff.source,
        }
      : null,
    dependencyUsage: result.dependencyUsage
      ? {
          isDirect: result.dependencyUsage.isDirect,
          usageType: result.dependencyUsage.usageType,
          dependentsCount: result.dependencyUsage.dependents.length,
          dependents: result.dependencyUsage.dependents.map((dep) => ({
            name: dep.name,
            version: dep.version,
            type: dep.type,
            path: dep.path,
          })),
        }
      : null,
    summary: result.llmSummary?.summary || null,
    breakingChanges: {
      total: result.breakingChanges.length,
      byType: {
        breaking: result.breakingChanges.filter((c) => c.severity === 'breaking').length,
        removal: result.breakingChanges.filter((c) => c.severity === 'removal').length,
        warning: result.breakingChanges.filter((c) => c.severity === 'warning').length,
      },
      items: result.breakingChanges,
    },
    apiUsages: {
      total: result.apiUsages.length,
      byApi: groupByApi(result.apiUsages),
      locations: result.apiUsages.map((u) => ({
        file: u.file,
        line: u.line,
        api: u.apiName,
        snippet: u.snippet,
      })),
    },
    aiAnalysis: result.llmSummary
      ? {
          summary: result.llmSummary.summary,
          language: result.llmSummary.language,
          identifiedBreakingChanges: result.llmSummary.breakingChanges,
        }
      : null,
    deepAnalysis: result.deepAnalysis
      ? {
          packageName: result.deepAnalysis.packageName,
          totalFiles: result.deepAnalysis.totalFiles,
          filesUsingPackage: result.deepAnalysis.filesUsingPackage,
          imports: result.deepAnalysis.imports,
          apiUsages: result.deepAnalysis.apiUsages,
          fileClassifications: result.deepAnalysis.fileClassifications,
          configUsages: result.deepAnalysis.configUsages,
          usageSummary: result.deepAnalysis.usageSummary,
          recommendations: result.deepAnalysis.recommendations,
        }
      : null,
  };

  return JSON.stringify(report, null, 2);
}
