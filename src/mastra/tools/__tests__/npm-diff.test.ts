import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { npmDiffTool, parseDiff, detectBreakingChanges } from '../npm-diff.js';
import type { DiffChange } from '../npm-diff.js';

// Mockの設定
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../../lib/http-client.js', () => ({
  httpGet: vi.fn(),
}));

describe('npm diff Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('npmDiffTool.execute', () => {
    it('should execute npm diff with correct syntax using createTool', async () => {
      const mockStdout = {
        on: vi.fn((event, cb) => {
          if (event === 'data') {
            cb(Buffer.from('diff --git a/package.json b/package.json\n+added line\n-removed line'));
          }
        }),
      };
      const mockStderr = {
        on: vi.fn(),
      };
      const mockChild = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            cb(0);
          }
        }),
        kill: vi.fn(),
      };

      (spawn as any).mockReturnValue(mockChild);

      // createToolのexecuteメソッドを直接呼ぶ
      const result = await npmDiffTool.execute({
        context: {
          packageName: '@types/node',
          fromVersion: '24.0.6',
          toVersion: '24.0.10',
        },
        runtimeContext: undefined as any,
      });

      expect(spawn).toHaveBeenCalledWith('npm', [
        'diff',
        '--diff',
        '@types/node@24.0.6',
        '--diff',
        '@types/node@24.0.10',
      ]);
      expect(result.success).toBe(true);
      expect(result.source).toBe('npm-diff');
      expect(result.diff).toBeDefined();
      expect(result.diff?.length).toBeGreaterThan(0);
    });

    it('should fallback when npm diff fails', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(Buffer.from('npm diff: command failed'));
            }
          }),
        },
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            cb(1);
          }
        }),
        kill: vi.fn(),
      };

      (spawn as any).mockReturnValue(mockChild);

      const { httpGet } = await import('../../../lib/http-client.js');
      (httpGet as any).mockResolvedValue({
        ok: false,
        data: null,
      });

      // npm viewコマンドのモック（フォールバック時）
      (spawn as any).mockImplementationOnce(() => mockChild).mockImplementation(() => ({
        stdout: {
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(
                Buffer.from(
                  JSON.stringify({
                    name: 'invalid-package',
                    version: '1.0.0',
                    dependencies: {},
                  })
                )
              );
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            cb(0);
          }
        }),
      }));

      const result = await npmDiffTool.execute({
        context: {
          packageName: 'invalid-package',
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
        },
        runtimeContext: undefined as any,
      });

      expect(result.success).toBe(false);
      expect(result.fallback).toBeDefined();
    });

    it('should handle timeout correctly', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(Buffer.from('Timeout: npm diff took too long'));
            }
          }),
        },
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            // タイムアウトをシミュレートするため、非ゼロの終了コードを返す
            cb(124); // 124 is commonly used for timeout
          }
        }),
        kill: vi.fn(),
      };

      (spawn as any).mockReturnValue(mockChild);

      const { httpGet } = await import('../../../lib/http-client.js');
      (httpGet as any).mockResolvedValue({
        ok: false,
        data: null,
      });

      const result = await npmDiffTool.execute({
        context: {
          packageName: 'slow-package',
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
        },
        runtimeContext: undefined as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.fallback).toBeDefined();
    });
  });

  describe('parseDiff', () => {
    it('should parse diff output correctly', () => {
      const diffOutput = `diff --git a/package.json b/package.json
index abc123..def456 100644
--- a/package.json
+++ b/package.json
@@ -1,5 +1,5 @@
 {
   "name": "test-package",
-  "version": "1.0.0",
+  "version": "2.0.0",
   "description": "Test package"
 }
diff --git a/README.md b/README.md
index 111..222 100644
--- a/README.md
+++ b/README.md
+# New Feature Added
-# Old Feature Removed`;

      const result = parseDiff(diffOutput);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        file: 'package.json',
        type: 'modified',
        additions: 1,
        deletions: 1,
      });
      expect(result[1]).toMatchObject({
        file: 'README.md',
        type: 'modified',
        additions: 1,
        deletions: 1,
      });
    });

    it('should handle files with only additions', () => {
      const diffOutput = `diff --git a/new-file.js b/new-file.js
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/new-file.js
@@ -0,0 +1,3 @@
+console.log('new file');
+console.log('more code');
+console.log('even more');`;

      const result = parseDiff(diffOutput);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        file: 'new-file.js',
        type: 'added',
        additions: 3,
        deletions: 0,
      });
    });

    it('should handle files with only deletions', () => {
      const diffOutput = `diff --git a/old-file.js b/old-file.js
deleted file mode 100644
index abc123..0000000
--- a/old-file.js
+++ /dev/null
@@ -1,2 +0,0 @@
-console.log('old code');
-console.log('removed');`;

      const result = parseDiff(diffOutput);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        file: 'old-file.js',
        type: 'removed',
        additions: 0,
        deletions: 2,
      });
    });

    it('should handle empty diff', () => {
      const result = parseDiff('');
      expect(result).toEqual([]);
    });
  });

  describe('detectBreakingChanges', () => {
    it('should detect breaking changes in CHANGELOG', () => {
      const diff: DiffChange[] = [
        {
          file: 'CHANGELOG.md',
          type: 'modified',
          additions: 10,
          deletions: 5,
          content: 'BREAKING CHANGE: API has been completely redesigned',
        },
      ];

      const breaking = detectBreakingChanges(diff);
      expect(breaking).toHaveLength(1);
      expect(breaking[0]).toContain('CHANGELOG.md');
      expect(breaking[0]).toContain('breaking change');
    });

    it('should detect removed API files', () => {
      const diff: DiffChange[] = [
        {
          file: 'lib/api.js',
          type: 'removed',
          additions: 0,
          deletions: 100,
        },
      ];

      const breaking = detectBreakingChanges(diff);
      expect(breaking).toHaveLength(1);
      expect(breaking[0]).toContain('lib/api.js');
      expect(breaking[0]).toContain('File removed');
    });

    it('should detect deprecated features', () => {
      const diff: DiffChange[] = [
        {
          file: 'README.md',
          type: 'modified',
          additions: 5,
          deletions: 3,
          content: 'This feature is now deprecated and will be removed in v3',
        },
      ];

      const breaking = detectBreakingChanges(diff);
      expect(breaking).toHaveLength(1);
      expect(breaking[0]).toContain('README.md');
    });

    it('should detect major version bumps in package.json', () => {
      const diff: DiffChange[] = [
        {
          file: 'package.json',
          type: 'modified',
          additions: 1,
          deletions: 1,
          content: '-  "version": "1.5.0",\n+  "version": "2.0.0",',
        },
      ];

      const breaking = detectBreakingChanges(diff);
      expect(breaking).toHaveLength(1);
      expect(breaking[0]).toContain('Major version bump');
    });

    it('should detect engine requirement changes', () => {
      const diff: DiffChange[] = [
        {
          file: 'package.json',
          type: 'modified',
          additions: 1,
          deletions: 1,
          content: '  "engines": {\n-    "node": ">=14"\n+    "node": ">=16"\n  }',
        },
      ];

      const breaking = detectBreakingChanges(diff);
      expect(breaking).toHaveLength(1);
      expect(breaking[0]).toContain('Engine requirements changed');
    });

    it('should not detect breaking changes when there are none', () => {
      const diff: DiffChange[] = [
        {
          file: 'utils.js',
          type: 'modified',
          additions: 5,
          deletions: 3,
          content: '+ // Added a helpful comment\n- // Old comment',
        },
      ];

      const breaking = detectBreakingChanges(diff);
      expect(breaking).toHaveLength(0);
    });

    it('should handle multiple breaking changes', () => {
      const diff: DiffChange[] = [
        {
          file: 'CHANGELOG.md',
          type: 'modified',
          additions: 10,
          deletions: 5,
          content: '[BREAKING] Changed API',
        },
        {
          file: 'api/v1.js',
          type: 'removed',
          additions: 0,
          deletions: 50,
        },
        {
          file: 'README.md',
          type: 'modified',
          additions: 5,
          deletions: 2,
          content: 'Feature removed from library',
        },
      ];

      const breaking = detectBreakingChanges(diff);
      expect(breaking).toHaveLength(3);
    });
  });
});