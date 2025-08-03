/**
 * Common parallel processing utilities to reduce code duplication
 */

import pLimit from 'p-limit';

export interface ParallelOptions {
  concurrency?: number;
  continueOnError?: boolean;
  timeout?: number;
}

/**
 * Process an array of items in parallel with concurrency control
 * @param items Array of items to process
 * @param processor Async function to process each item
 * @param options Processing options
 * @returns Array of results
 */
export async function processInParallel<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: ParallelOptions = {}
): Promise<Array<R | Error>> {
  const { concurrency = 10, continueOnError = true, timeout } = options;

  const limit = pLimit(concurrency);

  const processWithTimeout = timeout
    ? (item: T, index: number) => withTimeout(processor(item, index), timeout)
    : processor;

  const promises = items.map((item, index) =>
    limit(async () => {
      try {
        return await processWithTimeout(item, index);
      } catch (error) {
        if (!continueOnError) {
          throw error;
        }
        return error as Error;
      }
    })
  );

  return Promise.all(promises);
}

/**
 * Process files in parallel and filter out errors
 * @param files Array of file paths
 * @param processor Async function to process each file
 * @param options Processing options
 * @returns Array of successful results
 */
export async function processFilesInParallel<R>(
  files: string[],
  processor: (file: string) => Promise<R>,
  options: ParallelOptions = {}
): Promise<R[]> {
  const results = await processInParallel(files, processor, options);

  // Filter out errors and return only successful results
  return results.filter((result): result is R => !(result instanceof Error));
}

/**
 * Map items in parallel with concurrency control
 * @param items Array of items
 * @param mapper Async mapping function
 * @param concurrency Maximum concurrent operations
 * @returns Array of mapped items
 */
export async function mapInParallel<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number = 10
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item) => limit(() => mapper(item))));
}

/**
 * Execute multiple async operations in parallel
 * @param operations Array of async operations
 * @param options Processing options
 * @returns Array of results
 */
export async function executeInParallel<T>(
  operations: Array<() => Promise<T>>,
  options: ParallelOptions = {}
): Promise<Array<T | Error>> {
  return processInParallel(operations, (operation) => operation(), options);
}

/**
 * Batch process items in parallel chunks
 * @param items Array of items to process
 * @param batchSize Size of each batch
 * @param processor Async function to process each batch
 * @param options Processing options
 * @returns Array of batch results
 */
export async function batchProcessInParallel<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R>,
  options: ParallelOptions = {}
): Promise<R[]> {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, Math.min(i + batchSize, items.length)));
  }

  const results = await processInParallel(batches, processor, options);

  // Filter out errors
  return results.filter((result): result is R => !(result instanceof Error));
}

/**
 * Add timeout to a promise
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Collect results from parallel operations with progress tracking
 * @param items Items to process
 * @param processor Async processor function
 * @param options Processing options with progress callback
 * @returns Aggregated results
 */
export async function collectInParallel<T, R>(
  items: T[],
  processor: (item: T) => Promise<R[]>,
  options: ParallelOptions & {
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<R[]> {
  const { onProgress, ...parallelOptions } = options;
  let completed = 0;
  const total = items.length;

  const results = await processInParallel(
    items,
    async (item) => {
      const result = await processor(item);
      completed++;
      if (onProgress) {
        onProgress(completed, total);
      }
      return result;
    },
    parallelOptions
  );

  // Flatten and filter out errors
  return results.filter((result): result is R[] => !(result instanceof Error)).flat();
}
