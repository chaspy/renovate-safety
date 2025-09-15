import type { AnalysisResult, BreakingChange } from '../types/index.js';
import { packageKnowledgeBase } from './package-knowledge.js';
import {
  generateMarkdownLink,
  getRepositoryFromGit,
  type GitHubLinkOptions,
} from '../mastra/tools/github-link-generator.js';
import { translateRecommendations } from '../mastra/services/translation-service.js';
import { getPackageRepository, extractGitHubRepo } from './npm-registry.js';
import { summarizeApiDiff } from './api-diff-summary.js';

export async function generateEnhancedReport(
  result: AnalysisResult,
  format: 'markdown' | 'json',
  language: 'en' | 'ja' = 'en'
): Promise<string> {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  // Generate enhanced markdown report
  const isJa = language === 'ja';
  let report = isJa
    ? '# renovate-safety 解析レポート\n\n'
    : '# Renovate Safety Analysis Report\n\n';

  // Risk level with emoji and enhanced description
  const riskEmoji = getRiskEmoji(result.riskAssessment.level);
  const riskDescription = getRiskDescription(result.riskAssessment.level, isJa);
  report += isJa
    ? `## ${riskEmoji} リスク評価: ${result.riskAssessment.level.toUpperCase()}\n`
    : `## ${riskEmoji} Risk Assessment: ${result.riskAssessment.level.toUpperCase()}\n`;
  report += `${riskDescription}\n\n`;

  // Package information section
  report += isJa ? '### 📦 パッケージ更新\n' : '### 📦 Package Update\n';
  report += `${isJa ? '- **パッケージ**' : '- **Package**'}: \`${result.package.name}\`\n`;
  report += `${isJa ? '- **バージョン**' : '- **Version**'}: ${result.package.fromVersion} → ${result.package.toVersion}\n`;

  // Add version jump information
  const versionJump = calculateVersionJump(result.package.fromVersion, result.package.toVersion);
  if (versionJump) {
    report += `- **Version Jump**: ${versionJump}\n`;
  }

  const changelogLabel = isJa ? '- **チェンジログソース**' : '- **Changelog Source**';
  const changelogValue = result.changelogDiff?.source || (isJa ? '未取得' : 'Not found');
  report += `${changelogLabel}: ${changelogValue}\n`;
  const codeDiffStatus = result.codeDiff
    ? `${result.codeDiff.filesChanged} files changed`
    : isJa
      ? '利用不可'
      : 'Not available';
  report += `${isJa ? '- **コード差分**' : '- **Code Diff**'}: ${codeDiffStatus}\n`;
  const depTypeLabel = isJa ? '- **依存関係の種類**' : '- **Dependency Type**';
  const depTypeValue = (() => {
    if (!result.dependencyUsage) return 'dependencies';
    const directText = result.dependencyUsage.isDirect
      ? isJa
        ? '直接'
        : 'Direct'
      : isJa
        ? '間接'
        : 'Transitive';
    return `${directText} ${result.dependencyUsage.usageType || 'dependencies'}`;
  })();
  report += `${depTypeLabel}: ${depTypeValue}\n`;

  // Add library description for well-known packages
  const libraryDescription = getLibraryDescription(result.package.name, isJa);
  if (libraryDescription) {
    report += `\n${isJa ? '#### 📚 ライブラリ概要' : '#### 📚 Library Overview'}\n`;
    report += `${libraryDescription}\n\n`;
  }

  // Information confidence indicator - use the enhanced risk assessment confidence
  const confidence = result.riskAssessment.confidence || calculateFallbackConfidence(result);
  report += `- **Analysis Confidence**: ${getConfidenceIndicator(confidence)} (${Math.round(confidence * 100)}%)\n`;
  report += '\n';

  // Upstream compare + npm diff command (concrete version diff info)
  try {
    const repoUrl = await getPackageRepository(result.package.name);
    const repo = extractGitHubRepo(repoUrl || undefined);
    if (repo) {
      const compareUrl = `https://github.com/${repo.owner}/${repo.repo}/compare/v${result.package.fromVersion}...v${result.package.toVersion}`;
      report += isJa
        ? `- **外部差分リンク**: [GitHub Compare](${compareUrl})\n`
        : `- **External Diff**: [GitHub Compare](${compareUrl})\n`;
      report += isJa
        ? `- **npm diff コマンド**: \`npm diff ${result.package.name}@${result.package.fromVersion} ${result.package.name}@${result.package.toVersion}\`\n`
        : `- **npm diff command**: \`npm diff ${result.package.name}@${result.package.fromVersion} ${result.package.name}@${result.package.toVersion}\`\n`;
      report += '\n';
    }
  } catch {}

  // Functional-level change summary from code diff (if available)
  if (result.codeDiff) {
    try {
      const { bullets } = await summarizeApiDiff(result.codeDiff, isJa ? 'ja' : 'en');
      if (bullets.length > 0) {
        report += isJa
          ? '### 🔎 機能レベルの変更（要点）\n'
          : '### 🔎 Functional Changes (Summary)\n';
        bullets.slice(0, 5).forEach((b) => (report += `- ${b}\n`));
        report += '\n';
      }
    } catch {}
  }

  // Summary section
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
    report += isJa ? '### 🌳 依存関係の利用状況\n' : '### 🌳 Dependency Usage\n';
    const typeLabel = isJa ? '- **種類**' : '- **Type**';
    const typeValue = result.dependencyUsage.isDirect
      ? isJa
        ? '直接依存'
        : 'Direct'
      : isJa
        ? '間接依存'
        : 'Transitive';
    report += `${typeLabel}: ${typeValue}\n`;
    report += `${isJa ? '- **カテゴリ**' : '- **Category**'}: ${result.dependencyUsage.usageType}\n`;
    const impactLabel = isJa ? '- **影響範囲**' : '- **Impact**';
    const impactValue = isJa
      ? `${result.dependencyUsage.dependents.length} パッケージに影響`
      : `Affects ${result.dependencyUsage.dependents.length} packages`;
    report += `${impactLabel}: ${impactValue}\n\n`;

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
    report += isJa
      ? `### ⚠️ 破壊的変更 (${result.breakingChanges.length})\n`
      : `### ⚠️ Breaking Changes (${result.breakingChanges.length})\n`;
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

  // API usage analysis - separated by type
  if (result.apiUsages.length > 0) {
    report += isJa ? `### 🔍 API利用箇所解析\n` : `### 🔍 API Usage Analysis\n`;

    // Separate code usage from config references
    const codeUsages = result.apiUsages.filter(
      (u: any) => u.context !== 'config' && u.type !== 'config'
    );
    const configUsages = result.apiUsages.filter(
      (u: any) => u.context === 'config' || u.type === 'config'
    );

    // Code usage section
    if (codeUsages.length > 0) {
      report += isJa
        ? `#### 📝 コード上のAPI利用 (${codeUsages.length} 箇所)\n`
        : `#### 📝 Code API Usage (${codeUsages.length} locations)\n`;

      const productionUsages = codeUsages.filter((u: any) => u.context === 'production');
      const testUsages = codeUsages.filter((u: any) => u.context === 'test');

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

      // Try to auto-detect repository for clickable links
      let linkOptions: GitHubLinkOptions | null = null;
      try {
        const repo = await getRepositoryFromGit();
        if (repo) linkOptions = { repository: repo };
      } catch {}

      const byFile = groupBy(codeUsages, 'filePath');
      const fileList = Object.entries(byFile).slice(0, 5);

      for (const [file, usages] of fileList) {
        report += `**${file}** (${usages.length} ${isJa ? '箇所' : 'usages'})\n`;

        // Add usage description for specific files
        const usageDescription = getUsageDescription(file, result.package.name, isJa);
        if (usageDescription) {
          report += `${isJa ? '用途' : 'Usage'}: ${usageDescription}\n`;
        }

        usages.slice(0, 3).forEach((usage: any) => {
          const line = usage.line || 1;
          const link = linkOptions
            ? generateMarkdownLink(file, line, linkOptions)
            : `${file}:${line}`;
          const ctx = usage.context || usage.usageType || (isJa ? '利用' : 'usage');
          report += `- ${link} — ${ctx}\n`;
        });
        if (usages.length > 3) {
          report += isJa
            ? `- ... 他 ${usages.length - 3} 箇所\n`
            : `- ... and ${usages.length - 3} more\n`;
        }
        report += '\n';
      }

      if (Object.keys(byFile).length > 5) {
        report += isJa
          ? `... 他 ${Object.keys(byFile).length - 5} ファイル\n\n`
          : `... and ${Object.keys(byFile).length - 5} more files\n\n`;
      }
    }

    // Config/metadata references section
    if (configUsages.length > 0) {
      report += isJa
        ? `#### ⚙️ 設定/メタデータ参照 (${configUsages.length} 箇所)\n`
        : `#### ⚙️ Config/Metadata References (${configUsages.length} locations)\n`;

      const configFiles = [...new Set(configUsages.map((u: any) => u.filePath || u.file))];
      configFiles.slice(0, 5).forEach((file) => {
        report += `- ${file}\n`;
      });
      if (configFiles.length > 5) {
        report += isJa
          ? `- ... 他 ${configFiles.length - 5} ファイル\n`
          : `- ... and ${configFiles.length - 5} more files\n`;
      }
      report += '\n';
    }
  }

  // Removed code diff highlights section as it was not providing useful information

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
  report += isJa ? '### 🎯 推奨アクション\n\n' : '### 🎯 Actionable Recommendations\n\n';

  const priority = getPriorityFromRisk(result.riskAssessment.level);
  const timeRequired = getTimeEstimate(result.riskAssessment.estimatedEffort);
  let automatable = isAutomatable(result);
  if (isJa) {
    automatable =
      automatable === 'Yes'
        ? '可能'
        : automatable === 'No'
          ? '不可'
          : automatable === 'Partially'
            ? '一部可能'
            : automatable;
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
    } catch {}
  }
  actions.forEach((action: string) => {
    report += `- ${action}\n`;
  });
  report += '\n';

  // Summary and recommendation
  report += isJa ? '### 💡 サマリ\n' : '### 💡 Summary\n';
  report += result.recommendation + '\n\n';

  // Risk analysis details
  report += isJa ? '### 📊 リスク分析詳細\n' : '### 📊 Risk Analysis Details\n';
  report += `${isJa ? '- **リスクレベル**' : '- **Risk Level**'}: ${result.riskAssessment.level}\n`;

  if (result.riskAssessment.level === 'unknown') {
    report += `- **Reason**: Insufficient information for accurate assessment\n`;
  } else {
    const description = getRiskLevelDescription(result.riskAssessment.level);
    report += `${isJa ? '- **説明**' : '- **Description**'}: ${description}\n`;
  }

  report += `${isJa ? '- **概算工数**' : '- **Estimated Effort**'}: ${result.riskAssessment.estimatedEffort}\n`;
  report += `${isJa ? '- **必要なテスト範囲**' : '- **Required Testing Scope**'}: ${result.riskAssessment.testingScope}\n`;
  report += `${isJa ? '- **検出された破壊的変更**' : '- **Breaking Changes Found**'}: ${result.breakingChanges.length}\n`;
  report += `${isJa ? '- **API利用検出数**' : '- **API Usages Found**'}: ${result.apiUsages.length}\n`;
  const aiLabel = isJa ? '- **AI解析**' : '- **AI Analysis**';
  const aiValue = result.llmSummary
    ? isJa
      ? '実施済み'
      : 'Completed'
    : isJa
      ? 'スキップ'
      : 'Skipped';
  report += `${aiLabel}: ${aiValue}\n`;
  const deepLabel = isJa ? '- **詳細解析**' : '- **Deep Analysis**';
  const deepValue = result.deepAnalysis
    ? isJa
      ? '実施済み'
      : 'Completed'
    : isJa
      ? '無効'
      : 'Disabled';
  report += `${deepLabel}: ${deepValue}\n\n`;

  report += isJa ? '**根拠 (Risk Factors):**\n' : '**Risk Factors:**\n';
  const factors = result.riskAssessment.factors || [];
  const factorsJa = isJa ? await translateRecommendations(factors, 'ja') : factors;
  factorsJa.forEach((factor) => {
    report += `- ${factor}\n`;
  });

  report += '\n---\n';
  report += isJa
    ? '*[renovate-safety](https://github.com/chaspy/renovate-safety) v1.1.0 により生成*'
    : '*Generated by [renovate-safety](https://github.com/chaspy/renovate-safety) v1.1.0*';

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
  } catch {
    return null;
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
    const hasProductionUsage = result.apiUsages.some((u: any) => u.context === 'production');
    const hasTestUsage = result.apiUsages.some((u: any) => u.context === 'test');
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

function getLibraryDescription(packageName: string, isJa: boolean): string | null {
  const descriptions: Record<string, { ja: string; en: string }> = {
    'p-limit': {
      ja: 'p-limitは非同期関数の並列実行数を制限するためのライブラリです。Promise.all()で大量の非同期処理を実行する際に、同時実行数を制御してリソースの枯渇を防ぎます。主にAPI呼び出しやファイル処理などの並列処理で使用されます。',
      en: 'p-limit is a library for limiting the number of concurrent async operations. It prevents resource exhaustion when using Promise.all() with many async operations by controlling concurrency. Commonly used for API calls and file processing.',
    },
    react: {
      ja: 'ReactはFacebookが開発したUIライブラリです。コンポーネントベースのアーキテクチャで、宣言的なUIの構築を可能にします。仮想DOMを使用して効率的な画面更新を実現します。',
      en: 'React is a UI library developed by Facebook. It enables declarative UI building with component-based architecture. Uses virtual DOM for efficient updates.',
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
  return desc ? (isJa ? desc.ja : desc.en) : null;
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
