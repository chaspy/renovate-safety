export interface CLIOptions {
  pr?: number;
  from?: string;
  to?: string;
  package?: string;
  post: boolean;
  noLlm: boolean;
  llm?: 'anthropic' | 'openai';
  cacheDir: string;
  json: boolean;
  force: boolean;
}

export interface PackageUpdate {
  name: string;
  fromVersion: string;
  toVersion: string;
}

export interface ChangelogDiff {
  content: string;
  source: 'npm' | 'github';
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
  file: string;
  line: number;
  snippet: string;
  apiName: string;
}

export type RiskLevel = 'safe' | 'low' | 'review';

export interface AnalysisResult {
  package: PackageUpdate;
  changelogDiff: ChangelogDiff | null;
  breakingChanges: BreakingChange[];
  llmSummary: LLMSummary | null;
  apiUsages: APIUsage[];
  riskLevel: RiskLevel;
  recommendation: string;
}

export interface Report {
  analysisResult: AnalysisResult;
  format: 'markdown' | 'json';
}
