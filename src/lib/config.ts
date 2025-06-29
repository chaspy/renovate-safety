import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export interface Config {
  language?: 'en' | 'ja';
  llmProvider?: 'claude-cli' | 'anthropic' | 'openai';
  cacheDir?: string;
}

export async function loadConfig(): Promise<Config> {
  const config: Config = {};
  
  // Priority 1: Look for config file in home directory (global)
  try {
    const globalConfigPath = path.join(homedir(), '.renovate-safety.json');
    const globalConfig = await fs.readFile(globalConfigPath, 'utf-8');
    Object.assign(config, JSON.parse(globalConfig));
  } catch {
    // No global config file
  }
  
  // Priority 2: Look for config file in current directory (local)
  try {
    const localConfig = await fs.readFile('.renovate-safety.json', 'utf-8');
    Object.assign(config, JSON.parse(localConfig));
  } catch {
    // No local config file
  }
  
  // Priority 3: Environment variables override config files
  if (process.env.RENOVATE_SAFETY_LANGUAGE) {
    config.language = process.env.RENOVATE_SAFETY_LANGUAGE as 'en' | 'ja';
  }
  
  if (process.env.RENOVATE_SAFETY_LLM_PROVIDER) {
    config.llmProvider = process.env.RENOVATE_SAFETY_LLM_PROVIDER as 'claude-cli' | 'anthropic' | 'openai';
  }
  
  if (process.env.RENOVATE_SAFETY_CACHE_DIR) {
    config.cacheDir = process.env.RENOVATE_SAFETY_CACHE_DIR;
  }
  
  return config;
}