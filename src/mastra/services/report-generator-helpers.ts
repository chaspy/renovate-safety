// Helper functions for report generation to reduce complexity
import type { UsageImpact } from '../tools/usage-impact-analyzer.js';

// Generate version change analysis section
export function generateVersionChangeAnalysis(dependency: any, isJapanese: boolean): string {
  const isMajorUpdate = dependency.fromVersion.split('.')[0] !== dependency.toVersion.split('.')[0];
  const isMinorUpdate = !isMajorUpdate && dependency.fromVersion.split('.')[1] !== dependency.toVersion.split('.')[1];

  let markdown = `**${isJapanese ? 'バージョン変更分析' : 'Version Change Analysis'}**:\n`;

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

  return markdown;
}

// Generate usage impact analysis
export function generateUsageImpactScore(codeImpact: any, isJapanese: boolean): string {
  let markdown = '';

  if (codeImpact?.totalUsages > 0) {
    const usageScore = Math.min(codeImpact.totalUsages * 2, 20);
    const criticalPathScore = codeImpact?.criticalUsages > 0 ? 10 : 0;
    const totalUsageScore = usageScore + criticalPathScore;

    markdown += isJapanese ?
      `- **コード使用箇所の影響**: **+${totalUsageScore}点**\n` :
      `- **Code usage impact**: **+${totalUsageScore} points**\n`;
    markdown += isJapanese ?
      `  - 使用箇所数 (${codeImpact.totalUsages}箇所): +${usageScore}点 (${codeImpact.totalUsages} × 2点, 最大20点)\n` :
      `  - Usage locations (${codeImpact.totalUsages} locations): +${usageScore} points (${codeImpact.totalUsages} × 2 points, max 20)\n`;

    if (criticalPathScore > 0) {
      markdown += isJapanese ?
        `  - クリティカルパス使用: +${criticalPathScore}点\n` :
        `  - Critical path usage: +${criticalPathScore} points\n`;
    }
  } else {
    markdown += isJapanese ?
      '- **コード使用箇所の影響**: **+0点** (使用箇所なし)\n' :
      '- **Code usage impact**: **+0 points** (no usage locations)\n';
  }

  return markdown;
}

// Generate information availability penalty
export function generateInfoAvailabilityPenalty(risk: any, isJapanese: boolean): string {
  const hasLowInfo = risk.factors.some((factor: string) => factor.includes('Limited information'));
  if (!hasLowInfo) return '';

  let markdown = isJapanese ?
    '- **情報不足によるペナルティ**: **+5〜10点**\n' :
    '- **Information unavailability penalty**: **+5-10 points**\n';
  markdown += isJapanese ?
    '  - 限定的な情報のため、リスクを保守的に評価しています\n' :
    '  - Conservative risk assessment due to limited information\n';

  return markdown;
}

// Generate test coverage mitigation
export function generateTestCoverageMitigation(codeImpact: any, isJapanese: boolean): string {
  if (!codeImpact?.testCoverage || codeImpact.testCoverage <= 0) return '';

  const testReduction = Math.round((codeImpact.testCoverage / 100) * 20);
  return isJapanese ?
    `- **テストカバレッジによる軽減**: **-${testReduction}点** (カバレッジ ${codeImpact.testCoverage}%)\n` :
    `- **Test coverage mitigation**: **-${testReduction} points** (${codeImpact.testCoverage}% coverage)\n`;
}

// Generate special adjustments section
export function generateSpecialAdjustments(dependency: any, risk: any, isJapanese: boolean): string {
  const isTypesDef = dependency.name.startsWith('@types/');
  const isDevDep = risk.factors.some((factor: string) => factor.includes('Development dependency'));
  const isLockfileOnly = risk.factors.some((factor: string) => factor.includes('Lockfile-only'));

  if (!isTypesDef && !isDevDep && !isLockfileOnly) return '';

  let markdown = `\n**${isJapanese ? '特別調整' : 'Special Adjustments'}**:\n`;

  if (isTypesDef) {
    markdown += isJapanese ?
      '- @types/* パッケージのため大幅なリスク軽減が適用されています\n' :
      '- Significant risk reduction applied for @types/* package\n';
  }

  if (isDevDep) {
    markdown += isJapanese ?
      '- 開発依存関係のため軽微なリスク軽減が適用されています (-1点)\n' :
      '- Minor risk reduction applied for development dependency (-1 point)\n';
  }

  if (isLockfileOnly) {
    markdown += isJapanese ?
      '- lockfile-onlyの変更のため大幅なリスク軽減が適用されています (最大10点に制限)\n' :
      '- Significant risk reduction applied for lockfile-only change (capped at 10 points)\n';
  }

  return markdown;
}

// Generate breaking change details
export function generateBreakingChangeDetails(
  change: any,
  index: number,
  dependency: any,
  isJapanese: boolean,
  getRepositoryUrl: (name: string) => string | null
): string {
  const changeText = change.text || change;
  const severity = change.severity || 'breaking';
  const source = change.source || 'npm-diff-tool';
  const pointsContribution = 5;

  let markdown = formatChangeHeader(index, changeText, pointsContribution, isJapanese);
  markdown += formatChangeMeta(severity, source, isJapanese);
  markdown += formatSourceLinks(source, dependency, getRepositoryUrl, isJapanese);
  markdown += formatImpactExplanation(changeText, isJapanese);
  markdown += '\n';

  return markdown;
}

function formatChangeHeader(
  index: number,
  changeText: string,
  pointsContribution: number,
  isJapanese: boolean
): string {
  return `  ${index + 1}. **${changeText}** (+${pointsContribution}${isJapanese ? '点' : ' points'})\n`;
}

function formatChangeMeta(
  severity: string,
  source: string,
  isJapanese: boolean
): string {
  let markdown = `     - ${isJapanese ? '重要度' : 'Severity'}: ${severity.toUpperCase()}\n`;
  markdown += `     - ${isJapanese ? 'ソース' : 'Source'}: ${source}\n`;
  return markdown;
}

function formatSourceLinks(
  source: string,
  dependency: any,
  getRepositoryUrl: (name: string) => string | null,
  isJapanese: boolean
): string {
  const repoUrl = getRepositoryUrl(dependency.name);
  if (!repoUrl) return '';

  if (source === 'npm-diff') {
    return formatNpmDiffLinks(dependency, repoUrl, isJapanese);
  }

  if (source === 'GitHub release notes' || source === 'GitHub Releases') {
    return formatGitHubReleaseLink(dependency.toVersion, repoUrl, isJapanese);
  }

  return '';
}

function formatNpmDiffLinks(
  dependency: any,
  repoUrl: string,
  isJapanese: boolean
): string {
  const compareLink = `[GitHub Compare](${repoUrl}/compare/v${dependency.fromVersion}...v${dependency.toVersion})`;
  const npmCommand = `\`npm diff ${dependency.name}@${dependency.fromVersion} ${dependency.name}@${dependency.toVersion}\``;

  let markdown = `     - ${isJapanese ? '確認リンク' : 'Reference'}: ${compareLink}\n`;
  markdown += `     - ${isJapanese ? 'npm diff コマンド' : 'npm diff command'}: ${npmCommand}\n`;
  return markdown;
}

function formatGitHubReleaseLink(
  toVersion: string,
  repoUrl: string,
  isJapanese: boolean
): string {
  const releaseLink = `[GitHub Release v${toVersion}](${repoUrl}/releases/tag/v${toVersion})`;
  return `     - ${isJapanese ? '確認リンク' : 'Reference'}: ${releaseLink}\n`;
}

function formatImpactExplanation(
  changeText: string,
  isJapanese: boolean
): string {
  if (!changeText.includes('Node.js requirement')) {
    return '';
  }

  return isJapanese
    ? `     - 💡 Node.js要件変更は実行環境に直接影響する重要な変更です\n`
    : `     - 💡 Node.js requirement changes directly impact the runtime environment\n`;
}

// Generate code impact analysis section
export function generateCodeImpactAnalysisSection(usageImpact: UsageImpact | null, isJapanese: boolean): string {
  if (!usageImpact) return '';

  let markdown = `\n**${isJapanese ? '実際のコード影響分析' : 'Actual Code Impact Analysis'}**:\n`;

  if (usageImpact.isAffected) {
    const riskEmojiMap: Record<UsageImpact['riskLevel'], string> = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢',
      'none': '⚪'
    };
    const riskEmoji = riskEmojiMap[usageImpact.riskLevel] || '⚪';

    markdown += isJapanese ?
      `- **実際に影響を受けるコードが検出されました** ${riskEmoji} **${usageImpact.riskLevel.toUpperCase()}リスク**\n` :
      `- **Code actually affected by breaking changes detected** ${riskEmoji} **${usageImpact.riskLevel.toUpperCase()} risk**\n`;

    markdown += isJapanese ?
      `- **信頼度**: ${Math.round(usageImpact.confidence * 100)}%\n` :
      `- **Confidence**: ${Math.round(usageImpact.confidence * 100)}%\n`;
  }

  return markdown;
}