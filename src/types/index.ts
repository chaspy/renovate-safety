export interface CLIOptions {
  pr?: number;
  from?: string;
  to?: string;
  package?: string;
  post?: 'always' | 'update' | 'never';  // Changed from boolean
  noLlm: boolean;
  llm?: 'claude-cli' | 'anthropic' | 'openai';
  cacheDir: string;
  json: boolean;
  force: boolean;
  language?: 'en' | 'ja';
  deep: boolean;
}

export interface PackageUpdate {
  name: string;
  fromVersion: string;
  toVersion: string;
}

export interface ChangelogDiff {
  content: string;
  source: 'npm' | 'github' | 'PyPI';
  fromVersion?: string;
  toVersion?: string;
}

export interface CodeDiff {
  content: string;
  source: 'github-compare';
  filesChanged: number;
  additions: number;
  deletions: number;
  fromTag: string;
  toTag: string;
}

export interface DependencyUsage {
  packageName: string;
  dependents: DependentInfo[];
  isDirect: boolean;
  usageType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
}

export interface DependentInfo {
  name: string;
  version: string;
  path: string[];
  type: 'direct' | 'transitive';
}

export interface BreakingChange {
  line: string;
  severity: 'breaking' | 'warning' | 'removal';
}

export interface LLMSummary {
  summary: string;
  language: 'en' | 'ja';
  breakingChanges: string[];
}

export interface APIUsage {
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

export interface RiskAssessment {
  level: RiskLevel;
  factors: string[];
  estimatedEffort: 'none' | 'minimal' | 'moderate' | 'significant' | 'unknown';
  testingScope: 'none' | 'unit' | 'integration' | 'full' | 'full regression' | 'full regression recommended';
}

export interface AnalysisResult {
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

export interface Report {
  analysisResult: AnalysisResult;
  format: 'markdown' | 'json';
}

// Deep Analysis Types
export interface PackageUsageDetail {
  file: string;
  line: number;
  type: 'import' | 'require' | 'dynamic-import';
  importSpecifier: string;
  namedImports?: string[];
  defaultImport?: string;
  namespaceImport?: string;
  isTypeOnly?: boolean;
}

export interface APIUsageDetail {
  file: string;
  line: number;
  apiName: string;
  usageType: 'function-call' | 'property-access' | 'constructor' | 'type-reference' | 'decorator' | 'jsx-component';
  context: string;
  arguments?: string[];
  chainedCalls?: string[];
}

export interface FileClassification {
  file: string;
  category: 'test' | 'production' | 'config' | 'build' | 'documentation';
  confidence: number;
  indicators: string[];
}

export interface ConfigFileUsage {
  file: string;
  configType: 'package.json' | 'tsconfig.json' | 'webpack' | 'rollup' | 'vite' | 'babel' | 'eslint' | 'prettier' | 'other';
  usage: string;
  content: any;
}

export interface DeepAnalysisResult {
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
