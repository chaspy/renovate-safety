/**
 * Helper functions for package information processing
 */

import { PACKAGE_CATEGORIES, FRAMEWORKS, RUNTIMES } from '../constants.js';
import { AlternativePackage } from '../library-intelligence.js';

/**
 * Categorize package based on name and keywords
 */
export function categorizePackage(packageName: string, keywords: string[]): string[] {
  const categories: string[] = [];
  const lowerKeywords = keywords.map(k => k.toLowerCase());

  // UI/Frontend
  if (lowerKeywords.some(k => ['ui', 'component', 'react', 'vue', 'angular'].includes(k))) {
    categories.push(PACKAGE_CATEGORIES.FRONTEND);
  }

  // Build tools
  if (lowerKeywords.some(k => ['build', 'bundler', 'webpack', 'rollup'].includes(k))) {
    categories.push(PACKAGE_CATEGORIES.BUILD_TOOL);
  }

  // Testing
  if (
    lowerKeywords.some(k => ['test', 'testing', 'jest', 'mocha'].includes(k)) ||
    packageName.includes('test')
  ) {
    categories.push(PACKAGE_CATEGORIES.TESTING);
  }

  // Utility
  if (lowerKeywords.some(k => ['utility', 'util', 'helper', 'lodash'].includes(k))) {
    categories.push(PACKAGE_CATEGORIES.UTILITY);
  }

  return categories.length > 0 ? categories : [PACKAGE_CATEGORIES.UNKNOWN];
}

/**
 * Detect framework from package name and keywords
 */
export function detectFramework(packageName: string, keywords: string[]): string[] {
  const frameworks: string[] = [];

  if (packageName.includes('react') || keywords.includes('react')) {
    frameworks.push(FRAMEWORKS.REACT);
  }
  if (packageName.includes('vue') || keywords.includes('vue')) {
    frameworks.push(FRAMEWORKS.VUE);
  }
  if (packageName.includes('angular') || keywords.includes('angular')) {
    frameworks.push(FRAMEWORKS.ANGULAR);
  }
  if (packageName.includes('svelte') || keywords.includes('svelte')) {
    frameworks.push(FRAMEWORKS.SVELTE);
  }
  if (packageName.includes('next') || keywords.includes('nextjs')) {
    frameworks.push(FRAMEWORKS.NEXTJS);
  }

  return frameworks;
}

/**
 * Detect runtime from keywords
 */
export function detectRuntime(_packageName: string, keywords: string[]): string[] {
  const runtimes: string[] = [];

  if (keywords.includes('node') || keywords.includes('nodejs')) {
    runtimes.push(RUNTIMES.NODEJS);
  }
  if (keywords.includes('browser') || keywords.includes('client')) {
    runtimes.push(RUNTIMES.BROWSER);
  }
  if (keywords.includes('deno')) {
    runtimes.push(RUNTIMES.DENO);
  }
  if (keywords.includes('bun')) {
    runtimes.push(RUNTIMES.BUN);
  }

  return runtimes.length > 0 ? runtimes : [RUNTIMES.NODEJS]; // Default assumption
}

/**
 * Find package alternatives from curated database
 */
export function findAlternatives(
  packageName: string,
  _categories: string[]
): Promise<AlternativePackage[]> {
  // This would be a curated database of package alternatives
  const alternatives: Record<string, AlternativePackage[]> = {
    lodash: [
      {
        name: 'ramda',
        reason: 'Functional programming approach',
        pros: ['Immutable', 'Curried functions', 'Better tree-shaking'],
        cons: ['Steeper learning curve', 'Different API'],
        migrationEffort: 'high',
      },
    ],
    moment: [
      {
        name: 'date-fns',
        reason: 'Modern, modular date library',
        pros: ['Tree-shakeable', 'Immutable', 'Smaller bundle size'],
        cons: ['Different API', 'No global state'],
        migrationEffort: 'medium',
      },
    ],
  };

  return Promise.resolve(alternatives[packageName] || []);
}

/**
 * Find complementary packages
 */
export function findComplementaryPackages(packageName: string): string[] {
  // This would be a curated database of commonly used packages together
  const complements: Record<string, string[]> = {
    react: ['react-dom', 'react-router', 'styled-components'],
    jest: ['@testing-library/jest-dom', '@testing-library/react'],
    webpack: ['webpack-cli', 'webpack-dev-server'],
  };

  return complements[packageName] || [];
}

/**
 * Check if package has ES modules
 */
export function hasESModules(packageData: unknown): boolean {
  if (!packageData || typeof packageData !== 'object') {
    return false;
  }
  
  const data = packageData as Record<string, unknown>;
  return Boolean(data.module || data.exports);
}

/**
 * Check if package has type definitions
 */
export function hasTypeDefinitions(packageName: string, packageData: unknown): boolean {
  if (!packageData || typeof packageData !== 'object') {
    return false;
  }
  
  const data = packageData as Record<string, unknown>;
  return Boolean(data.types || data.typings || packageName.startsWith('@types/'));
}

/**
 * Parse Node.js support from engines field
 */
export function parseNodeSupport(nodeVersion?: string): string[] {
  if (!nodeVersion) {
    return [];
  }
  return [nodeVersion];
}

/**
 * Parse browser support from browserslist
 */
export function parseBrowserSupport(browserslist?: string[]): string[] {
  return browserslist || [];
}