/**
 * Common error handling utilities to reduce code duplication
 */

import { loggers } from './logger.js';
import { getErrorMessage } from '../analyzers/utils.js';

/**
 * Execute an async operation with automatic error logging
 * @param operation The async operation to execute
 * @param operationType Type of operation for logging
 * @param identifier Optional identifier for more specific logging
 * @returns Result of operation or null on error
 */
export async function tryWithLogging<T>(
  operation: () => Promise<T>,
  operationType: string,
  identifier?: string
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const context = identifier ? `${operationType} for ${identifier}` : operationType;
    loggers.genericFailed(context, error);
    return null;
  }
}

/**
 * Execute an async operation with custom error handler
 * @param operation The async operation to execute
 * @param errorHandler Custom error handler
 * @returns Result of operation or null on error
 */
export async function tryWithHandler<T>(
  operation: () => Promise<T>,
  errorHandler: (error: unknown) => void
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    errorHandler(error);
    return null;
  }
}

/**
 * Execute an async operation with default value on error
 * @param operation The async operation to execute
 * @param defaultValue Default value to return on error
 * @param logError Whether to log the error (default: true)
 * @returns Result of operation or default value on error
 */
export async function tryWithDefault<T>(
  operation: () => Promise<T>,
  defaultValue: T,
  logError: boolean = true
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (logError) {
      console.warn('Operation failed:', getErrorMessage(error));
    }
    return defaultValue;
  }
}

/**
 * Execute multiple async operations in parallel with error handling
 * @param operations Array of async operations
 * @returns Array of results (null for failed operations)
 */
export async function tryAllWithLogging<T>(
  operations: Array<{
    operation: () => Promise<T>;
    operationType: string;
    identifier?: string;
  }>
): Promise<Array<T | null>> {
  return Promise.all(
    operations.map(({ operation, operationType, identifier }) =>
      tryWithLogging(operation, operationType, identifier)
    )
  );
}

/**
 * Wrap a function to add automatic error logging
 * @param fn The function to wrap
 * @param operationType Type of operation for logging
 * @returns Wrapped function with error handling
 */
export function withErrorLogging<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  operationType: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      loggers.genericFailed(operationType, error);
      return null;
    }
  }) as T;
}
