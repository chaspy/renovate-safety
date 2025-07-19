/**
 * Common utilities for package analyzers
 */

import type { UsageLocation } from './base.js';

/**
 * Determines the context of a file based on its path
 */
export function getFileContext(filePath: string): 'production' | 'test' | 'config' | 'build' {
  const lowerPath = filePath.toLowerCase();
  
  // Test file patterns
  const testPatterns = [
    'test', 'spec', '__tests__', '__mocks__', 
    'test_', '_test', 'conftest', '.test.', '.spec.',
    'tests/', 'specs/', 'e2e/', 'integration/'
  ];
  
  // Config file patterns
  const configPatterns = [
    'config', 'conf', '.rc', 'rc.', 'settings', 'setup',
    '.config.', 'configuration', '.env', 'dotenv',
    'webpack.', 'rollup.', 'vite.', 'tsconfig.', 'jest.',
    'babel.', 'eslint', 'prettier', 'package.json',
    'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements'
  ];
  
  // Build/dist file patterns
  const buildPatterns = [
    'webpack', 'rollup', 'vite', 'esbuild', 'tsup', 
    'build/', 'dist/', 'out/', 'output/', '.next/',
    'bundle', 'compiled', 'transpiled', 'minified'
  ];
  
  // Check patterns in order of priority
  if (testPatterns.some(pattern => lowerPath.includes(pattern))) {
    return 'test';
  }
  
  if (configPatterns.some(pattern => lowerPath.includes(pattern))) {
    return 'config';
  }
  
  if (buildPatterns.some(pattern => lowerPath.includes(pattern))) {
    return 'build';
  }
  
  return 'production';
}

/**
 * Categorization result for usage analysis
 */
export interface UsageCategorization {
  totalUsageCount: number;
  productionUsageCount: number;
  testUsageCount: number;
  configUsageCount: number;
  criticalPaths: string[];
  hasDynamicImports: boolean;
}

/**
 * Categorizes usage locations by context and type
 */
export function categorizeUsages(locations: UsageLocation[]): UsageCategorization {
  const counts = {
    production: 0,
    test: 0,
    config: 0,
    build: 0
  };
  
  const criticalPaths = new Set<string>();
  let hasDynamicImports = false;
  
  for (const location of locations) {
    // Count by context
    counts[location.context]++;
    
    // Track critical production paths
    if (location.context === 'production') {
      criticalPaths.add(location.file);
    }
    
    // Detect dynamic imports
    if (location.type === 'require' && 
        (location.code.includes('import(') || 
         location.code.includes('importlib.import_module') ||
         location.code.includes('__import__'))) {
      hasDynamicImports = true;
    }
  }
  
  // Build files are often config-related
  const configAndBuildCount = counts.config + counts.build;
  
  return {
    totalUsageCount: locations.length,
    productionUsageCount: counts.production,
    testUsageCount: counts.test,
    configUsageCount: configAndBuildCount,
    criticalPaths: Array.from(criticalPaths).sort((a, b) => a.localeCompare(b)),
    hasDynamicImports
  };
}

/**
 * Checks if a module specifier refers to a specific package
 */
export function isPackageImport(moduleSpecifier: string, packageName: string): boolean {
  // Direct match
  if (moduleSpecifier === packageName) {
    return true;
  }
  
  // Subpath import (e.g., 'package/subpath')
  if (moduleSpecifier.startsWith(`${packageName}/`)) {
    return true;
  }
  
  // Scoped package with subpath
  if (packageName.startsWith('@') && moduleSpecifier.startsWith(packageName)) {
    return true;
  }
  
  return false;
}

/**
 * Extracts package name from various import formats
 */
export function extractPackageNameFromImport(importStatement: string): string | null {
  // ES6 import patterns
  const es6Patterns = [
    /import\s+(?:[a-zA-Z_$][a-zA-Z0-9_$]*(?:\s*,\s*)?(?:\{[^}]*\})?|\{[^}]*\}|\*\s+as\s+[a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+['"]([^'"]+)['"]/,
    /import\s*\(['"]([^'"]+)['"]\)/,
    /import\s*{[^}]+}\s*from\s+['"]([^'"]+)['"]/,
    /import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/,
  ];
  
  // CommonJS patterns
  const cjsPatterns = [
    /require\s*\(['"]([^'"]+)['"]\)/,
    /require\.resolve\s*\(['"]([^'"]+)['"]\)/,
  ];
  
  // Python patterns
  const pythonPatterns = [
    /^import\s+(\S+)/,
    /^from\s+(\S+)\s+import/,
    /importlib\.import_module\(['"]([^'"]+)['"]\)/,
    /__import__\(['"]([^'"]+)['"]\)/,
  ];
  
  const allPatterns = [...es6Patterns, ...cjsPatterns, ...pythonPatterns];
  
  for (const pattern of allPatterns) {
    const match = pattern.exec(importStatement);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Normalizes package names across different ecosystems
 */
export function normalizePackageName(name: string, ecosystem: 'npm' | 'pypi' | 'go' | 'maven' = 'npm'): string {
  switch (ecosystem) {
    case 'npm':
      // npm packages are case-sensitive but often referenced in lowercase
      return name;
      
    case 'pypi':
      // PyPI normalizes names: lowercase, replace [._-] with -
      return name.toLowerCase().replace(/[._-]+/g, '-');
      
    case 'go':
      // Go modules are case-sensitive
      return name;
      
    case 'maven':
      // Maven uses groupId:artifactId format
      return name;
      
    default:
      return name;
  }
}

/**
 * Common error messages for consistent error handling
 */
export const ErrorMessages = {
  INVALID_PACKAGE_NAME: 'Invalid package name format',
  INVALID_VERSION: 'Invalid version format',
  PACKAGE_NOT_FOUND: 'Package not found in registry',
  NETWORK_ERROR: 'Network error while fetching package information',
  PARSE_ERROR: 'Failed to parse response',
  TIMEOUT: 'Request timed out',
  UNAUTHORIZED: 'Unauthorized access to registry',
} as const;

/**
 * Safely extracts error message from various error types
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  
  return 'Unknown error occurred';
}