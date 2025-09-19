/**
 * Centralized and secure environment variable configuration
 * Addresses SonarCloud security hotspots by validating all env access
 */

import { getEnvVar, getEnvVarEnum } from './env-validator.js';

export type EnvironmentConfig = {
  // API Keys (sensitive)
  anthropicApiKey?: string;
  openaiApiKey?: string;
  githubToken?: string;

  // Application Configuration
  language: 'en' | 'ja';
  llmProvider?: 'claude-cli' | 'anthropic' | 'openai';
  cacheDir?: string;

  // Debug Configuration
  debug: boolean;
  verbose: boolean;
};

/**
 * Securely load and validate all environment variables
 * Centralizes access to prevent direct process.env usage
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
  return {
    // API Keys - validated and sanitized
    anthropicApiKey: getEnvVar('ANTHROPIC_API_KEY', (value) => value.length > 10),
    openaiApiKey: getEnvVar('OPENAI_API_KEY', (value) => value.length > 10),
    githubToken:
      getEnvVar(
        'GITHUB_TOKEN',
        (value) =>
          value.startsWith('ghp_') || value.startsWith('github_pat_') || value.startsWith('gho_')
      ) ||
      getEnvVar(
        'GH_TOKEN',
        (value) =>
          value.startsWith('ghp_') || value.startsWith('github_pat_') || value.startsWith('gho_')
      ),

    // Configuration - with validation
    language: getEnvVarEnum('RENOVATE_SAFETY_LANGUAGE', ['en', 'ja'] as const) || 'en',
    llmProvider: getEnvVarEnum('RENOVATE_SAFETY_LLM_PROVIDER', [
      'claude-cli',
      'anthropic',
      'openai',
    ] as const),
    cacheDir: getEnvVar('RENOVATE_SAFETY_CACHE_DIR', (value) => value.length > 0),

    // Debug flags
    debug: Boolean(getEnvVar('DEBUG')),
    verbose: Boolean(getEnvVar('VERBOSE')),
  };
}

// Singleton instance to avoid repeated validation
let _config: EnvironmentConfig | null = null;

/**
 * Get validated environment configuration (singleton)
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  _config ??= loadEnvironmentConfig();
  return _config;
}

/**
 * Check if API keys are available for LLM functionality
 */
export function hasLLMApiKeys(): boolean {
  const config = getEnvironmentConfig();
  return Boolean(config.anthropicApiKey || config.openaiApiKey);
}

/**
 * Check if GitHub token is available
 */
export function hasGitHubAccess(): boolean {
  const config = getEnvironmentConfig();
  return Boolean(config.githubToken);
}

/**
 * Get safe configuration for logging (excludes sensitive data)
 */
export function getSafeConfig(): Omit<
  EnvironmentConfig,
  'anthropicApiKey' | 'openaiApiKey' | 'githubToken'
> {
  const config = getEnvironmentConfig();
  return {
    language: config.language,
    llmProvider: config.llmProvider,
    cacheDir: config.cacheDir,
    debug: config.debug,
    verbose: config.verbose,
  };
}
