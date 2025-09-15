/**
 * Report Generator Service
 * Handles unified report generation with GitHub links and proper execution stats
 */

import { translateRecommendations } from './translation-service.js';
import {
  generateMarkdownLink,
  autoDetectRepository,
  type GitHubLinkOptions
} from '../tools/github-link-generator.js';
import { getHighestRisk } from '../workflows/report-generator.js';
import type { ExecutionStats } from '../tools/execution-tracker.js';
import { generateRiskAssessmentBreakdown } from './risk-assessment-breakdown.js';

// Helper function to get repository URL from package name
function getRepositoryUrl(packageName: string): string | null {
  // Common mappings for popular packages
  const packageRepoMap: Record<string, string> = {
    'p-limit': 'https://github.com/sindresorhus/p-limit',
    'react': 'https://github.com/facebook/react',
    'lodash': 'https://github.com/lodash/lodash',
    'typescript': 'https://github.com/microsoft/TypeScript',
  };
  
  return packageRepoMap[packageName] || null;
}

// Helper function to normalize file paths for main branch
function normalizeFilePath(filePath: string): string {
  // Remove line number suffix first
  // Limit digits to prevent ReDoS (max 10 digits for line numbers)
  const cleanPath = filePath.replace(/:?\d{1,10}$/, '');

  // Handle various path formats and extract the final src/... part
  // Use lastIndexOf for safer pattern matching (avoids ReDoS)
  if (cleanPath.includes('worktree-agent-version/src/')) {
    const idx = cleanPath.lastIndexOf('worktree-agent-version/src/');
    if (idx !== -1) {
      return cleanPath.substring(idx + 'worktree-agent-version/'.length);
    }
  }

  if (cleanPath.includes('/src/')) {
    const idx = cleanPath.lastIndexOf('/src/');
    if (idx !== -1) {
      return cleanPath.substring(idx + 1);
    }
  }
  
  // If it already starts with src/, just clean it up
  if (cleanPath.startsWith('src/')) {
    return cleanPath.replace(/^\/+/, '');
  }
  
  // Fallback: return as-is but remove leading slashes
  return cleanPath.replace(/^\/+/, '');
}

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
// Generate library overview section
function generateLibraryOverviewSection(overview: any, isJapanese: boolean): string {
  if (!overview) return '';

  let section = `**${isJapanese ? 'ライブラリ概要' : 'Library Overview'}**: ${overview.overview}\n\n`;
  if (overview.category && overview.category !== 'unknown') {
    section += `**${isJapanese ? 'カテゴリ' : 'Category'}**: ${overview.category}\n\n`;
  }
  return section;
}

// Generate functional summary section
async function generateFunctionalSummarySection(assessment: any, dependency: any, isJapanese: boolean): Promise<string> {
  const functionalSummary = await buildFunctionalSummary(assessment, isJapanese);
  if (functionalSummary.length === 0) return '';

  let section = isJapanese ? '**機能レベルの変更（要点）**:\n' : '**Functional Changes (Summary):**\n';
  for (const b of functionalSummary) {
    section += `- ${b}\n`;
  }

  // Upstream compare link when available
  const repoUrl = getRepositoryUrl(dependency.name);
  if (repoUrl) {
    const compareUrl = `${repoUrl}/compare/v${dependency.fromVersion}...v${dependency.toVersion}`;
    section += isJapanese
      ? `  - 🔗 [上流の差分 (GitHub Compare)](${compareUrl})\n`
      : `  - 🔗 [Upstream Diff (GitHub Compare)](${compareUrl})\n`;
  }
  section += '\n';
  return section;
}

// Generate usage information section
function generateUsageInformationSection(codeImpact: any, isJapanese: boolean, linkOptions?: GitHubLinkOptions): string {
  if (!codeImpact || codeImpact.totalUsages === 0) return '';

  let section = `**${isJapanese ? '利用箇所' : 'Usage Locations'}**: ${codeImpact.totalUsages} ${isJapanese ? '箇所' : 'locations'}\n\n`;

  // Affected files with links
  section += generateAffectedFilesSection(codeImpact.affectedFiles, isJapanese, linkOptions);

  // Usage details
  section += generateUsageDetailsSection(codeImpact.usageDetails, isJapanese);

  return section;
}

// Generate affected files section
function generateAffectedFilesSection(affectedFiles: string[] | undefined, isJapanese: boolean, linkOptions?: GitHubLinkOptions): string {
  if (!affectedFiles || affectedFiles.length === 0) return '';

  let section = `**${isJapanese ? '影響ファイル' : 'Affected Files'}**:\n`;

  for (const file of affectedFiles) {
    const normalizedFile = normalizeFilePath(file);

    if (linkOptions) {
      const link = generateMarkdownLink(normalizedFile, 1, linkOptions);
      section += `- ${link}`;
    } else {
      section += `- ${normalizedFile}`;
    }

    // Add context about the file
    section += getFileContext(file, isJapanese);
    section += '\n';
  }
  section += '\n';
  return section;
}

// Get file context description
function getFileContext(file: string, isJapanese: boolean): string {
  if (file.includes('parallel')) {
    return isJapanese ? ' (並列処理制御)' : ' (parallel processing control)';
  } else if (file.includes('helper')) {
    return isJapanese ? ' (ヘルパーユーティリティ)' : ' (helper utilities)';
  } else if (file.includes('api') || file.includes('client')) {
    return isJapanese ? ' (API通信)' : ' (API communication)';
  }
  return '';
}

// Generate usage details section
function generateUsageDetailsSection(usageDetails: any[] | undefined, isJapanese: boolean): string {
  if (!usageDetails || usageDetails.length === 0) return '';

  let section = `**${isJapanese ? '利用形態' : 'Usage Patterns'}**:\n`;

  const usageTypes = groupUsageByType(usageDetails);

  section += formatImportUsage(usageTypes.import, isJapanese);
  section += formatFunctionCallUsage(usageTypes['function-call'], isJapanese);
  section += formatAssignmentUsage(usageTypes.assignment, isJapanese);
  section += formatFunctionDefinitionUsage(usageTypes['function-definition'], isJapanese);

  section += '\n';
  return section;
}

// Group usage details by type
function groupUsageByType(usageDetails: any[]): any {
  return usageDetails.reduce((acc: any, detail: any) => {
    if (!acc[detail.usage]) acc[detail.usage] = [];
    acc[detail.usage].push({
      context: detail.context,
      description: detail.description
    });
    return acc;
  }, {});
}

// Format import usage
function formatImportUsage(importUsages: any[] | undefined, isJapanese: boolean): string {
  if (!importUsages) return '';

  const importDetail = importUsages[0];
  let text = isJapanese ?
    `- **インポート**: ${importDetail.description || 'パッケージをモジュールとして読み込み'}\n` :
    `- **Import**: ${importDetail.description || 'Loading package as module'}\n`;

  if (importDetail.context && importDetail.context.length < 100) {
    text += `  \`\`\`javascript\n  ${importDetail.context}\n  \`\`\`\n`;
  }
  return text;
}

// Format function call usage
function formatFunctionCallUsage(callUsages: any[] | undefined, isJapanese: boolean): string {
  if (!callUsages) return '';

  const callDetails = callUsages.slice(0, 2);
  let text = isJapanese ?
    `- **関数呼び出し**: ${callDetails.length}箇所で実行\n` :
    `- **Function calls**: Executed in ${callDetails.length} locations\n`;

  callDetails.forEach((detail: any, index: number) => {
    if (detail.description) {
      text += `  ${index + 1}. ${detail.description}\n`;
    }
    if (detail.context && detail.context.length < 120) {
      text += `     \`${detail.context.replace(/\s+/g, ' ')}\`\n`;
    }
  });
  return text;
}

// Format assignment usage
function formatAssignmentUsage(assignmentUsages: any[] | undefined, isJapanese: boolean): string {
  if (!assignmentUsages) return '';

  const assignDetail = assignmentUsages[0];
  let text = isJapanese ?
    `- **変数代入**: ${assignDetail.description || '関数結果を変数に格納'}\n` :
    `- **Variable assignment**: ${assignDetail.description || 'Storing function results in variables'}\n`;

  if (assignDetail.context && assignDetail.context.length < 100) {
    text += `  \`${assignDetail.context.trim()}\`\n`;
  }
  return text;
}

// Format function definition usage
function formatFunctionDefinitionUsage(funcUsages: any[] | undefined, isJapanese: boolean): string {
  if (!funcUsages) return '';

  const funcDetails = funcUsages.slice(0, 2);
  return isJapanese ?
    `- **関数定義**: ${funcDetails.length}個の関数でパッケージを使用\n` :
    `- **Function definitions**: Package used in ${funcDetails.length} function(s)\n`;
}

// Main assessment section generator (refactored)
async function generateAssessmentsSection(assessments: any[], isJapanese: boolean, linkOptions?: GitHubLinkOptions): Promise<string> {
  let markdown = `#### ${isJapanese ? '📦 パッケージ分析' : '📦 Package Analysis'}\n\n`;

  for (const assessment of assessments) {
    const { dependency, overview, codeImpact, risk } = assessment;
    const riskEmoji = getRiskEmoji(risk.level);

    markdown += `##### ${dependency.name} ${dependency.fromVersion} → ${dependency.toVersion} ${riskEmoji}\n\n`;

    // Library overview
    markdown += generateLibraryOverviewSection(overview, isJapanese);
    // Risk level and impact
    markdown += `**${isJapanese ? 'リスクレベル' : 'Risk Level'}**: ${risk.level.toUpperCase()} (${isJapanese ? 'スコア' : 'Score'}: ${risk.score})\n\n`;

    // Risk assessment breakdown
    markdown += await generateRiskAssessmentBreakdown(assessment, isJapanese);

    // Functional summary
    markdown += await generateFunctionalSummarySection(assessment, dependency, isJapanese);

    // Usage information
    markdown += generateUsageInformationSection(codeImpact, isJapanese, linkOptions);

    // Recommendations
    markdown += await generateCodeImpactRecommendations(codeImpact, isJapanese);
  }

  return markdown;
}

// Generate code impact recommendations
async function generateCodeImpactRecommendations(codeImpact: any, isJapanese: boolean): Promise<string> {
  if (!codeImpact?.recommendations?.length) return '';

  let section = `**${isJapanese ? '推奨アクション' : 'Recommendations'}**:\n`;

  const translatedRecommendations = await translateRecommendations(
    codeImpact.recommendations,
    isJapanese ? 'ja' : 'en'
  );

  for (const rec of translatedRecommendations) {
    section += `- ${rec}\n`;
  }
  section += '\n';
  return section;
}

// Build high-level functional change bullets from available context
async function buildFunctionalSummary(assessment: any, isJapanese: boolean): Promise<string[]> {
  try {
    const bullets: string[] = [];
    const dep = assessment.dependency || {};
    const releaseNotes = assessment.releaseNotes || {};

    // Process breaking changes
    const breakingBullets = await processBreakingChanges(releaseNotes, isJapanese);
    bullets.push(...breakingBullets);

    // Add version jump context
    const versionBullet = getVersionJumpBullet(dep.fromVersion, dep.toVersion, isJapanese);
    if (versionBullet) {
      bullets.push(versionBullet);
    }

    // Add fallback bullets if no changes detected
    if (bullets.length === 0) {
      const fallbackBullets = getFallbackBullets(assessment, isJapanese);
      bullets.push(...fallbackBullets);
    }

    return bullets.slice(0, 5);
  } catch {
    return [];
  }
}

async function processBreakingChanges(
  releaseNotes: any,
  isJapanese: boolean
): Promise<string[]> {
  const breaking = Array.isArray(releaseNotes.breakingChanges)
    ? releaseNotes.breakingChanges
    : [];

  if (breaking.length === 0) {
    return [];
  }

  const texts = breaking
    .map((bc: any) =>
      typeof bc === 'string' ? bc : bc.text || bc.description || ''
    )
    .filter(Boolean)
    .slice(0, 3);

  return isJapanese ? await translateRecommendations(texts, 'ja') : texts;
}

function getVersionJumpBullet(
  fromVersion: string | undefined,
  toVersion: string | undefined,
  isJapanese: boolean
): string | null {
  const majorJump = getMajorJump(fromVersion, toVersion);

  if (majorJump > 0) {
    return isJapanese
      ? `メジャーバージョン更新（+${majorJump}）: 互換性に注意`
      : `Major version update (+${majorJump}): Backward compatibility may be affected`;
  }

  return null;
}

function getFallbackBullets(assessment: any, isJapanese: boolean): string[] {
  const bullets: string[] = [];

  bullets.push(
    isJapanese
      ? '破壊的変更は検出されていません（自動解析）'
      : 'No breaking API changes detected by automated analysis'
  );

  if (assessment.codeImpact?.totalUsages >= 0) {
    const n = assessment.codeImpact.totalUsages;
    bullets.push(
      isJapanese
        ? `本リポジトリでの利用箇所: ${n} 箇所`
        : `Usage in this repo: ${n} locations`
    );
  }

  return bullets;
}

function getMajorJump(from?: string, to?: string): number {
  try {
    if (!from || !to) return 0;
    const a = parseInt(String(from).split('.')[0] || '0', 10) || 0;
    const b = parseInt(String(to).split('.')[0] || '0', 10) || 0;
    return Math.max(0, b - a);
  } catch {
    return 0;
  }
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

  markdown += formatDurationStats(stats, isJapanese);
  markdown += formatAgentStats(stats, isJapanese);
  markdown += formatApiCallStats(stats, isJapanese);
  markdown += formatTokenStats(stats, isJapanese);
  markdown += formatCostStats(stats, isJapanese);
  markdown += formatDataSourceStats(stats, isJapanese);

  markdown += '\n</em></small>\n</details>\n\n';

  return markdown;
}

function formatDurationStats(stats: ExecutionStats, isJapanese: boolean): string {
  if (!stats.totalDuration) return '';
  const duration = Math.round(stats.totalDuration / 1000);
  return `- ${isJapanese ? '実行時間' : 'Duration'}: ${duration}s\n`;
}

function formatAgentStats(stats: ExecutionStats, isJapanese: boolean): string {
  let result = `- ${isJapanese ? 'エージェント数' : 'Agents Used'}: ${stats.agents.length}\n`;

  const agentNames = stats.agents.map(agent => agent.agentName).join(', ');
  if (agentNames) {
    result += `  - ${isJapanese ? '使用エージェント' : 'Agent Names'}: ${agentNames}\n`;
  }

  return result;
}

function formatApiCallStats(stats: ExecutionStats, isJapanese: boolean): string {
  let result = `- ${isJapanese ? 'API呼び出し' : 'API Calls'}: ${stats.apiCalls.total}\n`;

  const modelBreakdown = Object.entries(stats.apiCalls.byModel)
    .map(([model, count]) => `${model}: ${count}`)
    .join(', ');

  if (modelBreakdown) {
    result += `  - ${isJapanese ? 'モデル別' : 'By Model'}: ${modelBreakdown}\n`;
  }

  return result;
}

function formatTokenStats(stats: ExecutionStats, isJapanese: boolean): string {
  const totalTokens = stats.agents.reduce((sum, agent) => sum + (agent.totalTokens || 0), 0);
  if (totalTokens === 0) return '';

  let result = `- ${isJapanese ? 'トークン使用量' : 'Token Usage'}: ${totalTokens.toLocaleString()}\n`;

  const inputTokens = stats.agents.reduce((sum, agent) => sum + (agent.inputTokens || 0), 0);
  const outputTokens = stats.agents.reduce((sum, agent) => sum + (agent.outputTokens || 0), 0);

  if (inputTokens > 0 && outputTokens > 0) {
    result += `  - ${isJapanese ? '入力/出力' : 'Input/Output'}: ${inputTokens.toLocaleString()}/${outputTokens.toLocaleString()}\n`;
  }

  return result;
}

function formatCostStats(stats: ExecutionStats, isJapanese: boolean): string {
  if (stats.apiCalls.estimatedCost === undefined) return '';
  const cost = stats.apiCalls.estimatedCost.toFixed(4);
  return `- ${isJapanese ? '推定コスト' : 'Estimated Cost'}: $${cost}\n`;
}

function formatDataSourceStats(stats: ExecutionStats, isJapanese: boolean): string {
  if (!stats.dataSourcesUsed || stats.dataSourcesUsed.length === 0) return '';
  const dataSources = stats.dataSourcesUsed.join(', ');
  return `- ${isJapanese ? 'データソース' : 'Data Sources'}: ${dataSources}\n`;
}

