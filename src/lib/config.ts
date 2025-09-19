import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { safeJsonParse, isConfigObject } from './safe-json.js';
import { getEnvironmentConfig } from './env-config.js';

export type Config = {
  language?: 'en' | 'ja';
  llmProvider?: 'claude-cli' | 'anthropic' | 'openai';
  cacheDir?: string;
};

export async function loadConfig(): Promise<Config> {
  const config: Config = {};

  // Priority 1: Look for config file in home directory (global)
  try {
    const globalConfigPath = path.join(homedir(), '.renovate-safety.json');
    const globalConfig = await fs.readFile(globalConfigPath, 'utf-8');
    const parsed = safeJsonParse(globalConfig, {});
    if (isConfigObject(parsed)) {
      Object.assign(config, parsed);
    }
  } catch {
    // No global config file
  }

  // Priority 2: Look for config file in current directory (local)
  try {
    const localConfig = await fs.readFile('.renovate-safety.json', 'utf-8');
    const parsed = safeJsonParse(localConfig, {});
    if (isConfigObject(parsed)) {
      Object.assign(config, parsed);
    }
  } catch {
    // No local config file
  }

  // Priority 3: Environment variables override config files
  const envConfig = getEnvironmentConfig();

  // Use validated environment config
  config.language = envConfig.language;

  if (envConfig.llmProvider) {
    config.llmProvider = envConfig.llmProvider;
  }

  if (envConfig.cacheDir) {
    config.cacheDir = envConfig.cacheDir;
  }

  return config;
}
