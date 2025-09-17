/**
 * Risk Assessment Breakdown Helpers
 * Extracted from report-generator.ts to reduce cognitive complexity
 */
import type { UsageImpact } from '../tools/usage-impact-analyzer.js';

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

// Main function with reduced complexity
export async function generateRiskAssessmentBreakdown(assessment: any, isJapanese: boolean): Promise<string> {
  const { risk } = assessment;

  // Skip breakdown for safe packages
  if (risk.level === 'safe') {
    return '';
  }

  let markdown = `<details>\n<summary><strong>${isJapanese ? '📋 リスクアセスメント詳細' : '📋 Risk Assessment Details'}</strong></summary>\n\n`;

  // Generate all sections
  markdown += generateVersionChangeSection(assessment, isJapanese);
  markdown += generateUsageImpactSection(assessment, isJapanese);
  markdown += generateInformationPenaltySection(assessment, isJapanese);
  markdown += generateTestCoverageSection(assessment, isJapanese);
  markdown += generatePackageTypeSection(assessment, isJapanese);
  markdown += generateBreakingChangesSection(assessment, isJapanese);
  markdown += generateActualImpactSection(assessment, isJapanese);
  markdown += generateConfidenceSection(assessment, isJapanese);
  markdown += generateTestingStrategySection(assessment, isJapanese);

  markdown += '\n</details>\n\n';

  return markdown;
}

// Version change analysis section
function generateVersionChangeSection(assessment: any, isJapanese: boolean): string {
  const { dependency } = assessment;
  const isMajorUpdate = dependency.fromVersion.split('.')[0] !== dependency.toVersion.split('.')[0];
  const isMinorUpdate = !isMajorUpdate && dependency.fromVersion.split('.')[1] !== dependency.toVersion.split('.')[1];

  let markdown = `**${isJapanese ? 'バージョン変更分析' : 'Version Change Analysis'}**:\n`;

  if (isMajorUpdate) {
    markdown += formatMajorUpdate(dependency, isJapanese);
  } else if (isMinorUpdate) {
    markdown += formatMinorUpdate(dependency, isJapanese);
  } else {
    markdown += formatPatchUpdate(dependency, isJapanese);
  }

  return markdown;
}

function formatMajorUpdate(dependency: any, isJapanese: boolean): string {
  const scoreContribution = 20;
  let text = isJapanese
    ? `- メジャーバージョンアップグレード (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution}点**\n`
    : `- Major version upgrade (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution} points**\n`;
  text += isJapanese
    ? '  - メジャー更新は破壊的変更を含む可能性が高いため、高いスコアが付与されます\n'
    : '  - Major updates have high potential for breaking changes, resulting in higher scores\n';
  return text;
}

function formatMinorUpdate(dependency: any, isJapanese: boolean): string {
  const scoreContribution = 5;
  return isJapanese
    ? `- マイナーバージョン更新 (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution}点**\n`
    : `- Minor version update (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution} points**\n`;
}

function formatPatchUpdate(dependency: any, isJapanese: boolean): string {
  const scoreContribution = 1;
  return isJapanese
    ? `- パッチバージョン更新 (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution}点**\n`
    : `- Patch version update (${dependency.fromVersion} → ${dependency.toVersion}): **+${scoreContribution} point**\n`;
}

// Usage impact section
function generateUsageImpactSection(assessment: any, isJapanese: boolean): string {
  const { codeImpact } = assessment;

  if (!codeImpact?.totalUsages) {
    return isJapanese
      ? '- **コード使用箇所の影響**: **+0点** (使用箇所なし)\n'
      : '- **Code usage impact**: **+0 points** (no usage locations)\n';
  }

  const usageScore = Math.min(codeImpact.totalUsages * 2, 20);
  const criticalPathScore = codeImpact?.criticalUsages > 0 ? 10 : 0;
  const totalUsageScore = usageScore + criticalPathScore;

  let markdown = isJapanese
    ? `- **コード使用箇所の影響**: **+${totalUsageScore}点**\n`
    : `- **Code usage impact**: **+${totalUsageScore} points**\n`;

  markdown += isJapanese
    ? `  - 使用箇所数 (${codeImpact.totalUsages}箇所): +${usageScore}点 (${codeImpact.totalUsages} × 2点, 最大20点)\n`
    : `  - Usage locations (${codeImpact.totalUsages} locations): +${usageScore} points (${codeImpact.totalUsages} × 2 points, max 20)\n`;

  if (criticalPathScore > 0) {
    markdown += isJapanese
      ? `  - クリティカルパス使用: +${criticalPathScore}点\n`
      : `  - Critical path usage: +${criticalPathScore} points\n`;
  }

  return markdown;
}

// Information penalty section
function generateInformationPenaltySection(assessment: any, isJapanese: boolean): string {
  const { risk } = assessment;
  const hasLowInfo = risk.factors.some((factor: string) => factor.includes('Limited information'));

  if (!hasLowInfo) {
    return '';
  }

  let markdown = isJapanese
    ? '- **情報不足によるペナルティ**: **+5〜10点**\n'
    : '- **Information unavailability penalty**: **+5-10 points**\n';
  markdown += isJapanese
    ? '  - 限定的な情報のため、リスクを保守的に評価しています\n'
    : '  - Conservative risk assessment due to limited information\n';

  return markdown;
}

// Test coverage section
function generateTestCoverageSection(assessment: any, isJapanese: boolean): string {
  const { codeImpact } = assessment;

  if (!codeImpact?.testCoverage || codeImpact.testCoverage === 0) {
    return '';
  }

  const testReduction = Math.round((codeImpact.testCoverage / 100) * 20);
  return isJapanese
    ? `- **テストカバレッジによる軽減**: **-${testReduction}点** (カバレッジ ${codeImpact.testCoverage}%)\n`
    : `- **Test coverage mitigation**: **-${testReduction} points** (${codeImpact.testCoverage}% coverage)\n`;
}

// Package type adjustments section
function generatePackageTypeSection(assessment: any, isJapanese: boolean): string {
  const { dependency, risk } = assessment;
  const isTypesDef = dependency.name.startsWith('@types/');
  const isDevDep = risk.factors.some((factor: string) => factor.includes('Development dependency'));
  const isLockfileOnly = risk.factors.some((factor: string) => factor.includes('Lockfile-only'));

  if (!isTypesDef && !isDevDep && !isLockfileOnly) {
    return '';
  }

  let markdown = `\n**${isJapanese ? '特別調整' : 'Special Adjustments'}**:\n`;

  if (isTypesDef) {
    markdown += isJapanese
      ? '- @types/* パッケージのため大幅なリスク軽減が適用されています\n'
      : '- Significant risk reduction applied for @types/* package\n';
  }

  if (isDevDep) {
    markdown += isJapanese
      ? '- 開発依存関係のため軽微なリスク軽減が適用されています (-1点)\n'
      : '- Minor risk reduction applied for development dependency (-1 point)\n';
  }

  if (isLockfileOnly) {
    markdown += isJapanese
      ? '- lockfile-onlyの変更のため大幅なリスク軽減が適用されています (最大10点に制限)\n'
      : '- Significant risk reduction applied for lockfile-only change (capped at 10 points)\n';
  }

  return markdown;
}

// Breaking changes section
function generateBreakingChangesSection(assessment: any, isJapanese: boolean): string {
  const { dependency, risk, releaseNotes } = assessment;
  const isMajorUpdate = dependency.fromVersion.split('.')[0] !== dependency.toVersion.split('.')[0];
  const hasBreakingChanges = risk.factors.some((factor: string) => factor.includes('breaking changes'));
  const breakingChangeCount = hasBreakingChanges
    ? parseInt((/(\d+)/.exec(risk.factors.find((f: string) => f.includes('breaking changes')) || ''))?.[1] || '0')
    : 0;

  let markdown = `\n**${isJapanese ? '破壊的変更の検出状況' : 'Breaking Changes Detection'}**:\n`;

  if (breakingChangeCount > 0) {
    markdown += formatDetectedBreakingChanges(dependency, releaseNotes, breakingChangeCount, isJapanese);
  } else if (isMajorUpdate) {
    markdown += formatNoBreakingChangesForMajor(isJapanese);
  } else {
    markdown += isJapanese
      ? '- 破壊的変更は検出されませんでした: **+0点**\n'
      : '- No breaking changes detected: **+0 points**\n';
  }

  return markdown;
}

function formatDetectedBreakingChanges(
  dependency: any,
  releaseNotes: any,
  breakingChangeCount: number,
  isJapanese: boolean
): string {
  const actualBreakingChangeScore = Math.min(breakingChangeCount * 5, 20);

  let markdown = isJapanese
    ? `- **${breakingChangeCount}件の破壊的変更を検出**: **+${actualBreakingChangeScore}点** (${breakingChangeCount}件 × 5点, 最大20点)\n`
    : `- **${breakingChangeCount} breaking changes detected**: **+${actualBreakingChangeScore} points** (${breakingChangeCount} changes × 5 points, max 20)\n`;

  if (releaseNotes?.breakingChanges && releaseNotes.breakingChanges.length > 0) {
    markdown += isJapanese ? '\n  **詳細:**\n\n' : '\n  **Details:**\n\n';
    markdown += formatBreakingChangesList(dependency, releaseNotes, isJapanese);
    markdown += formatDataSources(releaseNotes, isJapanese);
  }

  return markdown;
}

function formatBreakingChangesList(dependency: any, releaseNotes: any, isJapanese: boolean): string {
  let markdown = '';

  releaseNotes.breakingChanges.forEach((change: any, index: number) => {
    const changeText = change.text || change;
    const severity = change.severity || 'breaking';
    const source = change.source || 'npm-diff-tool';
    const pointsContribution = 5;

    markdown += `  ${index + 1}. **${changeText}** (+${pointsContribution}${isJapanese ? '点' : ' points'})\n`;
    markdown += `     - ${isJapanese ? '重要度' : 'Severity'}: ${severity.toUpperCase()}\n`;
    markdown += `     - ${isJapanese ? 'ソース' : 'Source'}: ${source}\n`;
    markdown += formatChangeSourceLinks(dependency, releaseNotes, source, isJapanese);
    markdown += formatChangeImpactNote(changeText, isJapanese);
    markdown += '\n';
  });

  return markdown;
}

function formatChangeSourceLinks(
  dependency: any,
  releaseNotes: any,
  source: string,
  isJapanese: boolean
): string {
  const repoUrl = getRepositoryUrl(dependency.name);

  if (source === 'npm-diff') {
    return formatNpmDiffLinks(dependency, repoUrl, isJapanese);
  }

  if (source === 'GitHub release notes' || source === 'GitHub Releases') {
    return formatGitHubReleaseLinks(dependency, repoUrl, isJapanese);
  }

  return formatOtherSourceLinks(releaseNotes, source, isJapanese);
}

function formatNpmDiffLinks(dependency: any, repoUrl: string | null, isJapanese: boolean): string {
  if (!repoUrl) return '';

  const referenceLink = `[GitHub Compare](${repoUrl}/compare/v${dependency.fromVersion}...v${dependency.toVersion})`;
  let markdown = `     - ${isJapanese ? '確認リンク' : 'Reference'}: ${referenceLink}\n`;
  markdown += `     - ${isJapanese ? 'npm diff コマンド' : 'npm diff command'}: \`npm diff ${dependency.name}@${dependency.fromVersion} ${dependency.name}@${dependency.toVersion}\`\n`;
  return markdown;
}

function formatGitHubReleaseLinks(dependency: any, repoUrl: string | null, isJapanese: boolean): string {
  if (!repoUrl) return '';

  const referenceLink = `[GitHub Release v${dependency.toVersion}](${repoUrl}/releases/tag/v${dependency.toVersion})`;
  return `     - ${isJapanese ? '確認リンク' : 'Reference'}: ${referenceLink}\n`;
}

function formatOtherSourceLinks(releaseNotes: any, source: string, isJapanese: boolean): string {
  if (!releaseNotes?.sources) return '';

  const sourceInfo = releaseNotes.sources.find((s: any) =>
    s.type === source || s.type.includes(source) || source.includes(s.type)
  );

  if (sourceInfo?.url) {
    return `     - ${isJapanese ? '確認リンク' : 'Reference'}: [${sourceInfo.type}](${sourceInfo.url})\n`;
  }

  return '';
}

function formatChangeImpactNote(changeText: string, isJapanese: boolean): string {
  if (!changeText.includes('Node.js requirement')) {
    return '';
  }

  return isJapanese
    ? `     - 💡 Node.js要件変更は実行環境に直接影響する重要な変更です\n`
    : `     - 💡 Node.js requirement changes directly impact the runtime environment\n`;
}

function formatDataSources(releaseNotes: any, isJapanese: boolean): string {
  if (!releaseNotes?.sources || releaseNotes.sources.length === 0) {
    return '';
  }

  let markdown = `  **${isJapanese ? 'データソース' : 'Data Sources'}**:\n`;
  releaseNotes.sources.forEach((source: any) => {
    const status = source.status === 'success' ? '✅' : '❌';
    if (source.url) {
      markdown += `  - ${status} [${source.type}](${source.url})\n`;
    } else {
      markdown += `  - ${status} ${source.type}\n`;
    }
  });
  markdown += '\n';

  return markdown;
}

function formatNoBreakingChangesForMajor(isJapanese: boolean): string {
  let markdown = isJapanese
    ? '- **破壊的変更は検出されませんでしたが、メジャーバージョンアップグレードのため潜在的リスクが存在します**\n'
    : '- **No breaking changes detected, but potential risks exist due to major version upgrade**\n';
  markdown += isJapanese
    ? '  - ⚠️ リリースノートの分析で具体的な変更内容を特定できませんでした\n'
    : '  - ⚠️ Release notes analysis could not identify specific changes\n';
  markdown += isJapanese
    ? '  - 手動での変更内容確認を強く推奨します\n'
    : '  - Manual review of changes is strongly recommended\n';

  return markdown;
}

// Actual impact analysis section
function generateActualImpactSection(assessment: any, isJapanese: boolean): string {
  const { usageImpact } = assessment;

  if (!usageImpact) {
    return '';
  }

  let markdown = `\n**${isJapanese ? '実際のコード影響分析' : 'Actual Code Impact Analysis'}**:\n`;

  if (usageImpact.isAffected) {
    markdown += formatAffectedCodeImpact(usageImpact, isJapanese);
  } else {
    markdown += formatNoCodeImpact(usageImpact, isJapanese);
  }

  return markdown + '\n';
}

function formatAffectedCodeImpact(usageImpact: UsageImpact, isJapanese: boolean): string {
  const riskEmojiMap: Record<UsageImpact['riskLevel'], string> = {
    'high': '🔴',
    'medium': '🟡',
    'low': '🟢',
    'none': '⚪'
  };
  const riskEmoji = riskEmojiMap[usageImpact.riskLevel] || '⚪';

  let markdown = isJapanese
    ? `- **実際に影響を受けるコードが検出されました** ${riskEmoji} **${usageImpact.riskLevel.toUpperCase()}リスク**\n`
    : `- **Code actually affected by breaking changes detected** ${riskEmoji} **${usageImpact.riskLevel.toUpperCase()} risk**\n`;

  markdown += isJapanese
    ? `- **信頼度**: ${Math.round(usageImpact.confidence * 100)}%\n`
    : `- **Confidence**: ${Math.round(usageImpact.confidence * 100)}%\n`;

  markdown += formatAffectedFilesList(usageImpact.affectedFiles, isJapanese);
  markdown += formatAffectedPatternsList(usageImpact.affectedPatterns, isJapanese);
  markdown += formatRecommendationsList(usageImpact.recommendations, isJapanese);

  return markdown;
}

function formatNoCodeImpact(usageImpact: any, isJapanese: boolean): string {
  let markdown = isJapanese
    ? `- **実際の影響なし** ⚪ 破壊的変更はプロジェクトのコードに直接影響しません\n`
    : `- **No actual impact** ⚪ Breaking changes do not directly affect project code\n`;

  markdown += isJapanese
    ? `- **信頼度**: ${Math.round(usageImpact.confidence * 100)}%\n`
    : `- **Confidence**: ${Math.round(usageImpact.confidence * 100)}%\n`;

  markdown += formatRecommendationsList(usageImpact.recommendations, isJapanese);

  return markdown;
}

function formatAffectedFilesList(affectedFiles: string[], isJapanese: boolean): string {
  if (!affectedFiles || affectedFiles.length === 0) {
    return '';
  }

  let markdown = `\n  **${isJapanese ? '影響ファイル' : 'Affected Files'}**:\n`;
  affectedFiles.forEach(file => {
    markdown += `  - [${file}]\n`;
  });

  return markdown;
}

function formatAffectedPatternsList(affectedPatterns: string[], isJapanese: boolean): string {
  if (!affectedPatterns || affectedPatterns.length === 0) {
    return '';
  }

  let markdown = `\n  **${isJapanese ? '検出パターン' : 'Detected Patterns'}**:\n`;
  affectedPatterns.forEach(pattern => {
    markdown += `  - ${pattern}\n`;
  });

  return markdown;
}

function formatRecommendationsList(recommendations: string[], isJapanese: boolean): string {
  if (!recommendations || recommendations.length === 0) {
    return '';
  }

  let markdown = `\n  **${isJapanese ? '推奨事項' : 'Recommendations'}**:\n`;
  recommendations.forEach(rec => {
    markdown += `  - ${rec}\n`;
  });

  return markdown;
}

// Confidence section
function generateConfidenceSection(assessment: any, isJapanese: boolean): string {
  const { risk } = assessment;
  const hasLowConfidence = risk.confidence < 0.5;

  if (!hasLowConfidence) {
    return '';
  }

  let markdown = `\n**${isJapanese ? '情報の不確実性' : 'Information Uncertainty'}**:\n`;
  markdown += isJapanese
    ? `- 分析の信頼度: **${Math.round(risk.confidence * 100)}%**\n`
    : `- Analysis confidence: **${Math.round(risk.confidence * 100)}%**\n`;

  if (risk.confidence < 0.3) {
    markdown += isJapanese
      ? '  - ⚠️ 利用可能な情報が限定的で、リスクの過小評価の可能性があります\n'
      : '  - ⚠️ Limited information available, potential for risk underestimation\n';
    markdown += isJapanese
      ? '  - より保守的なテストアプローチを検討してください\n'
      : '  - Consider a more conservative testing approach\n';
  }

  return markdown;
}

// Testing strategy section
function generateTestingStrategySection(assessment: any, isJapanese: boolean): string {
  const { dependency, risk } = assessment;
  const isMajorUpdate = dependency.fromVersion.split('.')[0] !== dependency.toVersion.split('.')[0];
  const hasBreakingChanges = risk.factors.some((factor: string) => factor.includes('breaking changes'));

  let markdown = `\n**${isJapanese ? 'テスト戦略の根拠' : 'Testing Strategy Rationale'}**:\n`;
  markdown += isJapanese
    ? `- 推奨テストスコープ: **${risk.testingScope}**\n`
    : `- Recommended testing scope: **${risk.testingScope}**\n`;
  markdown += isJapanese
    ? `- 予想工数: **${risk.estimatedEffort}**\n`
    : `- Estimated effort: **${risk.estimatedEffort}**\n`;

  if (risk.testingScope === 'unit' && isMajorUpdate && !hasBreakingChanges) {
    markdown += isJapanese
      ? '- ⚠️ メジャー更新で破壊的変更が不明なため、統合テストも検討することを推奨します\n'
      : '- ⚠️ For major updates with unclear breaking changes, consider integration testing as well\n';
  }

  return markdown;
}