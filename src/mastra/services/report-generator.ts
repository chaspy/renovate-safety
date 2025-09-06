/**
 * Report Generator Service
 * Handles unified report generation with GitHub links and proper execution stats
 */

import { translateRecommendations } from './translation-service.js';
import {
  generateGitHubFileLink,
  generateMarkdownLink,
  autoDetectRepository,
  type GitHubLinkOptions
} from '../tools/github-link-generator.js';
import { getHighestRisk } from '../workflows/report-generator.js';
import type { ExecutionStats } from '../tools/execution-tracker.js';

// Helper function to get risk emoji
function getRiskEmoji(risk: string): string {
  switch (risk.toLowerCase()) {
    case 'safe': return '✅';
    case 'low': return '🟡';
    case 'medium': return '🟠';
    case 'high': return '🔴';
    case 'critical': return '🚨';
    default: return '❓';
  }
}

// Unified report generation with GitHub links and proper execution stats
export async function generateUnifiedReport(assessments: any[], options: {
  format: 'markdown' | 'json';
  language: 'en' | 'ja';
  prInfo: any;
  executionStats?: ExecutionStats;
  includeExecutionStats?: boolean;
}) {
  const { format, language, prInfo, executionStats, includeExecutionStats = true } = options;
  
  if (format === 'json') {
    // Import the original generateReport function for JSON format
    const { generateReport } = await import('../workflows/report-generator.js');
    return generateReport(assessments, options);
  }
  
  // Generate markdown with GitHub links and translation support
  const isJapanese = language === 'ja';
  const overallRisk = getHighestRisk(assessments);
  const riskEmoji = getRiskEmoji(overallRisk);
  
  // Auto-detect repository for GitHub links
  let repository;
  let linkOptions: GitHubLinkOptions | undefined;
  
  try {
    repository = await autoDetectRepository(prInfo);
    if (repository) {
      linkOptions = { repository };
    }
  } catch (error) {
    console.warn('Could not auto-detect repository for links:', error);
  }
  
  let markdown = `### ${isJapanese ? 'renovate-safety 分析結果' : 'renovate-safety Analysis'}\n\n`;
  markdown += `**${isJapanese ? '結論' : 'Conclusion'}**: ${riskEmoji} ${overallRisk.toUpperCase()}\n\n`;
  
  // Summary section
  markdown += await generateSummarySection(assessments, isJapanese, linkOptions);
  
  // Individual assessments
  markdown += await generateAssessmentsSection(assessments, isJapanese, linkOptions);
  
  // Recommendations section
  markdown += await generateRecommendationsSection(assessments, overallRisk, isJapanese);
  
  // Execution statistics (using finalized stats)
  if (includeExecutionStats && executionStats) {
    markdown += generateExecutionStatsSection(executionStats, isJapanese);
  }
  
  return {
    format: 'markdown' as const,
    markdown,
  };
}

// Generate summary section with proper GitHub links
async function generateSummarySection(assessments: any[], isJapanese: boolean, linkOptions?: GitHubLinkOptions): Promise<string> {
  let markdown = `#### ${isJapanese ? '📊 概要' : '📊 Summary'}\n\n`;
  
  const riskCounts = assessments.reduce((acc, a) => {
    acc[a.risk.level] = (acc[a.risk.level] || 0) + 1;
    return acc;
  }, {});
  
  // Risk distribution table
  markdown += '| Risk Level | Count |\n|---|---|\n';
  const riskLevels = ['critical', 'high', 'medium', 'low', 'safe'];
  for (const level of riskLevels) {
    if (riskCounts[level] > 0) {
      const emoji = getRiskEmoji(level);
      markdown += `| ${emoji} ${level.toUpperCase()} | ${riskCounts[level]} |\n`;
    }
  }
  markdown += '\n';
  
  return markdown;
}

// Generate assessments section with GitHub links  
async function generateAssessmentsSection(assessments: any[], isJapanese: boolean, linkOptions?: GitHubLinkOptions): Promise<string> {
  let markdown = `#### ${isJapanese ? '📦 パッケージ分析' : '📦 Package Analysis'}\n\n`;
  
  for (const assessment of assessments) {
    const { dependency, overview, codeImpact, risk } = assessment;
    const riskEmoji = getRiskEmoji(risk.level);
    
    markdown += `##### ${dependency.name} ${dependency.fromVersion} → ${dependency.toVersion} ${riskEmoji}\n\n`;
    
    // Library overview - new feature at the top
    if (overview) {
      markdown += `**${isJapanese ? 'ライブラリ概要' : 'Library Overview'}**: ${overview.overview}\n\n`;
      if (overview.category && overview.category !== 'unknown') {
        markdown += `**${isJapanese ? 'カテゴリ' : 'Category'}**: ${overview.category}\n\n`;
      }
    }
    
    // Risk level and impact
    markdown += `**${isJapanese ? 'リスクレベル' : 'Risk Level'}**: ${risk.level.toUpperCase()} (${isJapanese ? 'スコア' : 'Score'}: ${risk.score})\n\n`;
    
    // Usage information with GitHub links
    if (codeImpact && codeImpact.totalUsages > 0) {
      markdown += `**${isJapanese ? '利用箇所' : 'Usage Locations'}**: ${codeImpact.totalUsages} ${isJapanese ? '箇所' : 'locations'}\n\n`;
      
      // Affected files with links
      if (codeImpact.affectedFiles && codeImpact.affectedFiles.length > 0) {
        markdown += `**${isJapanese ? '影響ファイル' : 'Affected Files'}**:\n`;
        
        for (const file of codeImpact.affectedFiles) {
          if (linkOptions) {
            const link = generateMarkdownLink(file, 1, linkOptions);
            markdown += `- ${link}\n`;
          } else {
            markdown += `- ${file}\n`;
          }
        }
        markdown += '\n';
      }
    }
    
    // Translated recommendations
    if (codeImpact && codeImpact.recommendations && codeImpact.recommendations.length > 0) {
      markdown += `**${isJapanese ? '推奨アクション' : 'Recommendations'}**:\n`;
      
      const translatedRecommendations = await translateRecommendations(
        codeImpact.recommendations, 
        isJapanese ? 'ja' : 'en'
      );
      
      for (const rec of translatedRecommendations) {
        markdown += `- ${rec}\n`;
      }
      markdown += '\n';
    }
  }
  
  return markdown;
}

// Generate recommendations section with translation
async function generateRecommendationsSection(assessments: any[], overallRisk: string, isJapanese: boolean): Promise<string> {
  let markdown = `#### ${isJapanese ? '📌 全体的な推奨アクション' : '📌 Overall Recommendations'}\n\n`;
  
  // Generate general recommendations based on overall risk
  const recommendations = [];
  
  if (overallRisk === 'critical' || overallRisk === 'high') {
    recommendations.push('Run comprehensive tests before merging');
    recommendations.push('Consider manual testing for critical functionality');
    recommendations.push('Review breaking changes carefully');
  } else if (overallRisk === 'medium') {
    recommendations.push('Run unit and integration tests');
    recommendations.push('Monitor for any runtime issues');
  } else {
    recommendations.push('Standard testing should be sufficient');
    recommendations.push('Monitor deployment for any unexpected issues');
  }
  
  const translatedRecommendations = await translateRecommendations(
    recommendations, 
    isJapanese ? 'ja' : 'en'
  );
  
  for (const rec of translatedRecommendations) {
    markdown += `- ${rec}\n`;
  }
  markdown += '\n';
  
  return markdown;
}

// Generate execution statistics section
function generateExecutionStatsSection(stats: ExecutionStats, isJapanese: boolean): string {
  let markdown = `#### ${isJapanese ? '📊 実行統計' : '📊 Execution Statistics'}\n\n`;
  
  markdown += `| ${isJapanese ? '項目' : 'Metric'} | ${isJapanese ? '値' : 'Value'} |\n`;
  markdown += '|---|---|\n';
  
  if (stats.totalDuration) {
    const duration = Math.round(stats.totalDuration / 1000);
    markdown += `| ${isJapanese ? '実行時間' : 'Duration'} | ${duration}s |\n`;
  }
  
  // Agent details
  const agentNames = stats.agents.map(agent => agent.agentName).join(', ');
  markdown += `| ${isJapanese ? 'エージェント数' : 'Agents Used'} | ${stats.agents.length} |\n`;
  if (agentNames) {
    markdown += `| ${isJapanese ? '- 使用エージェント' : '- Agent Names'} | ${agentNames} |\n`;
  }
  
  // API call details  
  markdown += `| ${isJapanese ? 'API呼び出し' : 'API Calls'} | ${stats.apiCalls.total} |\n`;
  
  // Model breakdown
  const modelBreakdown = Object.entries(stats.apiCalls.byModel)
    .map(([model, count]) => `${model}: ${count}`)
    .join(', ');
  if (modelBreakdown) {
    markdown += `| ${isJapanese ? '- モデル別' : '- By Model'} | ${modelBreakdown} |\n`;
  }
  
  // Token usage details
  const totalTokens = stats.agents.reduce((sum, agent) => sum + (agent.totalTokens || 0), 0);
  if (totalTokens > 0) {
    markdown += `| ${isJapanese ? 'トークン使用量' : 'Token Usage'} | ${totalTokens.toLocaleString()} |\n`;
    
    // Input/Output token breakdown
    const inputTokens = stats.agents.reduce((sum, agent) => sum + (agent.inputTokens || 0), 0);
    const outputTokens = stats.agents.reduce((sum, agent) => sum + (agent.outputTokens || 0), 0);
    if (inputTokens > 0 && outputTokens > 0) {
      markdown += `| ${isJapanese ? '- 入力/出力' : '- Input/Output'} | ${inputTokens.toLocaleString()}/${outputTokens.toLocaleString()} |\n`;
    }
  }
  
  if (stats.apiCalls.estimatedCost !== undefined) {
    const cost = stats.apiCalls.estimatedCost.toFixed(4);
    markdown += `| ${isJapanese ? '推定コスト' : 'Estimated Cost'} | $${cost} |\n`;
  }
  
  // Data sources used
  if (stats.dataSourcesUsed && stats.dataSourcesUsed.length > 0) {
    const dataSources = stats.dataSourcesUsed.join(', ');
    markdown += `| ${isJapanese ? 'データソース' : 'Data Sources'} | ${dataSources} |\n`;
  }
  
  markdown += '\n';
  
  return markdown;
}