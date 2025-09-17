/**
 * Constants for library intelligence gathering
 */

export const FALLBACK_VALUES = {
  DESCRIPTION: 'No description available',
  LICENSE: 'Unknown',
  VERSION: 'Unknown',
  EMPTY_STRING: '',
  UNPACKED_SIZE: 0,
  GZIPPED_SIZE: 0,
  TIMEOUT_DEFAULT: 10000,
  TIMEOUT_EXTENDED: 15000,
} as const;

export const PACKAGE_CATEGORIES = {
  FRONTEND: 'frontend',
  BUILD_TOOL: 'build-tool',
  TESTING: 'testing',
  UTILITY: 'utility',
  UNKNOWN: 'unknown',
} as const;

export const FRAMEWORKS = {
  REACT: 'React',
  VUE: 'Vue',
  ANGULAR: 'Angular',
  SVELTE: 'Svelte',
  NEXTJS: 'Next.js',
} as const;

export const RUNTIMES = {
  NODEJS: 'Node.js',
  BROWSER: 'Browser',
  DENO: 'Deno',
  BUN: 'Bun',
} as const;

export const RELEASE_FREQUENCIES = {
  VERY_ACTIVE: 'very-active',
  ACTIVE: 'active',
  MODERATE: 'moderate',
  SLOW: 'slow',
  INACTIVE: 'inactive',
} as const;

export const MAINTAINER_RESPONSES = {
  EXCELLENT: 'excellent',
  GOOD: 'good',
  AVERAGE: 'average',
  POOR: 'poor',
  UNKNOWN: 'unknown',
} as const;

export const COMMUNITY_HEALTH_LEVELS = {
  EXCELLENT: 'excellent',
  GOOD: 'good',
  AVERAGE: 'average',
  POOR: 'poor',
} as const;

export const AUDIT_STATUSES = {
  CLEAN: 'clean',
  WARNINGS: 'warnings',
  VULNERABILITIES: 'vulnerabilities',
  UNKNOWN: 'unknown',
} as const;

export const SEVERITY_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'moderate',
  LOW: 'low',
} as const;

export const COMPLEXITY_LEVELS = {
  SIMPLE: 'simple',
  MODERATE: 'moderate',
  COMPLEX: 'complex',
  VERY_COMPLEX: 'very-complex',
} as const;

export const MIGRATION_COMPLEXITY = {
  TRIVIAL: 'trivial',
  SIMPLE: 'simple',
  MODERATE: 'moderate',
  COMPLEX: 'complex',
  MAJOR: 'major',
} as const;

export const MIGRATION_EFFORT_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;
