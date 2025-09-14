import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import { breakingChangeAnalyzer } from './breaking-change-analyzer.js';
import { httpGet } from '../../lib/http-client.js';

// Zod schemas
const diffChangeSchema = z.object({
  file: z.string(),
  type: z.enum(['added', 'removed', 'modified']),
  additions: z.number(),
  deletions: z.number(),
  content: z.string().optional(),
});

const dependencyComparisonSchema = z.object({
  added: z.record(z.string()),
  removed: z.record(z.string()),
  updated: z.record(z.object({
    from: z.string(),
    to: z.string(),
  })),
});

const fallbackResultSchema = z.object({
  success: z.boolean(),
  source: z.string().optional(),
  error: z.string().optional(),
  changes: z.object({
    dependencies: dependencyComparisonSchema,
    scripts: dependencyComparisonSchema,
    engines: z.record(z.object({
      from: z.string(),
      to: z.string(),
    })),
  }).optional(),
});

const inputSchema = z.object({
  packageName: z.string().describe('NPM package name'),
  fromVersion: z.string().describe('Source version'),
  toVersion: z.string().describe('Target version'),
});

const enhancedBreakingChangeSchema = z.object({
  text: z.string(),
  severity: z.enum(['critical', 'breaking', 'warning']),
  source: z.string(),
  category: z.enum(['runtime-requirement', 'api-change', 'removal', 'deprecation', 'documented-change']),
  confidence: z.number(),
});

const outputSchema = z.object({
  success: z.boolean(),
  diff: z.array(diffChangeSchema).optional(),
  source: z.string().optional(),
  raw: z.string().optional(),
  error: z.string().optional(),
  fallback: fallbackResultSchema.optional(),
  breakingChanges: z.array(enhancedBreakingChangeSchema).optional(),
  legacyBreakingChanges: z.array(z.string()).optional(), // For backward compatibility
});

export const npmDiffTool = createTool({
  id: 'npm-diff',
  description: 'Get unified diff between two npm package versions',
  inputSchema,
  outputSchema,
  execute: async ({ context: { packageName, fromVersion, toVersion } }) => {
    try {
      // npm diff の正しい構文で実行
      const diffSpec1 = `${packageName}@${fromVersion}`;
      const diffSpec2 = `${packageName}@${toVersion}`;

      const result = await executeNpmDiff(diffSpec1, diffSpec2);

      if (!result.success) {
        // フォールバック: package.jsonの差分を取得
        const fallbackResult = await fallbackToDirect(packageName, fromVersion, toVersion);
        return {
          success: false,
          error: 'npm diff command failed',
          fallback: fallbackResult,
        };
      }

      // 差分を解析
      const parsed = parseDiff(result.output);

      // 追加: 公開エントリヒントを両バージョンのpackage.jsonから抽出
      let publicEntryHints: string[] = [];
      try {
        const [fromPkg, toPkg] = await Promise.all([
          fetchPackageJson(packageName, fromVersion),
          fetchPackageJson(packageName, toVersion),
        ]);

        const collectHints = (pkg: any): string[] => {
          const hints = new Set<string>();
          if (!pkg || typeof pkg !== 'object') return [];
          const add = (v?: unknown) => {
            if (typeof v === 'string' && v.trim()) hints.add(v.trim());
          };

          add(pkg.main);
          add(pkg.module);
          add(pkg.types);

          // exportsフィールドを再帰的に走査
          const walkExports = (node: unknown) => {
            if (!node) return;
            if (typeof node === 'string') {
              add(node);
              return;
            }
            if (typeof node === 'object') {
              for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
                if (typeof v === 'string') add(v);
                else walkExports(v);
                // キーがパス拡張子のこともある（"./map"）のでキーも候補に
                if (k.startsWith('./')) hints.add(k);
              }
            }
          };
          walkExports(pkg.exports);

          return Array.from(hints);
        };

        const fromHints = collectHints(fromPkg);
        const toHints = collectHints(toPkg);

        publicEntryHints = Array.from(new Set([...fromHints, ...toHints]));
      } catch {
        // ignore hint extraction failures
      }
      
      // Use enhanced breaking change analyzer
      const enhancedBreakingChanges = breakingChangeAnalyzer.analyze(
        parsed,
        packageName,
        fromVersion,
        toVersion,
        { publicEntryHints }
      );
      
      // Convert to legacy format for backward compatibility
      const legacyBreakingChanges = enhancedBreakingChanges.map(change => change.text);

      return {
        success: true,
        diff: parsed,
        source: 'npm-diff',
        raw: result.output,
        breakingChanges: enhancedBreakingChanges.length > 0 ? enhancedBreakingChanges : undefined,
        legacyBreakingChanges: legacyBreakingChanges.length > 0 ? legacyBreakingChanges : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('npm diff failed:', error);
      
      const fallbackResult = await fallbackToDirect(packageName, fromVersion, toVersion);
      return {
        success: false,
        error: errorMessage,
        fallback: fallbackResult,
      };
    }
  },
});

// Helper functions
async function executeNpmDiff(
  spec1: string,
  spec2: string
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['diff', '--diff', spec1, '--diff', spec2]);

    let output = '';
    let error = '';

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      error += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0 || output.length > 0) {
        resolve({ success: true, output });
      } else {
        console.warn('npm diff stderr:', error);
        resolve({ success: false, output: error });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, output: err.message });
    });

    // タイムアウト設定 (30秒)
    setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ success: false, output: 'Timeout: npm diff took too long' });
    }, 30000);
  });
}

export function parseDiff(rawDiff: string): z.infer<typeof diffChangeSchema>[] {
  const changes: z.infer<typeof diffChangeSchema>[] = [];
  const lines = rawDiff.split('\n');

  let currentFile = '';
  let additions = 0;
  let deletions = 0;
  let content = '';

  for (const line of lines) {
    // ファイルヘッダー検出
    if (line.startsWith('diff --git')) {
      if (currentFile) {
        changes.push({
          file: currentFile,
          type: determineChangeType(additions, deletions),
          additions,
          deletions,
          content: content.trim() || undefined,
        });
      }

      // 新しいファイルの処理開始
      const match = line.match(/b\/(.+)$/);
      currentFile = match ? match[1] : '';
      additions = 0;
      deletions = 0;
      content = '';
    }

    // 追加行
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
      content += line + '\n';
    }

    // 削除行
    if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
      content += line + '\n';
    }
  }

  // 最後のファイルを追加
  if (currentFile) {
    changes.push({
      file: currentFile,
      type: determineChangeType(additions, deletions),
      additions,
      deletions,
      content: content.trim() || undefined,
    });
  }

  return changes;
}

function determineChangeType(
  additions: number,
  deletions: number
): 'added' | 'removed' | 'modified' {
  if (additions > 0 && deletions === 0) return 'added';
  if (deletions > 0 && additions === 0) return 'removed';
  return 'modified';
}

async function fallbackToDirect(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<z.infer<typeof fallbackResultSchema>> {
  try {
    // package.jsonを直接取得して比較
    const [fromPkg, toPkg] = await Promise.all([
      fetchPackageJson(packageName, fromVersion),
      fetchPackageJson(packageName, toVersion),
    ]);

    // 主要な変更点を抽出
    const changes = {
      dependencies: compareDeps(fromPkg.dependencies, toPkg.dependencies),
      scripts: compareDeps(fromPkg.scripts, toPkg.scripts),
      engines: compareEngines(fromPkg.engines, toPkg.engines),
    };

    return {
      success: true,
      source: 'package-json-compare',
      changes,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
}

async function fetchPackageJson(packageName: string, version: string): Promise<PackageJson> {
  // npm registryから直接取得
  const url = `https://registry.npmjs.org/${packageName}/${version}`;
  const result = await httpGet<PackageJson>(url);

  if (!result.ok || !result.data) {
    // npm view を使用してフォールバック
    return await executeCommand('npm', ['view', `${packageName}@${version}`, '--json']);
  }

  return result.data;
}

async function executeCommand(command: string, args: string[]): Promise<PackageJson> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let output = '';
    let error = '';

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      error += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(output));
        } catch {
          resolve({} as PackageJson);
        }
      } else {
        reject(new Error(error || 'Command failed'));
      }
    });
  });
}

function compareDeps(
  oldDeps: Record<string, string> = {},
  newDeps: Record<string, string> = {}
): z.infer<typeof dependencyComparisonSchema> {
  const added: Record<string, string> = {};
  const removed: Record<string, string> = {};
  const updated: Record<string, { from: string; to: string }> = {};

  // Check for removed and updated
  for (const [name, version] of Object.entries(oldDeps)) {
    if (!(name in newDeps)) {
      removed[name] = version;
    } else if (newDeps[name] !== version) {
      updated[name] = { from: version, to: newDeps[name] };
    }
  }

  // Check for added
  for (const [name, version] of Object.entries(newDeps)) {
    if (!(name in oldDeps)) {
      added[name] = version;
    }
  }

  return { added, removed, updated };
}

function compareEngines(
  oldEngines: Record<string, string> = {},
  newEngines: Record<string, string> = {}
): Record<string, { from: string; to: string }> {
  const updated: Record<string, { from: string; to: string }> = {};

  for (const [name, version] of Object.entries(oldEngines)) {
    if (name in newEngines && newEngines[name] !== version) {
      updated[name] = { from: version, to: newEngines[name] };
    }
  }

  for (const [name, version] of Object.entries(newEngines)) {
    if (!(name in oldEngines)) {
      updated[name] = { from: 'not specified', to: version };
    }
  }

  return updated;
}

// Legacy package.json analysis functions (deprecated)
// These functions are kept for minimal compatibility but are no longer actively used

// Deprecated functions removed - use BreakingChangeAnalyzer instead

// Type exports
export type DiffChange = z.infer<typeof diffChangeSchema>;
export type NpmDiffResult = z.infer<typeof outputSchema>;
