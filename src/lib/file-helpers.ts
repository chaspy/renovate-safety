/**
 * Common file operation utilities to reduce code duplication
 */

import * as fs from 'fs/promises';
import { safeJsonParse } from './safe-json.js';

/**
 * Check if a file exists
 * @param path File path to check
 * @returns true if file exists, false otherwise
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse JSON file safely
 * @param path Path to JSON file
 * @returns Parsed JSON data or null on error
 */
export async function readJsonFile<T = any>(path: string): Promise<T | null> {
  try {
    const content = await fs.readFile(path, 'utf-8');
    return safeJsonParse(content, null);
  } catch {
    return null;
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 * @param path Directory path
 */
export async function ensureDirectory(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

/**
 * Write JSON data to file
 * @param path File path
 * @param data Data to write
 * @param indent Indentation for pretty printing (default: 2)
 */
export async function writeJsonFile(
  path: string,
  data: any,
  indent: number = 2
): Promise<void> {
  await fs.writeFile(path, JSON.stringify(data, null, indent), 'utf-8');
}

/**
 * Read file with default value on error
 * @param path File path
 * @param defaultValue Default value if file doesn't exist or can't be read
 * @returns File content or default value
 */
export async function readFileWithDefault(
  path: string,
  defaultValue: string = ''
): Promise<string> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return defaultValue;
  }
}