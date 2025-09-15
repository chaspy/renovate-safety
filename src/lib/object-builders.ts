/**
 * Common object building utilities to reduce code duplication
 */

import type { RiskAssessment, PackageUpdate } from '../types/index.js';

/**
 * Build a package info object with defaults
 */
export function buildPackageInfo(
  name: string,
  version: string,
  overrides: Partial<{
    description?: string;
    homepage?: string;
    repository?: string;
    license?: string;
    keywords?: string[];
    maintainers?: unknown[];
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  }> = {}
): unknown {
  return {
    name,
    version,
    description: overrides.description || '',
    homepage: overrides.homepage || '',
    repository: overrides.repository || '',
    license: overrides.license || 'UNKNOWN',
    keywords: overrides.keywords || [],
    maintainers: overrides.maintainers || [],
    dependencies: overrides.dependencies || {},
    devDependencies: overrides.devDependencies || {},
    peerDependencies: overrides.peerDependencies || {},
  };
}

/**
 * Build a risk assessment object
 */
export function buildRiskAssessment(
  level: RiskAssessment['level'],
  _score: number,
  factors: string[],
  details?: Partial<RiskAssessment>
): RiskAssessment {
  return {
    level,
    factors,
    estimatedEffort: details?.estimatedEffort || 'unknown',
    testingScope: details?.testingScope || 'unit',
  };
}

/**
 * Build an error response object
 */
export function buildErrorResponse<T>(
  message: string,
  code?: string,
  details?: Record<string, unknown>
): T {
  return {
    error: true,
    message,
    code: code || 'UNKNOWN_ERROR',
    timestamp: new Date().toISOString(),
    ...details,
  } as T;
}

/**
 * Build a success response object
 */
export function buildSuccessResponse<T>(
  data: T,
  metadata?: Record<string, unknown>
): { success: true; data: T; metadata?: Record<string, unknown> } {
  return {
    success: true,
    data,
    ...(metadata && { metadata }),
  };
}

/**
 * Build a package update info object
 */
export function buildPackageUpdate(
  name: string,
  fromVersion: string,
  toVersion: string,
  overrides?: Partial<PackageUpdate>
): PackageUpdate {
  return {
    name,
    fromVersion,
    toVersion,
    ...overrides,
  };
}

/**
 * Build a usage location object
 */
export function buildUsageLocation(
  file: string,
  line: number,
  type: string,
  code: string,
  context: string = 'unknown'
): unknown {
  return {
    file,
    line,
    column: 0,
    type,
    code,
    context,
  };
}

/**
 * Build a metadata object with common fields
 */
export function buildMetadata(
  source: string,
  timestamp: Date = new Date(),
  additional?: Record<string, unknown>
): Record<string, unknown> {
  return {
    source,
    timestamp: timestamp.toISOString(),
    version: '1.0.0',
    ...additional,
  };
}

/**
 * Build a changelog entry
 */
export function buildChangelogEntry(
  version: string,
  date: Date,
  changes: string[],
  breaking: boolean = false
): unknown {
  return {
    version,
    date: date.toISOString(),
    changes,
    breaking,
    type: (() => {
      if (breaking) return 'major';
      if (changes.some((c) => c.toLowerCase().includes('fix'))) return 'patch';
      return 'minor';
    })(),
  };
}

/**
 * Build a dependency info object
 */
export function buildDependencyInfo(
  name: string,
  version: string,
  type: 'production' | 'development' | 'peer' | 'optional',
  metadata?: Record<string, unknown>
): unknown {
  return {
    name,
    version,
    type,
    resolved: true,
    direct: true,
    vulnerabilities: [],
    ...metadata,
  };
}

/**
 * Build a file analysis result
 */
export function buildFileAnalysis(
  filePath: string,
  usages: number,
  imports: string[] = [],
  exports: string[] = []
): unknown {
  return {
    file: filePath,
    usageCount: usages,
    imports,
    exports,
    complexity: 'low',
    type: filePath.endsWith('.test.js') || filePath.endsWith('.spec.js') ? 'test' : 'source',
  };
}

/**
 * Merge multiple partial objects with type safety
 */
export function mergePartials<T>(...partials: Partial<T>[]): T {
  return Object.assign({}, ...partials) as T;
}

/**
 * Build a normalized error object
 */
export function buildError(
  error: unknown,
  context?: string
): { message: string; stack?: string; context?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      ...(context && { context }),
    };
  }

  return {
    message: String(error),
    ...(context && { context }),
  };
}
