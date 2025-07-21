/**
 * Safe JSON parsing utilities
 */

import { loggers } from './logger.js';

/**
 * Safely parse JSON with error handling
 * @param text JSON string to parse
 * @param defaultValue Default value to return on parse error
 * @returns Parsed object or default value
 */
export function safeJsonParse<T>(text: string, defaultValue: T): T {
  try {
    if (!text || typeof text !== 'string') {
      return defaultValue;
    }
    return JSON.parse(text);
  } catch (error) {
    loggers.warn('Failed to parse JSON:', error instanceof Error ? error.message : 'Unknown error');
    return defaultValue;
  }
}

/**
 * Safely parse JSON with validation
 * @param text JSON string to parse
 * @param validator Function to validate parsed data
 * @returns Parsed and validated object or null
 */
export function safeJsonParseWithValidation<T>(
  text: string,
  validator: (data: unknown) => data is T
): T | null {
  try {
    if (!text || typeof text !== 'string') {
      return null;
    }
    const parsed = JSON.parse(text);
    if (validator(parsed)) {
      return parsed;
    }
    loggers.warn('Parsed JSON failed validation');
    return null;
  } catch (error) {
    loggers.warn('Failed to parse JSON:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Type guard for Config objects
 */
export function isConfigObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}