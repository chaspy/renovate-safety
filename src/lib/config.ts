import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { safeJsonParse, isConfigObject } from './safe-json.js';

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
  const lang = process.env.RENOVATE_SAFETY_LANGUAGE;
  if (lang === 'en' || lang === 'ja') {
    config.language = lang;
  }
  
  const provider = process.env.RENOVATE_SAFETY_LLM_PROVIDER;
  if (provider === 'claude-cli' || provider === 'anthropic' || provider === 'openai') {
    config.llmProvider = provider;
  }
  
  const cacheDir = process.env.RENOVATE_SAFETY_CACHE_DIR;
  if (cacheDir && typeof cacheDir === 'string' && cacheDir.length > 0) {
    config.cacheDir = cacheDir;
  }
  
  return config;
}