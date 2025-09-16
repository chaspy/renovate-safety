# renovate-safety Agent アーキテクチャ

## 概要

renovate-safetyは、Mastra AIフレームワークを活用したAgent/Toolベースのアーキテクチャを採用しています。このドキュメントでは、各Agentの役割、利用可能なツール、実行フローについて説明します。

## システム全体のフロー

```mermaid
flowchart TD
    Start([PR解析開始]) --> ParsePR[PR情報の取得]
    ParsePR --> ExtractPackages[パッケージ更新の抽出]
    ExtractPackages --> AnalyzeLoop{全パッケージ<br/>解析完了?}
    
    AnalyzeLoop -->|No| SelectPackage[パッケージ選択]
    SelectPackage --> ReleaseAgent[ReleaseNotesAgent<br/>実行]
    SelectPackage --> CodeImpactAgent[CodeImpactAgent<br/>実行]
    
    ReleaseAgent --> CollectResults[結果収集]
    CodeImpactAgent --> CollectResults
    CollectResults --> AnalyzeLoop
    
    AnalyzeLoop -->|Yes| RiskAssessment[リスク評価]
    RiskAssessment --> GenerateReport[レポート生成]
    GenerateReport --> PostComment[PR コメント投稿]
    PostComment --> End([完了])
```

## Agent 構成

### 1. ReleaseNotesAgent

リリースノートと変更履歴を収集・分析するAgent

```mermaid
graph LR
    subgraph ReleaseNotesAgent
        RA[Agent実行開始] --> T1[npmDiffTool]
        RA --> T2[githubReleasesFetcher]
        RA --> T3[changelogFetcher]
        
        T1 --> Analysis[情報統合・分析]
        T2 --> Analysis
        T3 --> Analysis
        
        Analysis --> Output[構造化出力]
    end
    
    subgraph Tools
        T1 -.-> NPM[(npm Registry)]
        T2 -.-> GH[(GitHub API)]
        T3 -.-> Multiple[(Multiple Sources)]
    end
```

**利用ツール:**
- `npmDiffTool`: npm registryから差分情報を取得
- `githubReleasesFetcher`: GitHub Releasesから情報を取得
- `changelogFetcher`: 複数ソースからchangelog情報を取得

### 2. CodeImpactAgent

コード変更の影響を分析するAgent

```mermaid
graph LR
    subgraph CodeImpactAgent
        CA[Agent実行開始] --> T4[tsUsageScanner]
        CA --> T5[configScanner]
        CA --> T6[breakingChangeAnalyzer]
        CA --> T7[usageImpactAnalyzer]
        
        T4 --> ImpactAnalysis[影響分析]
        T5 --> ImpactAnalysis
        T6 --> ImpactAnalysis
        T7 --> ImpactAnalysis
        
        ImpactAnalysis --> ImpactOutput[影響評価出力]
    end
    
    subgraph SourceCode
        T4 -.-> TS[TypeScript Files]
        T5 -.-> Config[Config Files]
        T6 -.-> Changes[Breaking Changes]
        T7 -.-> Usage[Usage Patterns]
    end
```

**利用ツール:**
- `tsUsageScanner`: TypeScriptコードの使用箇所をスキャン
- `configScanner`: 設定ファイルでの使用を検出
- `breakingChangeAnalyzer`: 破壊的変更を分析
- `usageImpactAnalyzer`: 実際の使用パターンへの影響を評価

## Tool レイヤー

### 主要ツール一覧

```mermaid
classDiagram
    class Tool {
        <<interface>>
        +name: string
        +description: string
        +execute(input): Promise
        +schema: ZodSchema
    }
    
    class DataFetchingTools {
        +npmDiffTool
        +githubReleasesFetcher
        +changelogFetcher
        +githubCompare
        +dependencyReview
    }
    
    class AnalysisTools {
        +breakingChangeAnalyzer
        +usageImpactAnalyzer
        +tsUsageScanner
        +configScanner
        +riskArbiter
    }
    
    class GitHubTools {
        +getPrInfo
        +prComment
        +prLabel
        +githubLinkGenerator
    }
    
    class UtilityTools {
        +sourceTracker
        +executionTracker
    }
    
    Tool <|-- DataFetchingTools
    Tool <|-- AnalysisTools
    Tool <|-- GitHubTools
    Tool <|-- UtilityTools
```

### ツールの実行フロー

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant Workflow
    participant Agent
    participant Tool
    participant External
    
    User->>CLI: renovate-safety --pr 16
    CLI->>Workflow: analyzeRenovatePR()
    
    loop 各パッケージ
        Workflow->>Agent: execute(package)
        Agent->>Tool: execute(params)
        Tool->>External: fetch/analyze
        External-->>Tool: data
        Tool-->>Agent: result
        Agent-->>Workflow: analysis
    end
    
    Workflow->>Workflow: assessRisk()
    Workflow->>Workflow: generateReport()
    Workflow->>External: postComment()
    External-->>User: PR Comment
```

## データフロー

### 1. 情報収集フェーズ

```mermaid
graph TD
    subgraph 情報源
        NPM[npm Registry]
        GitHub[GitHub API]
        Local[Local Files]
    end
    
    subgraph 取得情報
        Changelog[Changelog/Readme]
        Releases[GitHub Releases]
        CodeDiff[Code Diff]
        Dependencies[Dependencies]
        Usage[Usage Locations]
    end
    
    NPM --> Changelog
    GitHub --> Releases
    GitHub --> CodeDiff
    Local --> Dependencies
    Local --> Usage
    
    Changelog --> Merge[情報統合]
    Releases --> Merge
    CodeDiff --> Merge
    Dependencies --> Merge
    Usage --> Merge
    
    Merge --> Analysis[分析処理]
```

### 2. 分析フェーズ

```mermaid
graph TD
    subgraph 分析項目
        Breaking[破壊的変更検出]
        Impact[影響範囲分析]
        Risk[リスク評価]
        Confidence[信頼度計算]
    end
    
    Breaking --> Score[スコアリング]
    Impact --> Score
    Risk --> Score
    Confidence --> Score
    
    Score --> Level{リスクレベル}
    Level -->|SAFE| Safe[安全: 自動マージ可]
    Level -->|LOW| Low[低: 簡単な確認のみ]
    Level -->|MEDIUM| Medium[中: コード修正必要]
    Level -->|HIGH| High[高: 詳細レビュー必要]
    Level -->|CRITICAL| Critical[危険: 慎重な対応必要]
```

## 破壊的変更の検出パターン

```mermaid
graph LR
    subgraph Detection Patterns
        P1[BREAKING CHANGE]
        P2[Node.js要件変更]
        P3[API削除/変更]
        P4[関数シグネチャ変更]
        P5[設定形式変更]
    end
    
    subgraph Sources
        S1[Changelog Text]
        S2[package.json engines]
        S3[Code Diff Analysis]
        S4[Type Definition Changes]
    end
    
    S1 --> P1
    S2 --> P2
    S3 --> P3
    S3 --> P4
    S1 --> P5
    S4 --> P3
```

## 実行トラッキング

```mermaid
stateDiagram-v2
    [*] --> Initialized: start()
    
    Initialized --> AgentExecuting: trackAgent()
    AgentExecuting --> ToolExecuting: trackTool()
    ToolExecuting --> ToolCompleted: success/fail
    ToolCompleted --> AgentExecuting: more tools
    ToolCompleted --> AgentCompleted: all tools done
    
    AgentCompleted --> AgentExecuting: next agent
    AgentCompleted --> Finalizing: all agents done
    
    Finalizing --> [*]: finalize()
    
    note right of Finalizing
        - Calculate costs
        - Generate statistics
        - Clean up resources
    end note
```

## エラーハンドリング

```mermaid
graph TD
    subgraph Error Handling
        Try[処理実行] --> Check{エラー?}
        Check -->|No| Success[成功]
        Check -->|Yes| ErrorType{エラー種別}
        
        ErrorType -->|Network| Retry[リトライ]
        ErrorType -->|Auth| AuthError[認証エラー通知]
        ErrorType -->|Parse| Fallback[フォールバック処理]
        ErrorType -->|Unknown| Log[ログ記録]
        
        Retry --> Try
        Fallback --> PartialResult[部分的な結果]
        AuthError --> Abort[処理中断]
        Log --> Continue[処理継続]
    end
```

## 設定とカスタマイズ

```mermaid
graph LR
    subgraph Configuration
        ENV[環境変数]
        Config[mastra.config.ts]
        Args[CLIオプション]
    end
    
    ENV --> Settings[実行時設定]
    Config --> Settings
    Args --> Settings
    
    Settings --> Execution[実行エンジン]
    
    subgraph Customization Points
        C1[Agent Instructions]
        C2[Tool Parameters]
        C3[Risk Thresholds]
        C4[Report Templates]
    end
    
    Settings --> C1
    Settings --> C2
    Settings --> C3
    Settings --> C4
```

## パフォーマンス最適化

```mermaid
graph TD
    subgraph Optimization
        Parallel[並列処理]
        Cache[キャッシュ]
        Limit[レート制限]
    end
    
    Parallel --> pLimit[p-limit使用]
    pLimit --> Controlled[制御された並列実行]
    
    Cache --> Memory[メモリキャッシュ]
    Cache --> Disk[ディスクキャッシュ]
    
    Limit --> API[API呼び出し制限]
    Limit --> Concurrency[同時実行数制限]
```

## まとめ

renovate-safetyのAgent/Toolアーキテクチャは、以下の特徴を持ちます：

1. **モジュラー設計**: 各AgentとToolが独立して動作し、必要に応じて組み合わせ可能
2. **並列処理**: p-limitを使用した効率的な並列実行
3. **フォールバック**: 複数の情報源から取得し、1つが失敗しても継続
4. **詳細な追跡**: ExecutionTrackerによる実行状況の記録
5. **柔軟な拡張**: 新しいAgent/Toolの追加が容易

このアーキテクチャにより、高速で信頼性の高いパッケージ更新の安全性評価を実現しています。