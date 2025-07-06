# renovate-safety 改善計画

## 概要

現在のrenovate-safetyツールには以下の課題があります：

1. **ライブラリ情報取得の不足** - changelog/diffが取得できない場合の分析精度が低い
2. **使用状況分析の浅さ** - 単純な文字列マッチングのみで実際の影響範囲が不明確
3. **リスク評価の矛盾** - 情報不足時でも不正確なリスク判定を行う
4. **限定的な言語サポート** - npm以外のパッケージマネージャーへの対応が不十分

これらの問題を解決するため、以下の改善を実施します。

## 改善項目

### 1. プラガブルアナライザーアーキテクチャの導入

#### 目的
各パッケージマネージャーごとの特性に応じた分析を可能にする

#### 設計
```typescript
interface PackageAnalyzer {
  // このアナライザーが対象パッケージを処理できるか判定
  canHandle(packageName: string, projectPath: string): Promise<boolean>
  
  // パッケージのメタデータ取得（バージョン、説明、ライセンス等）
  fetchMetadata(pkg: PackageUpdate): Promise<PackageMetadata>
  
  // 変更履歴の取得（changelog、リリースノート、コミット履歴）
  fetchChangelog(pkg: PackageUpdate): Promise<ChangelogDiff | null>
  
  // プロジェクト内での使用状況分析
  analyzeUsage(pkg: string, projectPath: string): Promise<UsageAnalysis>
  
  // 言語固有の追加情報取得
  getAdditionalContext?(pkg: PackageUpdate): Promise<AdditionalContext>
}
```

#### 実装予定のアナライザー
- `NpmAnalyzer` - 既存のnpm/yarn/pnpm対応を改善
- `PyPiAnalyzer` - Python (pip/poetry) 対応
- `GoModAnalyzer` - Go modules対応
- `MavenAnalyzer` - Java (Maven/Gradle) 対応
- `GemAnalyzer` - Ruby (Bundler) 対応

### 2. 多層的な情報取得戦略

#### 目的
changelogが取得できない場合でも、複数の情報源から変更内容を推測

#### 実装方針
```typescript
class FallbackAnalysisChain {
  private strategies = [
    new RegistryChangelogStrategy(),    // npm, PyPI等のレジストリ
    new GitHubReleasesStrategy(),       // GitHub Releases/Tags
    new GitCommitAnalysisStrategy(),    // コミットメッセージ分析
    new GitDiffAnalysisStrategy(),      // ソースコード差分分析
    new IssueDiscussionStrategy(),      // Issue/PRでの議論分析
    new TestChangeAnalysisStrategy(),   // テストコードの変更から推測
    new DependencyTreeStrategy()        // 依存関係の変更分析
  ]
  
  async analyze(pkg: PackageUpdate): Promise<AnalysisResult> {
    for (const strategy of this.strategies) {
      const result = await strategy.tryAnalyze(pkg)
      if (result.confidence > 0.7) return result
    }
    return this.combinePartialResults()
  }
}
```

### 3. 高度な使用状況分析

#### 目的
実際のコードでの使用パターンを正確に把握し、影響範囲を特定

#### 機能
- **AST解析による正確な使用箇所特定**
  - 関数呼び出し、プロパティアクセス、型参照を区別
  - 動的import/requireの検出
  - デコレーター使用の検出

- **コンテキスト認識**
  - テストコード vs 本番コード
  - 設定ファイル vs 実装コード
  - ビルドツール設定での使用

- **依存グラフ分析**
  - 直接依存 vs 間接依存の影響度評価
  - 呼び出しチェーンの深さ分析
  - クリティカルパスの特定

### 4. 統合的リスク評価システム

#### 目的
複数の要因を総合的に評価し、一貫性のあるリスク判定を行う

#### 評価要因
```typescript
interface RiskFactors {
  // バージョン変更の大きさ
  versionJump: {
    major: number  // 3.0.0 -> 4.0.0 = 1
    minor: number  // 3.1.0 -> 3.3.0 = 2
    patch: number  // 3.1.1 -> 3.1.5 = 4
  }
  
  // 使用状況
  usage: {
    directUsageCount: number
    criticalPathUsage: boolean
    testCoverage: number  // 0-100%
  }
  
  // 情報の信頼性
  confidence: {
    changelogAvailable: boolean
    diffAnalysisDepth: 'full' | 'partial' | 'none'
    communitySignals: number  // GitHub stars, issues等
  }
  
  // パッケージ固有のリスク
  packageSpecific: {
    breakingChangePatterns: string[]
    knownIssues: Issue[]
    migrationComplexity: 'simple' | 'moderate' | 'complex'
  }
}
```

#### リスクレベル定義
- **UNKNOWN** - 情報不足で判定不可（新規追加）
- **SAFE** - 破壊的変更なし、または影響なし
- **LOW** - 軽微な変更、自動対応可能
- **MEDIUM** - 手動確認必要、限定的な影響
- **HIGH** - 広範囲に影響、慎重な対応必要
- **CRITICAL** - 重大な破壊的変更、即座の対応必要

### 5. パッケージ固有の知識ベース

#### 目的
よく使われるパッケージの既知の破壊的変更パターンを蓄積

#### 実装
```typescript
// data/package-knowledge/globals.json
{
  "globals": {
    "migrations": {
      "14.x->15.x": {
        "summary": "ESLint v8 support added",
        "breakingChanges": ["Minimum Node.js version: 12.20"],
        "migrationSteps": ["Update ESLint to v8"]
      },
      "15.x->16.x": {
        "summary": "Node.js 14 support dropped, improved ESM",
        "breakingChanges": ["Requires Node.js >= 16"],
        "migrationSteps": ["Ensure Node.js >= 16"]
      }
    }
  }
}
```

## 実装計画

### Phase 1: 基盤整備（1-2週間）
1. プラガブルアナライザーインターフェース定義
2. 既存コードのリファクタリング
3. テスト基盤の整備

### Phase 2: コアアナライザー実装（2-3週間）
1. 改善版NpmAnalyzerの実装
2. PyPiAnalyzerの実装
3. 多層的情報取得戦略の実装

### Phase 3: 高度な分析機能（2-3週間）
1. AST解析による使用状況分析
2. 統合的リスク評価システム
3. パッケージ知識ベースの構築

### Phase 4: 追加言語サポート（各1週間）
1. GoModAnalyzer
2. MavenAnalyzer
3. GemAnalyzer

## 成功指標

1. **分析精度向上**
   - changelog取得失敗時でも70%以上の精度で破壊的変更を検出
   - 誤検出率を現在の半分以下に削減

2. **ユーザビリティ向上**
   - 具体的で実行可能なアクションの提示率90%以上
   - リスク評価の一貫性100%（矛盾なし）

3. **言語カバレッジ**
   - 主要5言語（JS/TS, Python, Go, Java, Ruby）の完全サポート
   - その他の言語でも基本的な分析が可能

## 次のステップ

1. このドキュメントのレビューと承認
2. `feature/pluggable-analyzers` ブランチの作成
3. Phase 1の実装開始