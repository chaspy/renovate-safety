export type CLIOptions = {
  pr?: number;
  from?: string;
  to?: string;
  package?: string;
  post?: 'always' | 'update' | 'never'; // Changed from boolean
  noLlm: boolean;
  llm?: 'claude-cli' | 'anthropic' | 'openai';
  cacheDir: string;
  json: boolean;
  force: boolean;
  language?: 'en' | 'ja';
  deep: boolean;
}

export type PackageUpdate = {
  name: string;
  fromVersion: string;
  toVersion: string;
}

export type ChangelogDiff = {
  content: string;
  source: 'npm' | 'github' | 'PyPI' | 'github+npm';
  fromVersion?: string;
  toVersion?: string;
}

export type CodeDiff = {
  content: string;
  source: 'github-compare';
  filesChanged: number;
  additions: number;
  deletions: number;
  fromTag: string;
  toTag: string;
}

export type DependencyUsage = {
  packageName: string;
  dependents: DependentInfo[];
  isDirect: boolean;
  usageType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
}

export type DependentInfo = {
  name: string;
  version: string;
  path: string[];
  type: 'direct' | 'transitive';
}

export type BreakingChange = {
  line: string;
  severity: 'breaking' | 'warning' | 'removal';
  source?: string; // e.g., 'changelog', 'release-notes', 'code-diff'
}

export type LLMSummary = {
  summary: string;
  language: 'en' | 'ja';
  breakingChanges: string[];
}

export type APIUsage = {
  file?: string;
  filePath?: string;
  line: number;
  column?: number;
  snippet?: string;
  context?: string;
  apiName: string;
  usageType?: 'import' | 'call' | 'reference';
}

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export type RiskAssessment = {
  level: RiskLevel;
  factors: string[];
  estimatedEffort: 'none' | 'minimal' | 'moderate' | 'significant' | 'unknown';
  testingScope:
    | 'none'
    | 'unit'
    | 'integration'
    | 'full'
    | 'full regression'
    | 'full regression recommended';
}

export type AnalysisResult = {
  package: PackageUpdate;
  changelogDiff: ChangelogDiff | null;
  codeDiff: CodeDiff | null;
  dependencyUsage: DependencyUsage | null;
  breakingChanges: BreakingChange[];
  llmSummary: LLMSummary | null;
  apiUsages: APIUsage[];
  deepAnalysis?: DeepAnalysisResult;
  riskAssessment: RiskAssessment;
  recommendation: string;
}

export type Report = {
  analysisResult: AnalysisResult;
  format: 'markdown' | 'json';
}

// Deep Analysis Types
export type PackageUsageDetail = {
  file: string;
  line: number;
  type: 'import' | 'require' | 'dynamic-import';
  importSpecifier: string;
  namedImports?: string[];
  defaultImport?: string;
  namespaceImport?: string;
  isTypeOnly?: boolean;
}

export type APIUsageDetail = {
  file: string;
  line: number;
  apiName: string;
  usageType:
    | 'function-call'
    | 'property-access'
    | 'constructor'
    | 'type-reference'
    | 'decorator'
    | 'jsx-component';
  context: string;
  arguments?: string[];
  chainedCalls?: string[];
}

export type FileClassification = {
  file: string;
  category: 'test' | 'production' | 'config' | 'build' | 'documentation';
  confidence: number;
  indicators: string[];
}

export type ConfigFileUsage = {
  file: string;
  configType:
    | 'package.json'
    | 'tsconfig.json'
    | 'webpack'
    | 'rollup'
    | 'vite'
    | 'babel'
    | 'eslint'
    | 'prettier'
    | 'other';
  usage: string;
  content: unknown;
}

export type DeepAnalysisResult = {
  packageName: string;
  totalFiles: number;
  filesUsingPackage: number;
  imports: PackageUsageDetail[];
  apiUsages: APIUsageDetail[];
  fileClassifications: FileClassification[];
  configUsages: ConfigFileUsage[];
  usageSummary: {
    byFileType: Record<string, number>;
    byAPIType: Record<string, number>;
    mostUsedAPIs: Array<{ api: string; count: number }>;
    testVsProduction: { test: number; production: number };
  };
  recommendations: string[];
}
