import type {
  AnalysisResult,
  BreakingChange,
  DependencyUsage,
  DependentInfo,
  APIUsage,
  ConfigFileUsage,
} from '../types/index.js';
import { packageKnowledgeBase } from './package-knowledge.js';
import {
  generateMarkdownLink,
  getRepositoryFromGit,
  type GitHubLinkOptions,
} from '../mastra/tools/github-link-generator.js';
import { translateRecommendations } from '../mastra/services/translation-service.js';
import { getPackageRepository, extractGitHubRepo, getPackageFields } from './npm-registry.js';
import { summarizeApiDiff } from './api-diff-summary.js';

export async function generateEnhancedReport(
  result: AnalysisResult,
  format: 'markdown' | 'json',
  language: 'en' | 'ja' = 'en'
): Promise<string> {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const isJa = language === 'ja';
  let report = isJa
    ? '# renovate-safety 解析レポート\n\n'
    : '# Renovate Safety Analysis Report\n\n';

  // Risk assessment header
  report += generateRiskAssessmentHeader(result, isJa);

  // Package information section
  report += await generatePackageInfoSection(result, isJa);

  // Functional changes section
  report += await generateFunctionalChangesSection(result, isJa);

  // Summary section
  report += await generateSummarySection(result, isJa);

  // Dependency usage section
  report += generateDependencyUsageSection(result, isJa);

  // Breaking changes section
  report += generateBreakingChangesSection(result, isJa);

  // API usage section
  report += await generateApiUsageSection(result, isJa);

  // Deep analysis section
  report += generateDeepAnalysisSection(result, isJa);

  // Recommendations section
  report += await generateRecommendationsSection(result, isJa);

  // Summary and recommendation
  report += generateSummaryAndRecommendation(result, isJa);

  // Risk analysis details
  report += await generateRiskAnalysisDetails(result, isJa);

  // Footer
  report += generateFooter(isJa);

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

function getRiskDescription(level: string, isJa: boolean): string {
  if (!isJa) {
    const descriptions = {
      safe: 'This update appears to be safe with no breaking changes detected.',
      low: 'This update has low risk with minimal changes that should not affect your code.',
      medium: 'This update requires attention as it may contain changes affecting your code.',
      high: 'This update has significant changes that will likely require code modifications.',
      critical: 'This update contains major breaking changes requiring immediate attention.',
      unknown: 'Unable to determine risk level due to insufficient information.',
    };
    return (
      descriptions[level as keyof typeof descriptions] || 'Risk level could not be determined.'
    );
  }
  const ja = {
    safe: '破壊的変更は検出されておらず、安全に更新できる見込みです。',
    low: '影響は小さく、既存コードへの影響は限定的と考えられます。',
    medium: '影響が出る可能性があるため、内容の確認とテストを推奨します。',
    high: '影響が大きい可能性が高く、コード修正が必要になる見込みです。',
    critical: '重大な破壊的変更が含まれる可能性が高く、慎重な対応が必要です。',
    unknown: '情報が不足しているため、リスクレベルを特定できません。',
  };
  return ja[level as keyof typeof ja] || 'リスクレベルを判定できません。';
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
  } catch (error) {
    console.warn(
      'Version comparison failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return null; // Unable to determine version jump due to parsing error
  }
}

// Fallback confidence calculation when enhanced risk assessment is not available
function calculateFallbackConfidence(result: AnalysisResult): number {
  let confidence = 0;

  // Information source quality (matches enhanced-grade.ts logic)
  if (result.changelogDiff) {
    if (result.changelogDiff.source === 'github') confidence += 0.4;
    else if (result.changelogDiff.source === 'github+npm') confidence += 0.5;
    else confidence += 0.3;
  }

  if (result.codeDiff) confidence += 0.2;

  // Usage analysis quality
  if (result.apiUsages.length > 0) {
    const hasProductionUsage = result.apiUsages.some(
      (u: { context?: string }) => u.context === 'production'
    );
    const hasTestUsage = result.apiUsages.some((u: { context?: string }) => u.context === 'test');
    if (hasProductionUsage && hasTestUsage) confidence += 0.2;
    else if (hasProductionUsage || hasTestUsage) confidence += 0.1;
  }

  // LLM analysis adds minimal confidence (as it's supplementary)
  if (result.llmSummary) confidence += 0.1;

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

function formatBreakingChange(change: BreakingChange | string): string {
  // Handle both string and object formats
  if (typeof change === 'string') {
    return change
      .replace(/^[\s-*]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Format with source if available
  const text = change.line
    .replace(/^[\s-*]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return change.source ? `${text} (Source: ${change.source})` : text;
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

async function getLibraryDescription(packageName: string, isJa: boolean): Promise<string | null> {
  // First, try to fetch from npm registry
  try {
    const packageInfo = await getPackageFields(packageName, ['description']);
    if (packageInfo?.description) {
      // Return the npm description (usually in English)
      // For now, use the same description for both languages
      // In the future, could translate using AI
      // Ensure description is a string before converting
      const desc = packageInfo.description;
      return typeof desc === 'string' ? desc : JSON.stringify(desc);
    }
  } catch (error) {
    // Log error for debugging but fall through to hardcoded descriptions
    console.debug(`Failed to fetch package description for ${packageName}:`, error);
  }

  // Fallback to hardcoded descriptions for known packages
  const descriptions: Record<string, { ja: string; en: string }> = {
    'p-limit': {
      ja: 'p-limitは非同期関数の並列実行数を制限するためのライブラリです。Promise.all()で大量の非同期処理を実行する際に、同時実行数を制御してリソースの枯渇を防ぎます。主にAPI呼び出しやファイル処理などの並列処理で使用されます。',
      en: 'p-limit is a library for limiting the number of concurrent async operations. It prevents resource exhaustion when using Promise.all() with many async operations by controlling concurrency. Commonly used for API calls and file processing.',
    },
    react: {
      ja: 'ReactはFacebookが開発したUIライブラリです。コンポーネントベースのアーキテクチャで、宣言的なUIの構築を可能にします。仮想DOMを使用して効率的な画面更新を実現します。',
      en: 'React is a UI library developed by Facebook. It enables declarative UI building with component-based architecture. Uses virtual DOM for efficient updates.',
    },
    ora: {
      ja: 'oraはターミナル用のエレガントなスピナー（ローディング表示）を提供するライブラリです。CLIツールで長時間実行されるプロセスの進行状況を視覚的に表現できます。カスタマイズ可能なスピナーパターンと色、テキストメッセージをサポートしています。',
      en: 'ora provides elegant terminal spinners for Node.js CLI applications. It visually represents the progress of long-running processes with customizable spinner patterns, colors, and text messages.',
    },
    lodash: {
      ja: 'Lodashは汎用的なユーティリティライブラリです。配列、オブジェクト、文字列操作などの便利な関数を提供します。パフォーマンスを重視した実装が特徴です。',
      en: 'Lodash is a utility library providing helpful functions for arrays, objects, and strings. Known for performance-optimized implementations.',
    },
    axios: {
      ja: 'AxiosはPromiseベースのHTTPクライアントライブラリです。ブラウザとNode.js両方で動作し、リクエスト/レスポンスのインターセプト機能を提供します。',
      en: 'Axios is a Promise-based HTTP client that works in both browser and Node.js. Provides request/response interceptor functionality.',
    },
  };

  const desc = descriptions[packageName];
  if (!desc) {
    return null;
  }
  return isJa ? desc.ja : desc.en;
}

function generateRiskAssessmentHeader(result: AnalysisResult, isJa: boolean): string {
  const riskEmoji = getRiskEmoji(result.riskAssessment.level);
  const riskDescription = getRiskDescription(result.riskAssessment.level, isJa);
  let report = isJa
    ? `## ${riskEmoji} リスク評価: ${result.riskAssessment.level.toUpperCase()}\n`
    : `## ${riskEmoji} Risk Assessment: ${result.riskAssessment.level.toUpperCase()}\n`;
  report += `${riskDescription}\n\n`;
  return report;
}

async function generatePackageInfoSection(result: AnalysisResult, isJa: boolean): Promise<string> {
  let report = isJa ? '### 📦 パッケージ更新\n' : '### 📦 Package Update\n';
  report += `${isJa ? '- **パッケージ**' : '- **Package**'}: \`${result.package.name}\`\n`;
  report += `${isJa ? '- **バージョン**' : '- **Version**'}: ${result.package.fromVersion} → ${result.package.toVersion}\n`;

  // Add version jump information
  const versionJump = calculateVersionJump(result.package.fromVersion, result.package.toVersion);
  if (versionJump) {
    report += `- **Version Jump**: ${versionJump}\n`;
  }

  report += generateChangelogInfo(result, isJa);
  report += generateCodeDiffInfo(result, isJa);
  report += generateDependencyTypeInfo(result, isJa);
  report += await generateLibraryDescription(result, isJa);
  report += generateConfidenceInfo(result);
  report += await generateExternalLinksInfo(result, isJa);

  return report;
}

function generateChangelogInfo(result: AnalysisResult, isJa: boolean): string {
  const changelogLabel = isJa ? '- **チェンジログソース**' : '- **Changelog Source**';
  const changelogValue = result.changelogDiff?.source || (isJa ? '未取得' : 'Not found');
  return `${changelogLabel}: ${changelogValue}\n`;
}

function generateCodeDiffInfo(result: AnalysisResult, isJa: boolean): string {
  let codeDiffStatus;
  if (result.codeDiff) {
    codeDiffStatus = `${result.codeDiff.filesChanged} files changed`;
  } else {
    codeDiffStatus = isJa ? '利用不可' : 'Not available';
  }
  return `${isJa ? '- **コード差分**' : '- **Code Diff**'}: ${codeDiffStatus}\n`;
}

function generateDependencyTypeInfo(result: AnalysisResult, isJa: boolean): string {
  const depTypeLabel = isJa ? '- **依存関係の種類**' : '- **Dependency Type**';
  const depTypeValue = (() => {
    if (!result.dependencyUsage) return 'dependencies';
    let directText: string;
    if (result.dependencyUsage.isDirect) {
      directText = isJa ? '直接' : 'Direct';
    } else {
      directText = isJa ? '間接' : 'Transitive';
    }
    return `${directText} ${result.dependencyUsage.usageType || 'dependencies'}`;
  })();
  return `${depTypeLabel}: ${depTypeValue}\n`;
}

async function generateLibraryDescription(result: AnalysisResult, isJa: boolean): Promise<string> {
  const libraryDescription = await getLibraryDescription(result.package.name, isJa);
  if (libraryDescription) {
    return `\n${isJa ? '#### 📚 ライブラリ概要' : '#### 📚 Library Overview'}\n${libraryDescription}\n\n`;
  }
  return '';
}

function generateConfidenceInfo(result: AnalysisResult): string {
  const confidence = calculateFallbackConfidence(result);
  return `- **Analysis Confidence**: ${getConfidenceIndicator(confidence)} (${Math.round(confidence * 100)}%)\n\n`;
}

async function generateExternalLinksInfo(result: AnalysisResult, isJa: boolean): Promise<string> {
  try {
    const repoUrl = await getPackageRepository(result.package.name);
    const repo = extractGitHubRepo(repoUrl || undefined);
    if (repo) {
      const compareUrl = `https://github.com/${repo.owner}/${repo.repo}/compare/v${result.package.fromVersion}...v${result.package.toVersion}`;
      let report = isJa
        ? `- **外部差分リンク**: [GitHub Compare](${compareUrl})\n`
        : `- **External Diff**: [GitHub Compare](${compareUrl})\n`;
      report += isJa
        ? `- **npm diff コマンド**: \`npm diff ${result.package.name}@${result.package.fromVersion} ${result.package.name}@${result.package.toVersion}\`\n`
        : `- **npm diff command**: \`npm diff ${result.package.name}@${result.package.fromVersion} ${result.package.name}@${result.package.toVersion}\`\n`;
      return report + '\n';
    }
  } catch (error) {
    console.warn(
      `Library intelligence fetch failed for ${result.package.name}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
  return '';
}

async function generateFunctionalChangesSection(
  result: AnalysisResult,
  isJa: boolean
): Promise<string> {
  if (!result.codeDiff) return '';

  try {
    const { bullets } = await summarizeApiDiff(result.codeDiff, isJa ? 'ja' : 'en');
    if (bullets.length > 0) {
      let report = isJa
        ? '### 🔎 機能レベルの変更（要点）\n'
        : '### 🔎 Functional Changes (Summary)\n';
      bullets.slice(0, 5).forEach((b) => (report += `- ${b}\n`));
      return report + '\n';
    }
  } catch (error) {
    console.warn(
      `API diff analysis failed for ${result.package.name}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
  return '';
}

async function generateSummarySection(result: AnalysisResult, isJa: boolean): Promise<string> {
  let report = '';

  if (result.llmSummary) {
    report += isJa ? '### 📝 サマリ\n' : '### 📝 Summary\n';
    report += result.llmSummary.summary + '\n\n';

    if (result.llmSummary.breakingChanges.length > 0) {
      report += isJa ? '**AI推定の破壊的変更:**\n' : '**AI-Identified Breaking Changes:**\n';
      result.llmSummary.breakingChanges.forEach((change) => {
        report += `- ${change}\n`;
      });
      report += '\n';
    }
  }

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

  return report;
}

function generateDependencyUsageSection(result: AnalysisResult, isJa: boolean): string {
  if (!result.dependencyUsage) return '';

  let report = isJa ? '### 🌳 依存関係の利用状況\n' : '### 🌳 Dependency Usage\n';
  const typeLabel = isJa ? '- **種類**' : '- **Type**';
  let typeValue: string;
  if (result.dependencyUsage.isDirect) {
    typeValue = isJa ? '直接依存' : 'Direct';
  } else {
    typeValue = isJa ? '間接依存' : 'Transitive';
  }
  report += `${typeLabel}: ${typeValue}\n`;
  report += `${isJa ? '- **カテゴリ**' : '- **Category**'}: ${result.dependencyUsage.usageType}\n`;
  const impactLabel = isJa ? '- **影響範囲**' : '- **Impact**';
  const impactValue = isJa
    ? `${result.dependencyUsage.dependents.length} パッケージに影響`
    : `Affects ${result.dependencyUsage.dependents.length} packages`;
  report += `${impactLabel}: ${impactValue}\n\n`;

  if (!result.dependencyUsage.isDirect) {
    report += generateTransitiveDependencyDetails(result.dependencyUsage);
  }

  return report;
}

function generateTransitiveDependencyDetails(dependencyUsage: DependencyUsage): string {
  const paths = dependencyUsage.dependents.slice(0, 5);
  const dependencyType = paths[0].type === 'direct' ? 'Direct' : 'Transitive';
  const displayCount = Math.min(5, dependencyUsage.dependents.length);
  const totalCount = dependencyUsage.dependents.length;
  const countSuffix = totalCount > 5 ? ' of ' + totalCount : '';

  let report = `**${dependencyType} Dependencies (${displayCount}${countSuffix}):**\n`;
  paths.forEach((dep: DependentInfo) => {
    const pathStr = dep.path.join(' → ');
    report += `- ${dep.name} (${dep.version}) - via ${pathStr}\n`;
  });
  if (totalCount > 5) {
    report += `- ... and ${totalCount - 5} more\n`;
  }
  return report + '\n';
}

function generateBreakingChangesSection(result: AnalysisResult, isJa: boolean): string {
  if (result.breakingChanges.length === 0) return '';

  let report = isJa
    ? `### ⚠️ 破壊的変更 (${result.breakingChanges.length})\n`
    : `### ⚠️ Breaking Changes (${result.breakingChanges.length})\n`;
  const grouped = groupBreakingChanges(result.breakingChanges);

  for (const [severity, changes] of Object.entries(grouped)) {
    if (changes.length > 0) {
      report += `\n**${severity.charAt(0).toUpperCase() + severity.slice(1)} Changes:**\n`;
      changes.forEach((change) => {
        report += `- ${formatBreakingChange(change)}\n`;
      });
    }
  }
  return report + '\n';
}

async function generateApiUsageSection(result: AnalysisResult, isJa: boolean): Promise<string> {
  if (result.apiUsages.length === 0) return '';

  let report = isJa ? `### 🔍 API利用箇所解析\n` : `### 🔍 API Usage Analysis\n`;

  const codeUsages = result.apiUsages.filter(
    (u: { context?: string; type?: string }) => u.context !== 'config' && u.type !== 'config'
  );
  const configUsages = result.apiUsages.filter(
    (u: { context?: string; type?: string }) => u.context === 'config' || u.type === 'config'
  );

  if (codeUsages.length > 0) {
    report += await generateCodeUsageSection(codeUsages, result.package.name, isJa);
  }

  if (configUsages.length > 0) {
    report += generateConfigUsageSection(configUsages, isJa);
  }

  return report;
}

async function generateCodeUsageSection(
  codeUsages: APIUsage[],
  packageName: string,
  isJa: boolean
): Promise<string> {
  let report = isJa
    ? `#### 📝 コード上のAPI利用 (${codeUsages.length} 箇所)\n`
    : `#### 📝 Code API Usage (${codeUsages.length} locations)\n`;

  const productionUsages = codeUsages.filter(
    (u: { context?: string }) => u.context === 'production'
  );
  const testUsages = codeUsages.filter((u: { context?: string }) => u.context === 'test');

  if (productionUsages.length > 0) {
    report += isJa
      ? `- **本番コード**: ${productionUsages.length} 箇所\n`
      : `- **Production code**: ${productionUsages.length} locations\n`;
  }
  if (testUsages.length > 0) {
    report += isJa
      ? `- **テストコード**: ${testUsages.length} 箇所\n`
      : `- **Test code**: ${testUsages.length} locations\n`;
  }
  report += '\n';

  let linkOptions: GitHubLinkOptions | null = null;
  try {
    const repo = await getRepositoryFromGit();
    if (repo) linkOptions = { repository: repo };
  } catch (error) {
    console.warn(
      'Failed to get git repository info:',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }

  const byFile = groupBy(codeUsages, 'filePath');
  const fileList = Object.entries(byFile);

  for (const [file, usages] of fileList) {
    report += `**${file}** (${usages.length} ${isJa ? '箇所' : 'usages'})\n`;

    const usageDescription = getUsageDescription(file, packageName, isJa);
    if (usageDescription) {
      report += `${isJa ? '用途' : 'Usage'}: ${usageDescription}\n`;
    }

    usages.forEach((usage: { line?: number; context?: string; usageType?: string }) => {
      const line = usage.line || 1;
      const link = linkOptions ? generateMarkdownLink(file, line, linkOptions) : `${file}:${line}`;
      const ctx = usage.context || usage.usageType || (isJa ? '利用' : 'usage');
      report += `- ${link} — ${ctx}\n`;
    });
    report += '\n';
  }

  return report;
}

function generateConfigUsageSection(configUsages: ConfigFileUsage[], isJa: boolean): string {
  let report = isJa
    ? `#### ⚙️ 設定/メタデータ参照 (${configUsages.length} 箇所)\n`
    : `#### ⚙️ Config/Metadata References (${configUsages.length} locations)\n`;

  const configFiles = [...new Set(configUsages.map((u) => u.file))];
  configFiles.slice(0, 5).forEach((file) => {
    report += `- ${file}\n`;
  });
  if (configFiles.length > 5) {
    report += isJa
      ? `- ... 他 ${configFiles.length - 5} ファイル\n`
      : `- ... and ${configFiles.length - 5} more files\n`;
  }
  return report + '\n';
}

function generateDeepAnalysisSection(result: AnalysisResult, _isJa: boolean): string {
  if (!result.deepAnalysis) return '';

  let report = '### 🔬 Deep Analysis Results\n';
  report += `- **Files analyzed**: ${result.deepAnalysis.totalFiles}\n`;
  report += `- **Files using package**: ${result.deepAnalysis.filesUsingPackage}\n`;
  report += `- **Test vs Production**: ${result.deepAnalysis.usageSummary.testVsProduction.test} test files, ${result.deepAnalysis.usageSummary.testVsProduction.production} production files\n`;

  if (result.deepAnalysis.usageSummary.mostUsedAPIs.length > 0) {
    report += '\n**Most Used APIs:**\n';
    result.deepAnalysis.usageSummary.mostUsedAPIs.slice(0, 5).forEach((api) => {
      report += `- \`${api.api}\`: ${api.count} usages\n`;
    });
  }
  return report + '\n';
}

async function generateRecommendationsSection(
  result: AnalysisResult,
  isJa: boolean
): Promise<string> {
  let report = isJa ? '### 🎯 推奨アクション\n\n' : '### 🎯 Actionable Recommendations\n\n';

  const priority = getPriorityFromRisk(result.riskAssessment.level);
  const timeRequired = getTimeEstimate(result.riskAssessment.estimatedEffort);
  let automatable = isAutomatable(result);
  if (isJa) {
    if (automatable === 'Yes') {
      automatable = '可能';
    } else if (automatable === 'No') {
      automatable = '不可';
    } else if (automatable === 'Partially') {
      automatable = '一部可能';
    }
  }

  report += isJa ? `#### ${priority} の確認\n` : `#### ${priority} Verification\n`;
  report += isJa
    ? `**優先度:** ${priority} | **所要時間:** ${timeRequired} | **自動化可:** ${automatable}\n\n`
    : `**Priority:** ${priority} | **Time Required:** ${timeRequired} | **Automatable:** ${automatable}\n\n`;

  report += isJa ? '**アクション:**\n' : '**Actions:**\n';
  let actions = generateDetailedActions(result);
  if (isJa) {
    try {
      actions = await translateRecommendations(actions, 'ja');
    } catch (error) {
      console.warn(
        'Translation service failed, using original actions:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
  actions.forEach((action: string) => {
    report += `- ${action}\n`;
  });
  return report + '\n';
}

function generateSummaryAndRecommendation(result: AnalysisResult, isJa: boolean): string {
  let report = isJa ? '### 💡 サマリ\n' : '### 💡 Summary\n';
  return report + result.recommendation + '\n\n';
}

async function generateRiskAnalysisDetails(result: AnalysisResult, isJa: boolean): Promise<string> {
  let report = isJa ? '### 📊 リスク分析詳細\n' : '### 📊 Risk Analysis Details\n';
  report += `${isJa ? '- **リスクレベル**' : '- **Risk Level**'}: ${result.riskAssessment.level}\n`;

  if (result.riskAssessment.level === 'unknown') {
    report += `- **Reason**: Insufficient information for accurate assessment\n`;
  } else {
    const description = getRiskLevelDescription(result.riskAssessment.level);
    report += `${isJa ? '- **説明**' : '- **Description**'}: ${description}\n`;
  }

  report += generateRiskDetailsInfo(result, isJa);
  report += await generateRiskFactors(result, isJa);

  return report;
}

function generateRiskDetailsInfo(result: AnalysisResult, isJa: boolean): string {
  let report = `${isJa ? '- **概算工数**' : '- **Estimated Effort**'}: ${result.riskAssessment.estimatedEffort}\n`;
  report += `${isJa ? '- **必要なテスト範囲**' : '- **Required Testing Scope**'}: ${result.riskAssessment.testingScope}\n`;
  report += `${isJa ? '- **検出された破壊的変更**' : '- **Breaking Changes Found**'}: ${result.breakingChanges.length}\n`;
  report += `${isJa ? '- **API利用検出数**' : '- **API Usages Found**'}: ${result.apiUsages.length}\n`;

  const aiLabel = isJa ? '- **AI解析**' : '- **AI Analysis**';
  let aiValue: string;
  if (result.llmSummary) {
    aiValue = isJa ? '実施済み' : 'Completed';
  } else {
    aiValue = isJa ? 'スキップ' : 'Skipped';
  }
  report += `${aiLabel}: ${aiValue}\n`;

  const deepLabel = isJa ? '- **詳細解析**' : '- **Deep Analysis**';
  let deepValue: string;
  if (result.deepAnalysis) {
    deepValue = isJa ? '実施済み' : 'Completed';
  } else {
    deepValue = isJa ? '無効' : 'Disabled';
  }
  report += `${deepLabel}: ${deepValue}\n\n`;

  return report;
}

async function generateRiskFactors(result: AnalysisResult, isJa: boolean): Promise<string> {
  let report = isJa ? '**根拠 (Risk Factors):**\n' : '**Risk Factors:**\n';
  const factors = result.riskAssessment.factors || [];
  const factorsJa = isJa ? await translateRecommendations(factors, 'ja') : factors;
  factorsJa.forEach((factor) => {
    report += `- ${factor}\n`;
  });
  return report + '\n';
}

function generateFooter(isJa: boolean): string {
  return (
    '---\n' +
    (isJa
      ? '*[renovate-safety](https://github.com/chaspy/renovate-safety) v1.1.0 により生成*'
      : '*Generated by [renovate-safety](https://github.com/chaspy/renovate-safety) v1.1.0*')
  );
}

function getUsageDescription(filePath: string, packageName: string, isJa: boolean): string | null {
  // Special descriptions for specific usage patterns
  if (packageName === 'p-limit' && filePath.includes('parallel-helpers')) {
    return isJa
      ? '並列処理のヘルパー関数で同時実行数を制御するために使用。複数の非同期操作を効率的に処理'
      : 'Used in parallel processing helpers to control concurrency. Manages efficient processing of multiple async operations';
  }

  if (filePath.includes('test') || filePath.includes('spec')) {
    return isJa ? 'テストコードでの利用' : 'Used in test code';
  }

  if (filePath.includes('config')) {
    return isJa ? '設定ファイルでの定義' : 'Defined in configuration';
  }

  if (filePath.includes('index')) {
    return isJa ? 'エントリーポイントでの利用' : 'Used in entry point';
  }

  return null;
}
