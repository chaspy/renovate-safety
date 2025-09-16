import type {
  PackageUpdate,
  ChangelogDiff,
  BreakingChange,
  CodeDiff,
  DependencyUsage,
} from '../types/index.js';
import type { EnhancedDependencyAnalysis } from './enhanced-dependency-analysis.js';
import type { LibraryIntelligence } from './library-intelligence.js';
import type { EnhancedCodeAnalysis } from './enhanced-code-analysis.js';

export interface EnhancedPromptContext {
  packageUpdate: PackageUpdate;
  changelogDiff: ChangelogDiff | null;
  codeDiff: CodeDiff | null;
  dependencyUsage: DependencyUsage | null;
  breakingChanges: BreakingChange[];
  enhancedDependencyAnalysis?: EnhancedDependencyAnalysis;
  libraryIntelligence?: LibraryIntelligence;
  enhancedCodeAnalysis?: EnhancedCodeAnalysis;
  language: 'en' | 'ja';
}

export function buildSuperEnhancedPrompt(context: EnhancedPromptContext): string {
  const {
    packageUpdate,
    changelogDiff,
    codeDiff,
    dependencyUsage,
    breakingChanges,
    enhancedDependencyAnalysis,
    libraryIntelligence,
    enhancedCodeAnalysis,
    language,
  } = context;

  const sections: string[] = [];

  // System instruction
  sections.push(getSystemInstruction(language));

  // Package overview
  sections.push(buildPackageOverview(packageUpdate, libraryIntelligence));

  // Comprehensive analysis data
  sections.push(
    buildAnalysisData(
      changelogDiff,
      codeDiff,
      dependencyUsage,
      breakingChanges,
      enhancedDependencyAnalysis,
      enhancedCodeAnalysis
    )
  );

  // Context about project impact
  sections.push(buildProjectImpactContext(dependencyUsage, enhancedDependencyAnalysis));

  // Security and maintenance context
  if (libraryIntelligence) {
    sections.push(buildSecurityMaintenanceContext(libraryIntelligence));
  }

  // Analysis request
  sections.push(buildAnalysisRequest(packageUpdate, language));

  return sections.join('\n\n');
}

function getSystemInstruction(language: 'en' | 'ja'): string {
  if (language === 'ja') {
    return `あなたは経験豊富なソフトウェアエンジニアであり、依存関係の更新に関するリスク評価の専門家です。

以下の役割を果たしてください：
1. 技術的な変更点を正確に分析する
2. ビジネスへの影響を評価する  
3. 具体的で実行可能な推奨事項を提供する
4. リスクレベルを適切に評価する
5. 実際のプロジェクトで起こりうる問題を予測する

回答は必ずJSON形式で、以下の情報を含めてください：
- 包括的な要約
- 破壊的変更の詳細
- 具体的な行動項目
- リスク評価
- 推定作業時間`;
  }

  return `You are an experienced software engineer and expert in dependency update risk assessment.

Your role is to:
1. Accurately analyze technical changes
2. Assess business impact
3. Provide specific, actionable recommendations
4. Properly evaluate risk levels
5. Predict potential issues in real projects

Always respond in JSON format with:
- Comprehensive summary
- Breaking change details
- Specific action items
- Risk assessment
- Estimated effort`;
}

function buildPackageOverview(
  packageUpdate: PackageUpdate,
  libraryIntelligence?: LibraryIntelligence
): string {
  let overview = `📦 PACKAGE UPDATE ANALYSIS

Package: ${packageUpdate.name}
Version Change: ${packageUpdate.fromVersion} → ${packageUpdate.toVersion}`;

  if (libraryIntelligence) {
    const { packageInfo, popularityMetrics, maintenanceInfo } = libraryIntelligence;

    overview += `
Package Details:
- Description: ${packageInfo.description}
- License: ${packageInfo.license}
- Downloads/month: ${popularityMetrics.downloads.monthly.toLocaleString()}
- GitHub Stars: ${popularityMetrics.githubStars || 'N/A'}
- Maintenance Status: ${maintenanceInfo.releaseFrequency}
- Open Issues: ${maintenanceInfo.openIssues}`;

    if (packageInfo.keywords.length > 0) {
      overview += `\n- Categories: ${packageInfo.keywords.slice(0, 5).join(', ')}`;
    }
  }

  return overview;
}

function buildAnalysisData(
  changelogDiff: ChangelogDiff | null,
  codeDiff: CodeDiff | null,
  _dependencyUsage: DependencyUsage | null,
  breakingChanges: BreakingChange[],
  _enhancedDependencyAnalysis?: EnhancedDependencyAnalysis,
  enhancedCodeAnalysis?: EnhancedCodeAnalysis
): string {
  const sections: string[] = ['🔍 COMPREHENSIVE ANALYSIS DATA'];

  // Breaking changes with enhanced context
  if (breakingChanges.length > 0) {
    const breakingChangesList = breakingChanges
      .map((bc, i) => `${i + 1}. [${bc.severity.toUpperCase()}] ${bc.line}`)
      .join('\n');
    sections.push(`Pattern-Detected Breaking Changes (${breakingChanges.length}):
${breakingChangesList}`);
  } else {
    sections.push('Pattern-Detected Breaking Changes: None found');
  }

  // Enhanced code analysis
  if (enhancedCodeAnalysis?.semanticChanges.length) {
    sections.push(`Semantic Code Changes (${enhancedCodeAnalysis.semanticChanges.length}):
${enhancedCodeAnalysis.semanticChanges
  .map(
    (change, i) =>
      `${i + 1}. [${change.severity.toUpperCase()}] ${change.type}: ${change.description}
     File: ${change.file}
     Impact: ${change.impact}`
  )
  .join('\n')}`);
  }

  // API changes
  if (enhancedCodeAnalysis?.apiChanges.length) {
    sections.push(`API Changes (${enhancedCodeAnalysis.apiChanges.length}):
${enhancedCodeAnalysis.apiChanges
  .map(
    (api, i) =>
      `${i + 1}. ${api.api} - ${api.changeType} (${api.compatibility})
     File: ${api.file}:${api.line}`
  )
  .join('\n')}`);
  }

  // Changelog analysis
  if (changelogDiff) {
    sections.push(`📋 Changelog Analysis:
Source: ${changelogDiff.source}
Content Preview:
${changelogDiff.content.substring(0, 2000)}${changelogDiff.content.length > 2000 ? '\n...(truncated)' : ''}`);
  } else {
    sections.push(
      '📋 Changelog: Not available - requires code analysis for breaking change detection'
    );
  }

  // Code diff analysis
  if (codeDiff) {
    sections.push(`💻 Code Changes:
- Files changed: ${codeDiff.filesChanged}
- Lines added: ${codeDiff.additions}
- Lines deleted: ${codeDiff.deletions}
- Comparison: ${codeDiff.fromTag} → ${codeDiff.toTag}

Key Changes:
${codeDiff.content.substring(0, 3000)}${codeDiff.content.length > 3000 ? '\n...(truncated for analysis)' : ''}`);
  } else {
    sections.push('💻 Code Changes: Repository not accessible or no tags available');
  }

  return sections.join('\n\n');
}

function buildProjectImpactContext(
  dependencyUsage: DependencyUsage | null,
  enhancedDependencyAnalysis?: EnhancedDependencyAnalysis
): string {
  const sections: string[] = ['🎯 PROJECT IMPACT CONTEXT'];

  if (dependencyUsage) {
    sections.push(`Basic Dependency Usage:
- Type: ${dependencyUsage.isDirect ? 'Direct' : 'Transitive'} dependency
- Category: ${dependencyUsage.usageType}
- Dependents: ${dependencyUsage.dependents.length} packages affected

Dependency Chain:
${dependencyUsage.dependents
  .slice(0, 8)
  .map((dep) => `- ${dep.name} (${dep.version}) [${dep.type}] via: ${dep.path.join(' → ')}`)
  .join(
    '\n'
  )}${dependencyUsage.dependents.length > 8 ? '\n- ... and ' + (dependencyUsage.dependents.length - 8) + ' more' : ''}`);
  }

  if (enhancedDependencyAnalysis) {
    const { impactAnalysis, updateCompatibility } = enhancedDependencyAnalysis;

    sections.push(`Enhanced Impact Analysis:
- Runtime Impact: ${impactAnalysis.runtimeImpact}
- Build Impact: ${impactAnalysis.buildTimeImpact}
- Test Impact: ${impactAnalysis.testImpact}

Update Compatibility:
- Auto-update possible: ${updateCompatibility.canAutoUpdate ? 'Yes' : 'No'}
- Manual intervention required: ${updateCompatibility.requiresManualIntervention ? 'Yes' : 'No'}
- Estimated effort: ${updateCompatibility.estimatedEffort}
${updateCompatibility.blockers.length > 0 ? '- Blockers: ' + updateCompatibility.blockers.join(', ') : ''}`);

    if (impactAnalysis.directUsages.length > 0) {
      const usageDetails = impactAnalysis.directUsages
        .map((usage) => {
          const workspaceInfo = usage.workspaces ? ' in ' + usage.workspaces.join(', ') : '';
          return `- ${usage.packageName}: ${usage.usageType} (${usage.purpose})${workspaceInfo}`;
        })
        .join('\n');
      sections.push(`Direct Usage Details:
${usageDetails}`);
    }
  }

  return sections.join('\n\n');
}

function buildSecurityMaintenanceContext(libraryIntelligence: LibraryIntelligence): string {
  const { securityInfo, maintenanceInfo, migrationIntelligence } = libraryIntelligence;

  const sections: string[] = ['🛡️ SECURITY & MAINTENANCE CONTEXT'];

  // Security information
  if (securityInfo.vulnerabilities.length > 0) {
    const vulnerabilityList = securityInfo.vulnerabilities
      .map((vuln) => {
        const patchInfo = vuln.patchedIn ? ' | Fixed in: ' + vuln.patchedIn : '';
        return `- [${vuln.severity.toUpperCase()}] ${vuln.title} (${vuln.id})
    Affected: ${vuln.affectedVersions}${patchInfo}`;
      })
      .join('\n');
    sections.push(`Security Vulnerabilities (${securityInfo.vulnerabilities.length}):
${vulnerabilityList}`);
  } else {
    sections.push(`Security Status: Clean (Score: ${securityInfo.securityScore}/100)`);
  }

  // Maintenance information
  const sponsorInfo =
    maintenanceInfo.sponsors.length > 0 ? '- Sponsors: ' + maintenanceInfo.sponsors.join(', ') : '';
  sections.push(`Maintenance Health:
- Release frequency: ${maintenanceInfo.releaseFrequency}
- Open issues: ${maintenanceInfo.openIssues}
- Community health: ${maintenanceInfo.communityHealth}
- Has funding: ${maintenanceInfo.funding ? 'Yes' : 'No'}
${sponsorInfo}`);

  // Migration intelligence
  if (migrationIntelligence.codemods.length > 0) {
    sections.push(`Available Migration Tools:
${migrationIntelligence.codemods
  .map(
    (codemod) =>
      `- ${codemod.name}: ${codemod.description}
    Command: ${codemod.command}
    Coverage: ${codemod.coverage}% of changes`
  )
  .join('\n')}`);
  }

  if (migrationIntelligence.migrationGuide) {
    sections.push(`Migration Guide: ${migrationIntelligence.migrationGuide}`);
  }

  sections.push(`Migration Effort Estimate:
- Complexity: ${migrationIntelligence.estimatedEffort.complexity}
- Time required: ${migrationIntelligence.estimatedEffort.timeInHours} hours
- Automatable: ${migrationIntelligence.estimatedEffort.automatable}%`);

  return sections.join('\n\n');
}

function buildAnalysisRequest(_packageUpdate: PackageUpdate, language: 'en' | 'ja'): string {
  // Version comparison logic is implemented in version-utils.ts

  if (language === 'ja') {
    return `🎯 分析要求

上記のすべての情報を総合的に分析し、以下の項目について日本語で詳細に回答してください：

1. 📊 包括的リスク評価
   - 技術的リスク（API変更、破壊的変更）
   - ビジネスリスク（ダウンタイム、機能への影響）
   - セキュリティリスク（脆弱性、メンテナンス状況）

2. 🔧 具体的な破壊的変更
   - 確認された破壊的変更のリスト
   - 各変更の影響範囲と深刻度
   - 修正に必要な具体的な作業

3. ✅ 実行可能なアクションプラン
   - 即座に実行すべきタスク（優先度順）
   - 各タスクの所要時間見積もり
   - 自動化可能な作業の割合

4. ⚠️ リスク軽減策
   - 段階的アップデート戦略
   - テスト計画の推奨事項
   - ロールバック計画

5. 📈 意思決定サポート
   - アップデートを実行すべきか？
   - 最適なタイミングは？
   - 必要なリソース（人員、時間）

重要な考慮事項：
- メジャーバージョンアップの場合は特に慎重な分析を
- changelog、コード差分、依存関係情報をすべて考慮
- プロジェクトの規模と複雑さを推定して回答
- 実際の開発現場で起こりうる問題を予測

JSON形式で回答：
{
  "summary": "技術的・ビジネス的観点を含む包括的な要約（3-5文）",
  "language": "ja",
  "breakingChanges": ["確認された破壊的変更の詳細リスト"],
  "riskLevel": "critical|high|medium|low",
  "actionItems": [
    {
      "task": "具体的なタスク名",
      "priority": "high|medium|low",
      "estimatedHours": 数値,
      "automatable": true|false,
      "description": "詳細な説明"
    }
  ],
  "migrationStrategy": {
    "approach": "推奨されるアプローチ",
    "phases": ["段階1", "段階2", "段階3"],
    "testingRequired": "必要なテスト内容",
    "rollbackPlan": "ロールバック計画"
  },
  "recommendation": {
    "shouldUpdate": true|false,
    "timing": "immediate|scheduled|delayed",
    "rationale": "推奨理由",
    "alternatives": "代替案があれば"
  },
  "resourceEstimate": {
    "totalHours": 数値,
    "teamSize": "推奨チームサイズ",
    "skillsRequired": ["必要なスキル"],
    "timeline": "推定期間"
  }
}`;
  }

  return `🎯 ANALYSIS REQUEST

Based on ALL the comprehensive information above, provide a detailed analysis in English covering:

1. 📊 Comprehensive Risk Assessment
   - Technical risks (API changes, breaking changes)
   - Business risks (downtime, feature impact)
   - Security risks (vulnerabilities, maintenance status)

2. 🔧 Specific Breaking Changes
   - List of confirmed breaking changes
   - Impact scope and severity of each change
   - Specific work required for fixes

3. ✅ Actionable Implementation Plan
   - Immediate tasks (prioritized)
   - Time estimates for each task
   - Percentage of work that can be automated

4. ⚠️ Risk Mitigation Strategies
   - Gradual update strategy
   - Testing plan recommendations
   - Rollback procedures

5. 📈 Decision Support
   - Should this update be performed?
   - Optimal timing?
   - Required resources (personnel, time)

Key Considerations:
- Major version updates require extra scrutiny
- Consider ALL available data: changelog, code diff, dependencies
- Estimate project scale and complexity
- Predict real-world development issues

Respond in JSON format:
{
  "summary": "Comprehensive summary including technical and business perspectives (3-5 sentences)",
  "language": "en",
  "breakingChanges": ["Detailed list of confirmed breaking changes"],
  "riskLevel": "critical|high|medium|low",
  "actionItems": [
    {
      "task": "Specific task name",
      "priority": "high|medium|low",
      "estimatedHours": number,
      "automatable": true|false,
      "description": "Detailed description"
    }
  ],
  "migrationStrategy": {
    "approach": "Recommended approach",
    "phases": ["Phase 1", "Phase 2", "Phase 3"],
    "testingRequired": "Required testing details",
    "rollbackPlan": "Rollback procedure"
  },
  "recommendation": {
    "shouldUpdate": true|false,
    "timing": "immediate|scheduled|delayed",
    "rationale": "Reasoning for recommendation",
    "alternatives": "Alternative options if any"
  },
  "resourceEstimate": {
    "totalHours": number,
    "teamSize": "Recommended team size",
    "skillsRequired": ["Required skills"],
    "timeline": "Estimated timeline"
  }
}`;
}
