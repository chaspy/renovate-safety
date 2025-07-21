/**
 * Common glob and file filtering utilities to reduce code duplication
 */

import { glob } from 'glob';
import { join } from 'path';

export interface GlobOptions {
  ecosystem?: 'node' | 'python' | 'general';
  includeTests?: boolean;
  absolute?: boolean;
  additionalIgnore?: string[];
}

/**
 * Common ignore patterns for different ecosystems
 */
const COMMON_IGNORE_PATTERNS = {
  base: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.cache/**',
    '**/tmp/**',
    '**/.tmp/**'
  ],
  node: [
    '**/.npm/**',
    '**/.yarn/**',
    '**/.pnp.*',
    '**/bower_components/**'
  ],
  python: [
    '**/__pycache__/**',
    '**/*.pyc',
    '**/.pytest_cache/**',
    '**/venv/**',
    '**/.venv/**',
    '**/site-packages/**',
    '**/.tox/**',
    '**/.mypy_cache/**'
  ],
  test: [
    '**/*.test.*',
    '**/*.spec.*',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
    '**/test_*',
    '**/*_test.*'
  ]
};

/**
 * Get ignore patterns based on options
 */
function getIgnorePatterns(options: GlobOptions): string[] {
  const patterns: string[] = [...COMMON_IGNORE_PATTERNS.base];
  
  if (options.ecosystem === 'node') {
    patterns.push(...COMMON_IGNORE_PATTERNS.node);
  } else if (options.ecosystem === 'python') {
    patterns.push(...COMMON_IGNORE_PATTERNS.python);
  }
  
  if (!options.includeTests) {
    patterns.push(...COMMON_IGNORE_PATTERNS.test);
  }
  
  if (options.additionalIgnore) {
    patterns.push(...options.additionalIgnore);
  }
  
  return patterns;
}

/**
 * Get files matching patterns with common ignore rules
 */
export async function getFiles(
  patterns: string | string[],
  options: GlobOptions = {}
): Promise<string[]> {
  const patternArray = Array.isArray(patterns) ? patterns : [patterns];
  const ignorePatterns = getIgnorePatterns(options);
  
  const allFiles: string[] = [];
  
  for (const pattern of patternArray) {
    const files = await glob(pattern, {
      ignore: ignorePatterns,
      absolute: options.absolute
    });
    allFiles.push(...files);
  }
  
  // Remove duplicates
  return [...new Set(allFiles)];
}

/**
 * Get source files for a specific ecosystem
 */
export async function getSourceFiles(
  projectPath: string,
  ecosystem: 'node' | 'python' | 'general' = 'general'
): Promise<string[]> {
  const patterns = {
    node: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    python: ['**/*.py', '**/*.pyi'],
    general: ['**/*.{js,jsx,ts,tsx,py,java,cpp,c,h,go,rs,rb,php}']
  };
  
  return getFiles(patterns[ecosystem], {
    ecosystem,
    includeTests: false,
    absolute: true
  });
}

/**
 * Get configuration files
 */
export async function getConfigFiles(
  projectPath: string,
  configPatterns?: string[]
): Promise<string[]> {
  const defaultPatterns = [
    'package.json',
    'tsconfig*.json',
    '.eslintrc*',
    '.prettierrc*',
    'babel.config.*',
    'webpack.config.*',
    'rollup.config.*',
    'vite.config.*',
    'jest.config.*',
    'pyproject.toml',
    'setup.py',
    'setup.cfg',
    'requirements*.txt',
    'Pipfile*',
    '.pre-commit-config.yaml'
  ];
  
  const patterns = configPatterns || defaultPatterns;
  
  return getFiles(patterns, {
    absolute: true,
    additionalIgnore: ['**/node_modules/**', '**/venv/**']
  });
}

/**
 * Check if a file matches any of the given patterns
 */
export function matchesPattern(filePath: string, patterns: string[]): boolean {
  const fileName = filePath.split('/').pop() || '';
  
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Simple glob matching
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      );
      if (regex.test(fileName)) {
        return true;
      }
    } else if (fileName === pattern || filePath.endsWith(pattern)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Filter files by extension
 */
export function filterByExtension(files: string[], extensions: string[]): string[] {
  const extensionSet = new Set(extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`));
  return files.filter(file => {
    const ext = file.substring(file.lastIndexOf('.'));
    return extensionSet.has(ext);
  });
}