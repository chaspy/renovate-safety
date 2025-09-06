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
    
    // Risk assessment breakdown
    markdown += await generateRiskAssessmentBreakdown(assessment, isJapanese);
    
    // Usage information with GitHub links and details
    if (codeImpact && codeImpact.totalUsages > 0) {
      markdown += `**${isJapanese ? '利用箇所' : 'Usage Locations'}**: ${codeImpact.totalUsages} ${isJapanese ? '箇所' : 'locations'}\n\n`;
      
      // Affected files with links
      if (codeImpact.affectedFiles && codeImpact.affectedFiles.length > 0) {
        markdown += `**${isJapanese ? '影響ファイル' : 'Affected Files'}**:\n`;
        
        for (const file of codeImpact.affectedFiles) {
          if (linkOptions) {
            const link = generateMarkdownLink(file, 1, linkOptions);
            markdown += `- ${link}`;
          } else {
            markdown += `- ${file}`;
          }
          
          // Add context about the file if it contains specific patterns
          if (file.includes('parallel')) {
            markdown += isJapanese ? ' (並列処理制御)' : ' (parallel processing control)';
          } else if (file.includes('helper')) {
            markdown += isJapanese ? ' (ヘルパーユーティリティ)' : ' (helper utilities)';
          } else if (file.includes('api') || file.includes('client')) {
            markdown += isJapanese ? ' (API通信)' : ' (API communication)';
          }
          markdown += '\n';
        }
        markdown += '\n';
      }
      
      // Usage details if available - enhanced with specific context
      if (codeImpact.usageDetails && codeImpact.usageDetails.length > 0) {
        markdown += `**${isJapanese ? '利用形態' : 'Usage Patterns'}**:\n`;
        
        const usageTypes = codeImpact.usageDetails.reduce((acc: any, detail: any) => {
          if (!acc[detail.usage]) acc[detail.usage] = [];
          acc[detail.usage].push({
            context: detail.context,
            description: detail.description
          });
          return acc;
        }, {});
        
        if (usageTypes.import) {
          const importDetail = usageTypes.import[0];
          markdown += isJapanese ? 
            `- **インポート**: ${importDetail.description || 'パッケージをモジュールとして読み込み'}\n` :
            `- **Import**: ${importDetail.description || 'Loading package as module'}\n`;
          if (importDetail.context && importDetail.context.length < 100) {
            markdown += `  \`\`\`javascript\n  ${importDetail.context}\n  \`\`\`\n`;
          }
        }
        
        if (usageTypes['function-call']) {
          const callDetails = usageTypes['function-call'].slice(0, 2); // Show first 2
          markdown += isJapanese ? 
            `- **関数呼び出し**: ${callDetails.length}箇所で実行\n` :
            `- **Function calls**: Executed in ${callDetails.length} locations\n`;
          
          callDetails.forEach((detail: any, index: number) => {
            if (detail.description) {
              markdown += `  ${index + 1}. ${detail.description}\n`;
            }
            if (detail.context && detail.context.length < 120) {
              markdown += `     \`${detail.context.replace(/\s+/g, ' ')}\`\n`;
            }
          });
        }
        
        if (usageTypes.assignment) {
          const assignDetail = usageTypes.assignment[0];
          markdown += isJapanese ? 
            `- **変数代入**: ${assignDetail.description || '関数結果を変数に格納'}\n` :
            `- **Variable assignment**: ${assignDetail.description || 'Storing function results in variables'}\n`;
          if (assignDetail.context && assignDetail.context.length < 100) {
            markdown += `  \`${assignDetail.context.trim()}\`\n`;
          }
        }
        
        if (usageTypes['function-definition']) {
          const funcDetails = usageTypes['function-definition'].slice(0, 2);
          markdown += isJapanese ? 
            `- **関数定義**: ${funcDetails.length}個の関数でパッケージを使用\n` :
            `- **Function definitions**: Package used in ${funcDetails.length} function(s)\n`;
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
  let markdown = `<details>\n<summary><small><em>${isJapanese ? '📊 実行統計' : '📊 Execution Statistics'}</em></small></summary>\n\n`;
  markdown += '<small><em>\n\n';
  
  if (stats.totalDuration) {
    const duration = Math.round(stats.totalDuration / 1000);
    markdown += `- ${isJapanese ? '実行時間' : 'Duration'}: ${duration}s\n`;
  }
  
  // Agent details
  const agentNames = stats.agents.map(agent => agent.agentName).join(', ');
  markdown += `- ${isJapanese ? 'エージェント数' : 'Agents Used'}: ${stats.agents.length}\n`;
  if (agentNames) {
    markdown += `  - ${isJapanese ? '使用エージェント' : 'Agent Names'}: ${agentNames}\n`;
  }
  
  // API call details  
  markdown += `- ${isJapanese ? 'API呼び出し' : 'API Calls'}: ${stats.apiCalls.total}\n`;
  
  // Model breakdown
  const modelBreakdown = Object.entries(stats.apiCalls.byModel)
    .map(([model, count]) => `${model}: ${count}`)
    .join(', ');
  if (modelBreakdown) {
    markdown += `  - ${isJapanese ? 'モデル別' : 'By Model'}: ${modelBreakdown}\n`;
  }
  
  // Token usage details
  const totalTokens = stats.agents.reduce((sum, agent) => sum + (agent.totalTokens || 0), 0);
  if (totalTokens > 0) {
    markdown += `- ${isJapanese ? 'トークン使用量' : 'Token Usage'}: ${totalTokens.toLocaleString()}\n`;
    
    // Input/Output token breakdown
    const inputTokens = stats.agents.reduce((sum, agent) => sum + (agent.inputTokens || 0), 0);
    const outputTokens = stats.agents.reduce((sum, agent) => sum + (agent.outputTokens || 0), 0);
    if (inputTokens > 0 && outputTokens > 0) {
      markdown += `  - ${isJapanese ? '入力/出力' : 'Input/Output'}: ${inputTokens.toLocaleString()}/${outputTokens.toLocaleString()}\n`;
    }
  }
  
  if (stats.apiCalls.estimatedCost !== undefined) {
    const cost = stats.apiCalls.estimatedCost.toFixed(4);
    markdown += `- ${isJapanese ? '推定コスト' : 'Estimated Cost'}: $${cost}\n`;
  }
  
  // Data sources used
  if (stats.dataSourcesUsed && stats.dataSourcesUsed.length > 0) {
    const dataSources = stats.dataSourcesUsed.join(', ');
    markdown += `- ${isJapanese ? 'データソース' : 'Data Sources'}: ${dataSources}\n`;
  }
  
  markdown += '\n</em></small>\n</details>\n\n';
  
  return markdown;
}

// Generate detailed risk assessment breakdown
async function generateRiskAssessmentBreakdown(assessment: any, isJapanese: boolean): Promise<string> {
  const { dependency, risk, releaseNotes, codeImpact } = assessment;
  let markdown = '';

  // Skip breakdown for safe packages
  if (risk.level === 'safe') {
    return '';
  }

  markdown += `<details>\n<summary><strong>${isJapanese ? '📋 リスクアセスメント詳細' : '📋 Risk Assessment Details'}</strong></summary>\n\n`;
  
  // Version change analysis
  const isMajorUpdate = dependency.fromVersion.split('.')[0] !== dependency.toVersion.split('.')[0];
  const isMinorUpdate = !isMajorUpdate && dependency.fromVersion.split('.')[1] !== dependency.toVersion.split('.')[1];
  
  markdown += `**${isJapanese ? 'バージョン変更分析' : 'Version Change Analysis'}**:\n`;
  
  if (isMajorUpdate) {
    const scoreContribution = 20;
    markdown += isJapanese ? 
      `- メジャーバージョンアップグレード (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution}点**\n` :
      `- Major version upgrade (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution} points**\n`;
    markdown += isJapanese ?
      '  - メジャー更新は破壊的変更を含む可能性が高いため、高いスコアが付与されます\n' :
      '  - Major updates have high potential for breaking changes, resulting in higher scores\n';
  } else if (isMinorUpdate) {
    const scoreContribution = 5;
    markdown += isJapanese ?
      `- マイナーバージョン更新 (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution}点**\n` :
      `- Minor version update (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution} points**\n`;
  } else {
    const scoreContribution = 1;
    markdown += isJapanese ?
      `- パッチバージョン更新 (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution}点**\n` :
      `- Patch version update (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution} point**\n`;
  }

  // Usage impact
  if (codeImpact?.totalUsages > 0) {
    const usageScore = Math.min(codeImpact.totalUsages * 2, 20);
    markdown += isJapanese ?
      `- コード使用箇所数 (${codeImpact.totalUsages}箇所): **+${usageScore}点**\n` :
      `- Code usage locations (${codeImpact.totalUsages} locations): **+${usageScore} points**\n`;
    markdown += isJapanese ?
      '  - 使用箇所が多いほど影響範囲が大きくなります\n' :
      '  - More usage locations increase the impact scope\n';
  }

  // Breaking changes detection status
  const hasBreakingChanges = risk.factors.some((factor: string) => factor.includes('breaking changes'));
  const breakingChangeCount = hasBreakingChanges ? 
    parseInt(risk.factors.find((f: string) => f.includes('breaking changes'))?.match(/(\d+)/)?.[1] || '0') : 0;

  markdown += `\n**${isJapanese ? '破壊的変更の検出状況' : 'Breaking Changes Detection'}**:\n`;
  
  if (breakingChangeCount > 0) {
    markdown += isJapanese ?
      `- **${breakingChangeCount}件の破壊的変更を検出**: **+${breakingChangeCount * 5}点**\n` :
      `- **${breakingChangeCount} breaking changes detected**: **+${breakingChangeCount * 5} points**\n`;
    
    if (releaseNotes?.breakingChanges && releaseNotes.breakingChanges.length > 0) {
      markdown += isJapanese ? '  - 主な変更:\n' : '  - Key changes:\n';
      releaseNotes.breakingChanges.slice(0, 3).forEach((change: any) => {
        markdown += `    - ${change.text || change}\n`;
      });
    }
  } else if (isMajorUpdate) {
    // Major version with no detected breaking changes - highlight uncertainty
    markdown += isJapanese ? 
      '- **破壊的変更は検出されませんでしたが、メジャーバージョンアップグレードのため潜在的リスクが存在します**\n' :
      '- **No breaking changes detected, but potential risks exist due to major version upgrade**\n';
    markdown += isJapanese ?
      '  - ⚠️ リリースノートの分析で具体的な変更内容を特定できませんでした\n' :
      '  - ⚠️ Release notes analysis could not identify specific changes\n';
    markdown += isJapanese ?
      '  - 手動での変更内容確認を強く推奨します\n' :
      '  - Manual review of changes is strongly recommended\n';
  } else {
    markdown += isJapanese ?
      '- 破壊的変更は検出されませんでした: **+0点**\n' :
      '- No breaking changes detected: **+0 points**\n';
  }

  // Information availability and confidence
  const hasLowConfidence = risk.confidence < 0.5;
  if (hasLowConfidence) {
    markdown += `\n**${isJapanese ? '情報の不確実性' : 'Information Uncertainty'}**:\n`;
    markdown += isJapanese ?
      `- 分析の信頼度: **${Math.round(risk.confidence * 100)}%**\n` :
      `- Analysis confidence: **${Math.round(risk.confidence * 100)}%**\n`;
    
    if (risk.confidence < 0.3) {
      markdown += isJapanese ?
        '  - ⚠️ 利用可能な情報が限定的で、リスクの過小評価の可能性があります\n' :
        '  - ⚠️ Limited information available, potential for risk underestimation\n';
      markdown += isJapanese ?
        '  - より保守的なテストアプローチを検討してください\n' :
        '  - Consider a more conservative testing approach\n';
    }
  }

  // Testing recommendation rationale
  markdown += `\n**${isJapanese ? 'テスト戦略の根拠' : 'Testing Strategy Rationale'}**:\n`;
  markdown += isJapanese ?
    `- 推奨テストスコープ: **${risk.testingScope}**\n` :
    `- Recommended testing scope: **${risk.testingScope}**\n`;
  markdown += isJapanese ?
    `- 予想工数: **${risk.estimatedEffort}**\n` :
    `- Estimated effort: **${risk.estimatedEffort}**\n`;

  if (risk.testingScope === 'unit' && isMajorUpdate && !hasBreakingChanges) {
    markdown += isJapanese ?
      '- ⚠️ メジャー更新で破壊的変更が不明なため、統合テストも検討することを推奨します\n' :
      '- ⚠️ For major updates with unclear breaking changes, consider integration testing as well\n';
  }

  markdown += '\n</details>\n\n';
  
  return markdown;
}