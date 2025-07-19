import type { PackageUpdate, ChangelogDiff } from '../types/index.js';

/**
 * Package metadata from registry or repository
 */
export interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  publishedAt?: Date;
  deprecated?: boolean;
  deprecationMessage?: string;
}

/**
 * Usage analysis result
 */
export interface UsageLocation {
  file: string;
  line: number;
  column: number;
  type: 'import' | 'require' | 'function-call' | 'property-access' | 'type-reference' | 'config';
  code: string;
  context: 'production' | 'test' | 'config' | 'build';
}

export interface UsageAnalysis {
  locations: UsageLocation[];
  totalUsageCount: number;
  productionUsageCount: number;
  testUsageCount: number;
  configUsageCount: number;
  criticalPaths: string[];
  hasDynamicImports: boolean;
}

/**
 * Additional context specific to the package ecosystem
 */
export interface AdditionalContext {
  [key: string]: any;
}

/**
 * Base interface for all package analyzers
 */
export abstract class PackageAnalyzer {
  /**
   * Check if this analyzer can handle the given package
   */
  abstract canHandle(packageName: string, projectPath: string): Promise<boolean>;

  /**
   * Fetch package metadata from registry or repository
   */
  abstract fetchMetadata(pkg: PackageUpdate): Promise<PackageMetadata | null>;

  /**
   * Fetch changelog or release notes
   */
  abstract fetchChangelog(pkg: PackageUpdate, cacheDir?: string): Promise<ChangelogDiff | null>;

  /**
   * Analyze package usage in the project
   */
  abstract analyzeUsage(packageName: string, projectPath: string): Promise<UsageAnalysis>;

  /**
   * Get additional context specific to this package ecosystem
   */
  async getAdditionalContext?(pkg: PackageUpdate): Promise<AdditionalContext>;

  /**
   * Get file extensions handled by this analyzer
   */
  abstract getFileExtensions(): string[];

  /**
   * Get import patterns for this language
   */
  abstract getImportPatterns(): RegExp[];
}

/**
 * Registry for all available analyzers
 */
export class AnalyzerRegistry {
  private readonly analyzers: PackageAnalyzer[] = [];

  register(analyzer: PackageAnalyzer): void {
    this.analyzers.push(analyzer);
  }

  async findAnalyzer(packageName: string, projectPath: string): Promise<PackageAnalyzer | null> {
    for (const analyzer of this.analyzers) {
      if (await analyzer.canHandle(packageName, projectPath)) {
        return analyzer;
      }
    }
    return null;
  }

  getAllAnalyzers(): PackageAnalyzer[] {
    return this.analyzers;
  }
}

// Global registry instance
export const analyzerRegistry = new AnalyzerRegistry();