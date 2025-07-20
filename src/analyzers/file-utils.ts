/**
 * Common file utilities for analyzers
 * Reduces duplication in file searching and config checking patterns
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import type { UsageLocation } from './base.js';
import { getFileContext } from './utils.js';

export interface ConfigFilePattern {
  pattern: string;
  type: string;
}

export interface FileSearchOptions {
  cwd: string;
  ignore: string[];
}

/**
 * Search for configuration files containing a package reference
 */
export async function findPackageInConfigFiles(
  packageName: string,
  projectPath: string,
  configPatterns: ConfigFilePattern[]
): Promise<UsageLocation[]> {
  const locations: UsageLocation[] = [];

  for (const { pattern, type } of configPatterns) {
    const configFiles = await glob(pattern, { cwd: projectPath });
    
    for (const file of configFiles) {
      const content = await readFile(join(projectPath, file), 'utf-8');
      if (content.includes(packageName)) {
        locations.push({
          file,
          line: 1,
          column: 0,
          type: 'config',
          code: `${packageName} reference in ${type} file`,
          context: 'config'
        });
      }
    }
  }

  return locations;
}

/**
 * Common source file patterns for different ecosystems
 */
export const SOURCE_FILE_PATTERNS = {
  javascript: {
    extensions: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**']
  },
  python: {
    extensions: ['**/*.py'],
    ignore: ['**/venv/**', '**/__pycache__/**', '**/site-packages/**', '**/.tox/**']
  }
};

/**
 * Common configuration file patterns
 */
export const CONFIG_PATTERNS = {
  javascript: [
    { pattern: 'package.json', type: 'package.json' },
    { pattern: 'package-lock.json', type: 'package-lock' },
    { pattern: 'yarn.lock', type: 'yarn.lock' },
    { pattern: 'pnpm-lock.yaml', type: 'pnpm-lock' },
    { pattern: '.npmrc', type: 'npmrc' },
    { pattern: 'tsconfig.json', type: 'tsconfig' },
    { pattern: 'jsconfig.json', type: 'jsconfig' }
  ],
  python: [
    { pattern: 'requirements*.txt', type: 'requirements' },
    { pattern: 'setup.py', type: 'setup' },
    { pattern: 'pyproject.toml', type: 'pyproject' },
    { pattern: 'Pipfile', type: 'pipfile' },
    { pattern: 'tox.ini', type: 'tox' },
    { pattern: '.pre-commit-config.yaml', type: 'precommit' }
  ]
};

/**
 * Find source files matching the given pattern
 */
export async function findSourceFiles(
  projectPath: string,
  ecosystem: 'javascript' | 'python'
): Promise<string[]> {
  const patterns = SOURCE_FILE_PATTERNS[ecosystem];
  
  return await glob(patterns.extensions[0], {
    cwd: projectPath,
    ignore: patterns.ignore
  });
}

/**
 * Search for package references in generic config files
 */
export async function searchInGenericConfigs(
  packageName: string,
  projectPath: string
): Promise<UsageLocation[]> {
  const genericPatterns = [
    { pattern: '**/*.{json,yaml,yml,toml}', type: 'config' }
  ];
  
  const locations: UsageLocation[] = [];
  
  for (const { pattern } of genericPatterns) {
    const configFiles = await glob(pattern, {
      cwd: projectPath,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/venv/**']
    });

    for (const file of configFiles) {
      const content = await readFile(join(projectPath, file), 'utf-8');
      if (content.includes(packageName)) {
        locations.push({
          file,
          line: 1,
          column: 0,
          type: 'config',
          code: `Reference to ${packageName} in config`,
          context: getFileContext(file)
        });
      }
    }
  }
  
  return locations;
}