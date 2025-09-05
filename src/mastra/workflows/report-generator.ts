
// GitHub link functionality would be used here in future versions
import { type ExecutionStats } from '../tools/execution-tracker.js';

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
  
  // Get overall risk level
  const overallRisk = getHighestRisk(assessments);
  const riskEmoji = getRiskEmoji(overallRisk);
  
  // Auto-detect repository for GitHub links would be implemented in future versions
  
  let markdown = `### ${isJapanese ? 'renovate-safety 分析結果' : 'renovate-safety Analysis'}\n\n`;
  
  markdown += `**${isJapanese ? '結論' : 'Conclusion'}**: ${riskEmoji} ${overallRisk.toUpperCase()}\n\n`;
  
  // Summary table
  markdown += `| Package | Version | ${isJapanese ? 'リスク' : 'Risk'} | ${isJapanese ? '影響' : 'Impact'} |\n`;
  markdown += `|---------|---------|--------|--------|\n`;
  
  for (const assessment of assessments) {
    const { dependency, risk, codeImpact } = assessment;
    const riskBadge = getRiskEmoji(risk.level);
    const usageCount = codeImpact?.totalUsages || 0;
    
    markdown += `| ${dependency.name} | ${dependency.fromVersion} → ${dependency.toVersion} | `;
    markdown += `${riskBadge} ${risk.level} | `;
    markdown += `${usageCount} ${isJapanese ? '箇所' : 'usages'} |\n`;
  }
  
  // Breaking changes section (if any)
  const hasBreaking = assessments.some(a => 
    a.releaseNotes?.breakingChanges && a.releaseNotes.breakingChanges.length > 0
  );
  
  if (hasBreaking) {
    markdown += `\n### ${isJapanese ? '⚠️ 破壊的変更' : '⚠️ Breaking Changes'}\n\n`;
    
    for (const assessment of assessments) {
      const breakingChanges = assessment.releaseNotes?.breakingChanges;
      if (breakingChanges && breakingChanges.length > 0) {
        markdown += `**${assessment.dependency.name}**:\n`;
        for (const breaking of breakingChanges.slice(0, 3)) {
          markdown += `- ${breaking.text}\n`;
        }
        if (breakingChanges.length > 3) {
          markdown += `- ${isJapanese ? `... 他${breakingChanges.length - 3}項目` : `... and ${breakingChanges.length - 3} more`}\n`;
        }
      }
    }
  }
  
  // Recommendations
  markdown += `\n### ${isJapanese ? '📌 推奨アクション' : '📌 Recommendations'}\n\n`;
  
  if (overallRisk === 'safe') {
    markdown += isJapanese 
      ? '✅ 自動マージ可能（リスクなし）\n'
      : '✅ Safe to auto-merge (no risks detected)\n';
  } else if (overallRisk === 'low') {
    markdown += isJapanese
      ? '✅ テスト通過後にマージ推奨\n'
      : '✅ Merge after tests pass\n';
  } else {
    markdown += isJapanese
      ? '🔍 手動レビューが必要です\n'
      : '🔍 Manual review required\n';
    
    // List specific actions for high-risk items
    const highRiskAssessments = assessments.filter(a => 
      a.risk.level === 'medium' || a.risk.level === 'high' || a.risk.level === 'critical'
    );
    
    for (const assessment of highRiskAssessments) {
      if (assessment.codeImpact?.recommendations) {
        for (const rec of assessment.codeImpact.recommendations.slice(0, 2)) {
          markdown += `- ${rec}\n`;
        }
      }
    }
  }
  
  // Footer
  markdown += `\n---\n`;
  markdown += `*Generated by [renovate-safety](https://github.com/chaspy/renovate-safety) agent v2.0*\n`;
  markdown += `<!-- Generated by renovate-safety (do-not-edit) -->\n`;
  
  return { markdown, format: 'markdown' as const };
}

function getRiskEmoji(level: string): string {
  switch (level) {
    case 'safe': return '✅';
    case 'low': return '🟡';
    case 'medium': return '🟠';
    case 'high': return '🔴';
    case 'critical': return '💥';
    default: return '❓';
  }
}

export function getHighestRisk(assessments: Assessment[]): string {
  const levels = ['safe', 'low', 'medium', 'high', 'critical'];
  let highest = 'safe';
  
  for (const assessment of assessments) {
    const currentIndex = levels.indexOf(assessment.risk.level);
    const highestIndex = levels.indexOf(highest);
    
    if (currentIndex > highestIndex) {
      highest = assessment.risk.level;
    }
  }
  
  return highest;
}

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
  // TODO: Implement report saving to file system
  // For now, just log that we would save
  console.log(`Would save ${report.format} report for PR #${prNumber}`);
}