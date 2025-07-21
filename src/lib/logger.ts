/**
 * Common logging utilities
 * Centralizes logging patterns to reduce code duplication
 */

import { getErrorMessage } from '../analyzers/utils.js';

export interface LogContext {
  operation: string;
  target?: string;
  error?: unknown;
  metadata?: Record<string, any>;
}

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
export function logDebug(message: string, ...args: any[]): void {
  if (process.env.DEBUG || process.env.VERBOSE) {
    console.debug(message, ...args);
  }
}

/**
 * Info logger
 */
export function logInfo(message: string, ...args: any[]): void {
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
      error
    });
  },
  
  npmOperationFailed: (operation: string, packageSpec: string, error: unknown) => {
    logWarning({
      operation,
      target: packageSpec,
      error
    });
  },
  
  genericFailed: (operation: string, error: unknown) => {
    logWarning({
      operation,
      error
    });
  },
  
  debug: (message: string, ...args: any[]) => {
    logDebug(message, ...args);
  },
  
  info: (message: string, ...args: any[]) => {
    logInfo(message, ...args);
  },
  
  warn: (message: string, ...args: any[]) => {
    console.warn(message, ...args);
  }
};