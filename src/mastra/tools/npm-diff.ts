import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
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

const outputSchema = z.object({
  success: z.boolean(),
  diff: z.array(diffChangeSchema).optional(),
  source: z.string().optional(),
  raw: z.string().optional(),
  error: z.string().optional(),
  fallback: fallbackResultSchema.optional(),
  breakingChanges: z.array(z.string()).optional(),
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
      const breakingChanges = detectBreakingChanges(parsed);

      return {
        success: true,
        diff: parsed,
        source: 'npm-diff',
        raw: result.output,
        breakingChanges: breakingChanges.length > 0 ? breakingChanges : undefined,
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

export function detectBreakingChanges(
  diff: z.infer<typeof diffChangeSchema>[]
): string[] {
  const breakingPatterns = [
    /BREAKING CHANGE/i,
    /\[BREAKING\]/i,
    /removed/i,
    /deprecated/i,
    /no longer supported/i,
    /drops?\s+support/i,
    /requires?\s+node/i,
    /minimum\s+node/i,
  ];

  const breakingChanges: string[] = [];

  for (const change of diff) {
    // READMEやCHANGELOGの変更をチェック
    if (change.file.match(/readme|changelog/i) && change.content) {
      for (const pattern of breakingPatterns) {
        if (pattern.test(change.content)) {
          breakingChanges.push(`${change.file}: Potential breaking change detected`);
          break; // 同じファイルで複数回検出されるのを防ぐ
        }
      }
    }

    // APIファイルの削除
    if (change.type === 'removed' && change.file.match(/\.(ts|js|d\.ts)$/)) {
      breakingChanges.push(`${change.file}: File removed`);
    }

    // TypeScript定義ファイルの重要な変更
    if (change.file.match(/\.d\.ts$/) && change.content) {
      // 新しいメソッドの追加（API拡張）
      if (/^\+.*?:\s*\(/m.test(change.content)) {
        breakingChanges.push(`${change.file}: New API methods added`);
      }
      // 既存メソッドの削除
      if (/^-.*?:\s*\(/m.test(change.content)) {
        breakingChanges.push(`${change.file}: API methods removed`);
      }
      // 型定義の変更
      if (/^[+-].*?:\s*(string|number|boolean)/m.test(change.content)) {
        breakingChanges.push(`${change.file}: Type definitions changed`);
      }
    }

    // package.jsonでの破壊的変更（詳細分析）
    if (change.file === 'package.json' && change.content) {
      const packageJsonChanges = analyzePackageJsonChanges(change.content);
      breakingChanges.push(...packageJsonChanges);
    }

    // コアファイルの重要な変更
    if (change.file.match(/^(index|main|lib\/index)\.(js|ts)$/) && change.content) {
      // エクスポート形式の変更
      if (/^[+-].*?export/m.test(change.content)) {
        breakingChanges.push(`${change.file}: Export structure changed`);
      }
      // 主要関数の削除
      if (/^-.*?function\s+\w+/m.test(change.content) || /^-.*?const\s+\w+\s*=/m.test(change.content)) {
        breakingChanges.push(`${change.file}: Functions removed or renamed`);
      }
    }
  }

  return breakingChanges;
}

// package.json の詳細な変更分析
function analyzePackageJsonChanges(content: string): string[] {
  const changes: string[] = [];
  
  // Node.js バージョン要件の具体的な変更を検出
  const nodeVersionChange = extractNodeVersionChange(content);
  if (nodeVersionChange) {
    changes.push(nodeVersionChange);
  }
  
  // その他の engines 要件変更
  const engineChanges = extractEngineChanges(content);
  changes.push(...engineChanges);
  
  // メジャーバージョンの変更を検出
  const majorVersionPattern = /"version":\s*"(\d+)\./g;
  const matches: RegExpExecArray[] = [];
  let match;
  while ((match = majorVersionPattern.exec(content)) !== null) {
    matches.push(match);
  }
  if (matches.length >= 2) {
    const oldMajor = matches[0]?.[1];
    const newMajor = matches[1]?.[1];
    if (oldMajor && newMajor && parseInt(newMajor) > parseInt(oldMajor)) {
      changes.push('package.json: Major version bump detected');
    }
  }
  
  // 主要な依存関係の変更
  const dependencyChanges = extractDependencyChanges(content);
  changes.push(...dependencyChanges);
  
  // モジュール形式の変更
  if (/[+-].*?"type":\s*"(module|commonjs)"/m.test(content)) {
    changes.push('package.json: Module type changed (ESM/CommonJS)');
  }
  
  // エントリポイントの変更
  if (/[+-].*?"(main|module|exports)":/m.test(content)) {
    changes.push('package.json: Entry points changed');
  }
  
  return changes;
}

// Node.js バージョン要件の詳細な変更を抽出
function extractNodeVersionChange(content: string): string | null {
  // 変更前後の Node.js バージョンを抽出
  const nodeVersionRegex = /[+-].*?"node":\s*"([^"]+)"/g;
  const matches: { type: string; version: string }[] = [];
  
  let match;
  while ((match = nodeVersionRegex.exec(content)) !== null) {
    const line = match[0];
    const version = match[1];
    const type = line.startsWith('-') ? 'old' : 'new';
    matches.push({ type, version });
  }
  
  if (matches.length >= 2) {
    const oldVersion = matches.find(m => m.type === 'old')?.version;
    const newVersion = matches.find(m => m.type === 'new')?.version;
    
    if (oldVersion && newVersion && oldVersion !== newVersion) {
      // バージョンの数値を比較
      const oldNum = extractVersionNumber(oldVersion);
      const newNum = extractVersionNumber(newVersion);
      
      if (oldNum && newNum && newNum > oldNum) {
        return `package.json: Node.js requirement raised from ${oldVersion} to ${newVersion}`;
      }
    }
  }
  
  return null;
}

// バージョン文字列から数値を抽出（>=18 → 18）
function extractVersionNumber(versionSpec: string): number | null {
  const match = versionSpec.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// その他の engines 要件変更を抽出
function extractEngineChanges(content: string): string[] {
  const changes: string[] = [];
  const engineRegex = /[+-].*?"(npm|pnpm|yarn)":\s*"([^"]+)"/g;
  
  let match;
  while ((match = engineRegex.exec(content)) !== null) {
    const line = match[0];
    const engine = match[1];
    const version = match[2];
    const type = line.startsWith('-') ? 'removed' : 'added';
    
    changes.push(`package.json: ${engine} requirement ${type} (${version})`);
  }
  
  return changes;
}

// 主要な依存関係の変更を検出
function extractDependencyChanges(content: string): string[] {
  const changes: string[] = [];
  
  // 重要なフレームワークやライブラリの変更を検出
  const importantDeps = ['react', 'vue', 'angular', 'typescript', 'webpack', 'vite', 'next', 'nuxt'];
  
  for (const dep of importantDeps) {
    const depRegex = new RegExp(`[+-].*?"${dep}":\\s*"([^"]+)"`, 'g');
    const matches = content.match(depRegex);
    
    if (matches && matches.length >= 2) {
      changes.push(`package.json: Major dependency '${dep}' version changed`);
    }
  }
  
  return changes;
}

// Type exports
export type DiffChange = z.infer<typeof diffChangeSchema>;
export type NpmDiffResult = z.infer<typeof outputSchema>;