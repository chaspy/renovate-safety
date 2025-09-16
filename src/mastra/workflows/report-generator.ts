
// GitHub link functionality would be used here in future versions
import { type ExecutionStats } from '../tools/execution-tracker.js';
import {
  generateSummaryTable,
  generateBreakingChangesSection,
  generateRecommendationsSection,
  generateReportHeader,
  generateReportFooter,
  getHighestRisk,
} from './report-generator-helpers.js';

interface PRInfo {
  number: number;
  title: string;
  base: string;
  head: string;
  repository: {
    owner: string;
    name: string;
  };
}

interface Dependency {
  name: string;
  fromVersion: string;
  toVersion: string;
  type?: string;
}

interface RiskAssessment {
  level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  score: number;
  factors: string[];
  confidence: number;
  mitigationSteps: string[];
  estimatedEffort: string;
  testingScope: string;
}

interface Assessment {
  dependency: Dependency;
  releaseNotes?: {
    breakingChanges: Array<{ text: string; severity: string; source?: string }>;
    migrationSteps: string[];
    riskLevel: string;
    summary: string;
    sources: Array<{ type: string; url?: string; status: string }>;
  };
  codeImpact?: {
    totalUsages: number;
    criticalUsages: Array<{ file: string; line: number; reason: string }>;
    usageByType: Record<string, number>;
    impactLevel: string;
    affectedFiles: string[];
    recommendations: string[];
    projectType?: string;
    score: number;
  };
  risk: RiskAssessment;
}

export interface ReportOptions {
  format: 'markdown' | 'json';
  language: 'en' | 'ja';
  prInfo: PRInfo;
  executionStats?: ExecutionStats;
  includeExecutionStats?: boolean;
}

export async function generateReport(assessments: Assessment[], options: ReportOptions) {
  if (options.format === 'json') {
    return generateJsonReport(assessments, options);
  }
  
  return await generateMarkdownReport(assessments, options);
}

function generateJsonReport(assessments: Assessment[], options: ReportOptions) {
  const reportData = {
    assessments,
    summary: {
      overallRisk: getHighestRisk(assessments),
      totalDependencies: assessments.length,
      riskDistribution: getRiskDistribution(assessments),
    },
    ...(options.executionStats && { executionStats: options.executionStats })
  };
  
  return {
    format: 'json' as const,
    json: JSON.stringify(reportData, null, 2),
  };
}

async function generateMarkdownReport(assessments: Assessment[], options: ReportOptions) {
  const { language } = options;
  const isJapanese = language === 'ja';

  const overallRisk = getHighestRisk(assessments);

  let markdown = generateReportHeader(overallRisk, isJapanese);
  markdown += generateSummaryTable(assessments, isJapanese);
  markdown += generateBreakingChangesSection(assessments, isJapanese);
  markdown += generateRecommendationsSection(assessments, overallRisk, isJapanese);
  markdown += generateReportFooter();

  return { markdown, format: 'markdown' as const };
}

// Helper functions moved to report-generator-helpers.ts
// Export for backward compatibility
export { getHighestRisk } from './report-generator-helpers.js';

function getRiskDistribution(assessments: Assessment[]): Record<string, number> {
  const distribution: Record<string, number> = {
    safe: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  
  for (const assessment of assessments) {
    distribution[assessment.risk.level]++;
  }
  
  return distribution;
}

export async function saveReport(report: { markdown?: string; json?: string; format: string }, prNumber: number): Promise<void> {
  // Report saving is currently a no-op - extend this function when file system persistence is needed
  // Current implementation logs the action for debugging purposes
  console.log(`Would save ${report.format} report for PR #${prNumber}`);
}