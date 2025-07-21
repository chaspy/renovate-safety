/**
 * Common iteration and collection utilities to reduce code duplication
 */

/**
 * Execute an async callback for each item in an array sequentially
 * @param items Array of items to iterate
 * @param callback Async callback to execute for each item
 */
export async function forEachAsync<T>(
  items: T[],
  callback: (item: T, index: number) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await callback(items[i], i);
  }
}

/**
 * Map over an array with async callback
 * @param items Array of items to map
 * @param callback Async callback to transform each item
 * @returns Array of transformed items
 */
export async function mapAsync<T, R>(
  items: T[],
  callback: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    results.push(await callback(items[i], i));
  }
  return results;
}

/**
 * Filter an array with async predicate
 * @param items Array of items to filter
 * @param predicate Async predicate function
 * @returns Filtered array
 */
export async function filterAsync<T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<boolean>
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (await predicate(items[i], i)) {
      results.push(items[i]);
    }
  }
  return results;
}

/**
 * Find first item matching async predicate
 * @param items Array of items to search
 * @param predicate Async predicate function
 * @returns First matching item or undefined
 */
export async function findAsync<T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<boolean>
): Promise<T | undefined> {
  for (let i = 0; i < items.length; i++) {
    if (await predicate(items[i], i)) {
      return items[i];
    }
  }
  return undefined;
}

/**
 * Reduce array with async reducer
 * @param items Array of items to reduce
 * @param reducer Async reducer function
 * @param initialValue Initial value for reduction
 * @returns Reduced value
 */
export async function reduceAsync<T, R>(
  items: T[],
  reducer: (accumulator: R, current: T, index: number) => Promise<R>,
  initialValue: R
): Promise<R> {
  let accumulator = initialValue;
  for (let i = 0; i < items.length; i++) {
    accumulator = await reducer(accumulator, items[i], i);
  }
  return accumulator;
}

/**
 * Process items in batches with async callback
 * @param items Array of items to process
 * @param batchSize Size of each batch
 * @param callback Async callback to process each batch
 */
export async function batchProcessAsync<T>(
  items: T[],
  batchSize: number,
  callback: (batch: T[]) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));
    await callback(batch);
  }
}

/**
 * Execute callbacks in parallel with concurrency limit
 * @param items Array of items
 * @param concurrency Maximum concurrent operations
 * @param callback Async callback for each item
 * @returns Array of results
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing: Promise<void>[] = [];
  
  for (let i = 0; i < items.length; i++) {
    const promise = callback(items[i]).then(result => {
      results[i] = result;
    });
    
    executing.push(promise);
    
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(p => p === promise), 1);
    }
  }
  
  await Promise.all(executing);
  return results;
}