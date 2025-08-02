import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { clearTimeout } from 'node:timers';
import { readJsonFile, ensureDirectory } from './file-helpers.js';
import { processInParallel, executeInParallel } from './parallel-helpers.js';

export interface PerformanceOptimizer {
  cache: SmartCache;
  parallelExecutor: ParallelExecutor;
  progressTracker: ProgressTracker;
}

export interface SmartCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  invalidate(pattern: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ParallelExecutor {
  execute<T>(tasks: Task<T>[], options?: ExecutionOptions): Promise<T[]>;
  executeWithDependencies<T>(tasks: DependentTask<T>[]): Promise<T[]>;
}

export interface ProgressTracker {
  start(total: number, description: string): void;
  update(completed: number, currentTask?: string): void;
  finish(): void;
}

export interface Task<T> {
  id: string;
  name: string;
  priority: 'high' | 'medium' | 'low';
  execute: () => Promise<T>;
  timeout?: number;
  retries?: number;
}

export interface DependentTask<T> extends Task<T> {
  dependencies: string[];
}

export interface ExecutionOptions {
  maxConcurrency?: number;
  timeout?: number;
  failFast?: boolean;
  retryFailedTasks?: boolean;
}

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

export function createPerformanceOptimizer(cacheDir: string): PerformanceOptimizer {
  const cache = new FileBasedCache(cacheDir);
  const parallelExecutor = new ConcurrentExecutor();
  const progressTracker = new ConsoleProgressTracker();

  return {
    cache,
    parallelExecutor,
    progressTracker,
  };
}

class FileBasedCache implements SmartCache {
  private cacheDir: string;
  private memoryCache = new Map<string, CacheEntry<unknown>>();

  constructor(cacheDir: string) {
    this.cacheDir = path.join(cacheDir, 'performance-cache');
  }

  async get<T>(key: string): Promise<T | null> {
    // Check memory cache first
    const memoryCached = this.memoryCache.get(key);
    if (memoryCached && !this.isExpired(memoryCached)) {
      return memoryCached.value as T;
    }

    // Check file cache
    try {
      const cacheFile = this.getCacheFilePath(key);
      const entryData = await readJsonFile(cacheFile);
      const entry = entryData as CacheEntry<T>;

      if (entry && !this.isExpired(entry)) {
        // Cache in memory for faster access
        this.memoryCache.set(key, entry);
        return entry.value;
      } else {
        // Remove expired file
        await fs.unlink(cacheFile).catch(() => {});
      }
    } catch {
      // Cache miss or error
    }

    return null;
  }

  async set<T>(key: string, value: T, ttl: number = 3600000): Promise<void> {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl,
    };

    // Store in memory
    this.memoryCache.set(key, entry);

    // Store in file
    try {
      await ensureDirectory(this.cacheDir);
      const cacheFile = this.getCacheFilePath(key);
      await fs.writeFile(cacheFile, JSON.stringify(entry, null, 2));
    } catch (error) {
      console.debug('Failed to write cache file:', error);
    }
  }

  async invalidate(pattern: string): Promise<void> {
    // Clear matching entries from memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern)) {
        this.memoryCache.delete(key);
      }
    }

    // Clear matching files
    try {
      const files = await fs.readdir(this.cacheDir);
      const matching = files.filter((file) => file.includes(this.hashKey(pattern)));

      await processInParallel(
        matching,
        async (file) => {
          try {
            await fs.unlink(path.join(this.cacheDir, file));
          } catch {
            // Ignore unlink errors
          }
        },
        { concurrency: 10 }
      );
    } catch {
      // Directory might not exist
    }
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();

    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  }

  private getCacheFilePath(key: string): string {
    const hashedKey = this.hashKey(key);
    return path.join(this.cacheDir, `${hashedKey}.json`);
  }

  private hashKey(key: string): string {
    return createHash('md5').update(key).digest('hex');
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }
}

class ConcurrentExecutor implements ParallelExecutor {
  async execute<T>(tasks: Task<T>[], options: ExecutionOptions = {}): Promise<T[]> {
    const {
      maxConcurrency = 5,
      timeout = 30000,
      failFast = false,
      retryFailedTasks = true,
    } = options;

    const results: T[] = new Array(tasks.length);
    const errors: Error[] = [];

    // Sort tasks by priority
    const sortedTasks = tasks
      .map((task, index) => ({ task, originalIndex: index }))
      .sort(
        (a, b) => this.getPriorityWeight(a.task.priority) - this.getPriorityWeight(b.task.priority)
      );

    // Execute tasks in batches
    const batches = this.createBatches(sortedTasks, maxConcurrency);

    for (const batch of batches) {
      const batchPromises = batch.map(async ({ task, originalIndex }) => {
        try {
          const result = await this.executeTask(task, timeout);
          results[originalIndex] = result;
        } catch (error) {
          errors.push(error as Error);

          if (failFast) {
            throw error;
          }

          if (retryFailedTasks && task.retries && task.retries > 0) {
            try {
              const retryTask = { ...task, retries: task.retries - 1 };
              const result = await this.executeTask(retryTask, timeout);
              results[originalIndex] = result;
            } catch (retryError) {
              errors.push(retryError as Error);
            }
          }
        }
      });

      await Promise.allSettled(batchPromises);
    }

    if (errors.length > 0 && failFast) {
      throw new Error(`Task execution failed: ${errors.map((e) => e.message).join(', ')}`);
    }

    return results;
  }

  async executeWithDependencies<T>(tasks: DependentTask<T>[]): Promise<T[]> {
    const results = new Map<string, T>();
    const completed = new Set<string>();
    const inProgress = new Set<string>();

    const executeTask = async (task: DependentTask<T>): Promise<void> => {
      // Wait for dependencies
      for (const depId of task.dependencies) {
        while (!completed.has(depId)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      inProgress.add(task.id);
      try {
        const result = await task.execute();
        results.set(task.id, result);
        completed.add(task.id);
      } finally {
        inProgress.delete(task.id);
      }
    };

    // Find tasks with no dependencies and start them
    const readyTasks = tasks.filter((task) => task.dependencies.length === 0);
    const pendingTasks = tasks.filter((task) => task.dependencies.length > 0);

    // Execute ready tasks
    await executeInParallel(
      readyTasks.map((task) => () => executeTask(task)),
      { concurrency: 10 }
    );

    // Execute remaining tasks as dependencies are satisfied
    while (pendingTasks.length > 0) {
      const nowReady = pendingTasks.filter(
        (task) =>
          task.dependencies.every((dep) => completed.has(dep)) &&
          !inProgress.has(task.id) &&
          !completed.has(task.id)
      );

      if (nowReady.length === 0) {
        throw new Error('Circular dependency detected or unresolvable dependencies');
      }

      await executeInParallel(
        nowReady.map((task) => () => executeTask(task)),
        { concurrency: 10 }
      );

      // Remove completed tasks from pending
      nowReady.forEach((task) => {
        const index = pendingTasks.indexOf(task);
        if (index > -1) pendingTasks.splice(index, 1);
      });
    }

    return tasks.map((task) => {
      const result = results.get(task.id);
      if (!result) {
        throw new Error(`Task ${task.id} result not found`);
      }
      return result;
    });
  }

  private async executeTask<T>(task: Task<T>, timeout: number): Promise<T> {
    const taskTimeout = task.timeout || timeout;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task ${task.name} timed out after ${taskTimeout}ms`));
      }, taskTimeout);

      task
        .execute()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private getPriorityWeight(priority: 'high' | 'medium' | 'low'): number {
    switch (priority) {
      case 'high':
        return 1;
      case 'medium':
        return 2;
      case 'low':
        return 3;
      default:
        return 3;
    }
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}

class ConsoleProgressTracker implements ProgressTracker {
  private total: number = 0;
  private completed: number = 0;
  private description: string = '';
  private startTime: number = 0;

  start(total: number, description: string): void {
    this.total = total;
    this.completed = 0;
    this.description = description;
    this.startTime = Date.now();

    console.log(`\n🚀 Starting: ${description}`);
    this.updateDisplay();
  }

  update(completed: number, currentTask?: string): void {
    this.completed = completed;
    this.updateDisplay(currentTask);
  }

  finish(): void {
    const duration = Date.now() - this.startTime;
    console.log(`\n✅ Completed: ${this.description} (${duration}ms)`);
  }

  private updateDisplay(currentTask?: string): void {
    const percentage = Math.round((this.completed / this.total) * 100);
    const progressBar = this.createProgressBar(percentage);
    const elapsed = Date.now() - this.startTime;
    const eta =
      this.completed > 0
        ? Math.round((elapsed / this.completed) * (this.total - this.completed))
        : 0;

    process.stdout.write(
      `\r${progressBar} ${percentage}% (${this.completed}/${this.total}) ETA: ${eta}ms`
    );

    if (currentTask) {
      process.stdout.write(` - ${currentTask}`);
    }
  }

  private createProgressBar(percentage: number): string {
    const width = 20;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }
}

// Utility functions for creating optimized tasks
export function createOptimizedAnalysisFlow(
  packageName: string,
  fromVersion: string,
  toVersion: string
) {
  const tasks: DependentTask<unknown>[] = [
    {
      id: 'basic-info',
      name: 'Extract basic package info',
      priority: 'high',
      dependencies: [],
      execute: async () => {
        // Basic package information extraction
        return { packageName, fromVersion, toVersion };
      },
    },
    {
      id: 'dependency-analysis',
      name: 'Analyze dependency tree',
      priority: 'high',
      dependencies: [],
      execute: async () => {
        // Enhanced dependency analysis
        const { performEnhancedDependencyAnalysis } = await import(
          './enhanced-dependency-analysis.js'
        );
        return performEnhancedDependencyAnalysis(packageName, fromVersion, toVersion);
      },
    },
    {
      id: 'library-intelligence',
      name: 'Gather library intelligence',
      priority: 'medium',
      dependencies: [],
      execute: async () => {
        // Library intelligence gathering
        const { gatherLibraryIntelligence } = await import('./library-intelligence.js');
        return gatherLibraryIntelligence(packageName, fromVersion, toVersion);
      },
    },
    {
      id: 'code-diff',
      name: 'Fetch and analyze code diff',
      priority: 'medium',
      dependencies: ['basic-info'],
      execute: async () => {
        // Code diff analysis
        const { fetchCodeDiff } = await import('./github-diff.js');
        const packageUpdate = { name: packageName, fromVersion, toVersion };
        return fetchCodeDiff(packageUpdate);
      },
    },
    {
      id: 'enhanced-code-analysis',
      name: 'Perform enhanced code analysis',
      priority: 'medium',
      dependencies: ['code-diff'],
      execute: async () => {
        // Enhanced code analysis
        const { performEnhancedCodeAnalysis } = await import('./enhanced-code-analysis.js');
        const packageUpdate = { name: packageName, fromVersion, toVersion };
        // Would need to pass the code diff result here
        return performEnhancedCodeAnalysis(packageUpdate, null);
      },
    },
    {
      id: 'llm-analysis',
      name: 'Generate LLM analysis',
      priority: 'low',
      dependencies: ['dependency-analysis', 'library-intelligence', 'enhanced-code-analysis'],
      execute: async () => {
        // Enhanced LLM analysis with all context
        // TODO: Implement using buildSuperEnhancedPrompt from enhanced-llm-prompts
        // const { buildSuperEnhancedPrompt } = await import('./enhanced-llm-prompts.js');
        // Would combine all previous results into comprehensive prompt
        return null; // Placeholder
      },
    },
  ];

  return tasks;
}

export function getCacheKey(
  type: string,
  packageName: string,
  version: string,
  ...additionalParams: string[]
): string {
  const params = [type, packageName, version, ...additionalParams].join(':');
  return createHash('md5').update(params).digest('hex');
}
