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
  }
};