/**
 * Common logging utilities
 * Centralizes logging patterns to reduce code duplication
 */

import { getErrorMessage } from '../analyzers/utils.js';
import { getEnvironmentConfig } from './env-config.js';

export type LogContext = {
  operation: string;
  target?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
};

/**
 * Standardized warning logger for failed operations
 */
export function logWarning(context: LogContext): void {
  const { operation, target, error, metadata } = context;

  let message = `Failed to ${operation}`;
  if (target) {
    message += ` for ${target}`;
  }
  message += ':';

  const errorMessage = error ? getErrorMessage(error) : 'Unknown error';

  if (metadata) {
    console.warn(message, errorMessage, metadata);
  } else {
    console.warn(message, errorMessage);
  }
}

/**
 * Debug logger
 */
export function logDebug(message: string, ...args: unknown[]): void {
  const config = getEnvironmentConfig();
  if (config.debug || config.verbose) {
    console.debug(message, ...args);
  }
}

/**
 * Info logger
 */
export function logInfo(message: string, ...args: unknown[]): void {
  console.log(message, ...args);
}

/**
 * Specialized loggers for common patterns
 */
export const loggers = {
  fetchFailed: (resource: string, target: string, error: unknown) => {
    logWarning({
      operation: `fetch ${resource}`,
      target,
      error,
    });
  },

  npmOperationFailed: (operation: string, packageSpec: string, error: unknown) => {
    logWarning({
      operation,
      target: packageSpec,
      error,
    });
  },

  genericFailed: (operation: string, error: unknown) => {
    logWarning({
      operation,
      error,
    });
  },

  debug: (message: string, ...args: unknown[]) => {
    logDebug(message, ...args);
  },

  info: (message: string, ...args: unknown[]) => {
    logInfo(message, ...args);
  },

  warn: (message: string, ...args: unknown[]) => {
    console.warn(message, ...args);
  },
};
