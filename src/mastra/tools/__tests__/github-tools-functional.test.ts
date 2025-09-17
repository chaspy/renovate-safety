import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuntimeContext } from '@mastra/core/runtime-context';

// Mock dependencies before importing the modules
vi.mock('../../../lib/secure-exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/secure-exec.js')>('../../../lib/secure-exec.js');
  return {
    ...actual,
    secureSystemExec: vi.fn(),
  };
});

vi.mock('../../../lib/env-config.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/env-config.js')>('../../../lib/env-config.js');
  return {
    ...actual,
    getEnvironmentConfig: vi.fn(),
  };
});

vi.mock('@octokit/rest', () => {
  const MockedOctokit = vi.fn().mockImplementation(() => ({
    request: vi.fn(),
    repos: {
      compareCommits: vi.fn(),
    },
    pulls: {
      get: vi.fn(),
    },
    issues: {
      listLabelsOnIssue: vi.fn(),
      addLabels: vi.fn(),
      removeLabel: vi.fn(),
    },
  }));
  return { Octokit: MockedOctokit };
});

vi.mock('../../../lib/safe-json.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/safe-json.js')>('../../../lib/safe-json.js');
  return {
    ...actual,
    safeJsonParse: vi.fn(),
  };
});

// Mock fs operations for pr-comment tests
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import { getPRInfoTool, githubCompareTool, prCommentTool, prLabelTool, dependencyReviewTool } from '../index.js';
import { secureSystemExec } from '../../../lib/secure-exec.js';
import { getEnvironmentConfig } from '../../../lib/env-config.js';
import { Octokit } from '@octokit/rest';
import { safeJsonParse } from '../../../lib/safe-json.js';

const mockSecureSystemExec = vi.mocked(secureSystemExec);
const mockGetEnvironmentConfig = vi.mocked(getEnvironmentConfig);
const mockOctokitClass = vi.mocked(Octokit);
const mockSafeJsonParse = vi.mocked(safeJsonParse);

const mockOctokit = {
  request: vi.fn(),
  repos: {
    compareCommits: vi.fn(),
  },
  pulls: {
    get: vi.fn(),
  },
  issues: {
    listLabelsOnIssue: vi.fn(),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  mockGetEnvironmentConfig.mockReturnValue({
    githubToken: 'test-token',
    language: 'en' as const,
    debug: false,
    verbose: false,
  });

  mockOctokitClass.mockReturnValue(mockOctokit as any);
});

describe('GitHub Tools - Functional Tests', () => {
  describe('getPRInfoTool', () => {
    it('should extract PR information using gh CLI', async () => {
      const mockPRData = {
        number: 123,
        title: 'Update dependency @types/node to v24.0.7',
        body: 'Renovate update',
        baseRefName: 'main',
        headRefName: 'renovate/node-24.x',
        state: 'open',
        author: { login: 'renovate[bot]' },
      };

      mockSecureSystemExec.mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockPRData),
        stderr: '',
        failed: false,
      });

      mockSafeJsonParse.mockReturnValue(mockPRData);

      const result = await getPRInfoTool.execute({ 
        context: { 
          prNumber: 123,
          includeBaseRepository: false 
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.data?.number).toBe(123);
      expect(result.data?.title).toBe('Update dependency @types/node to v24.0.7');
      expect(result.data?.base).toBe('main');
      expect(result.data?.head).toBe('renovate/node-24.x');
      expect(result.data?.state).toBe('open');
      expect(result.data?.author).toBe('renovate[bot]');
      
      // gh CLI呼び出しを確認
      expect(mockSecureSystemExec).toHaveBeenCalledWith('gh', [
        'pr',
        'view',
        '123',
        '--json',
        expect.stringContaining('number,title,body'),
      ]);
    });

    it('should fallback to Octokit when gh CLI fails', async () => {
      mockSecureSystemExec
        .mockResolvedValueOnce({
          success: false,
          error: 'gh not found',
          stdout: '',
          stderr: 'gh not found',
          failed: true,
        })
        .mockResolvedValueOnce({
          success: true,
          stdout: 'https://github.com/owner/repo.git',
          stderr: '',
          failed: false,
        });

      mockOctokit.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          title: 'Update dependency',
          body: 'Test PR body',
          base: { ref: 'main' },
          head: { ref: 'feature-branch' },
          state: 'open',
          user: { login: 'test-user' },
        },
      });

      const result = await getPRInfoTool.execute({ 
        context: { 
          prNumber: 123,
          includeBaseRepository: false 
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.data?.number).toBe(123);
      expect(result.data?.title).toBe('Update dependency');
      expect(result.data?.base).toBe('main');
      expect(result.data?.head).toBe('feature-branch');
      
      // Octokitフォールバックを確認
      expect(mockOctokit.pulls.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
      });
    });

    it('should handle authentication errors', async () => {
      mockGetEnvironmentConfig.mockReturnValue({
        githubToken: '',
        language: 'en' as const,
        debug: false,
        verbose: false,
      });

      mockSecureSystemExec.mockResolvedValue({
        success: false,
        error: 'gh not authenticated',
        stdout: '',
        stderr: 'gh not authenticated',
        failed: true,
      });

      const result = await getPRInfoTool.execute({ 
        context: { 
          prNumber: 123,
          includeBaseRepository: false 
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub CLI failed and no GitHub token available');
    });
  });

  describe('githubCompareTool', () => {
    it('should detect lockfile-only changes', async () => {
      mockOctokit.repos.compareCommits.mockResolvedValue({
        data: {
          files: [
            {
              filename: 'package-lock.json',
              status: 'modified',
              additions: 10,
              deletions: 5,
              changes: 15,
              patch: 'diff content here',
            },
          ],
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
        },
      });

      const result = await githubCompareTool.execute({
        context: {
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'main',
          head: 'feature',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.data?.isLockfileOnly).toBe(true);
      expect(result.data?.lockfileCount).toBe(1);
      expect(result.data?.sourceFileCount).toBe(0);
      expect(result.data?.totalFiles).toBe(1);
      expect(result.data?.files[0].isLockfile).toBe(true);
      expect(result.data?.commits.ahead).toBe(1);
      expect(result.data?.commits.total).toBe(1);
    });

    it('should detect mixed changes (source + lockfile)', async () => {
      mockOctokit.repos.compareCommits.mockResolvedValue({
        data: {
          files: [
            {
              filename: 'package-lock.json',
              status: 'modified',
              additions: 10,
              deletions: 5,
              changes: 15,
            },
            {
              filename: 'src/index.ts',
              status: 'modified',
              additions: 2,
              deletions: 1,
              changes: 3,
            },
          ],
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
        },
      });

      const result = await githubCompareTool.execute({
        context: {
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'main',
          head: 'feature',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.data?.isLockfileOnly).toBe(false);
      expect(result.data?.lockfileCount).toBe(1);
      expect(result.data?.sourceFileCount).toBe(1);
      expect(result.data?.files).toHaveLength(2);
      
      // ファイル分類の確認
      const lockfile = result.data?.files.find(f => f.isLockfile);
      const sourceFile = result.data?.files.find(f => !f.isLockfile);
      expect(lockfile?.filename).toBe('package-lock.json');
      expect(sourceFile?.filename).toBe('src/index.ts');
    });

    it('should handle API errors gracefully', async () => {
      mockOctokit.repos.compareCommits.mockRejectedValue(
        Object.assign(new Error('API Rate limit exceeded'), { status: 403 })
      );

      const result = await githubCompareTool.execute({
        context: {
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'main',
          head: 'feature',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('API Rate limit exceeded');
      expect(result.status).toBe(403);
    });
  });

  describe('prCommentTool', () => {
    it('should create new comment', async () => {
      // モック：既存コメントチェックで見つからない
      mockSecureSystemExec
        .mockResolvedValueOnce({
          success: true,
          stdout: '', // 既存コメントなし
          stderr: '',
          failed: false,
        })
        .mockResolvedValueOnce({
          success: true,
          stdout: 'Comment created',
          stderr: '',
          failed: false,
        });

      const result = await prCommentTool.execute({
        context: {
          prNumber: 123,
          body: 'Test comment\n\nGenerated by [renovate-safety]',
          mode: 'create' as const,
          marker: 'Generated by [renovate-safety]',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      
      // gh CLIコマンド呼び出し確認
      expect(mockSecureSystemExec).toHaveBeenCalledWith('gh', [
        'pr',
        'comment',
        '123',
        '--body-file',
        expect.stringContaining('renovate-safety-report-'),
      ]);
    });

    it('should check for existing comments', async () => {
      mockSecureSystemExec.mockResolvedValue({
        success: true,
        stdout: '12345\n67890', // 複数の既存コメント
        stderr: '',
        failed: false,
      });

      const result = await prCommentTool.execute({
        context: {
          prNumber: 123,
          body: 'Test comment',
          mode: 'check' as const,
          marker: 'Generated by [renovate-safety]',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.exists).toBe(true);
      expect(result.commentId).toBe(12345);
      expect(result.totalMatches).toBe(2);
    });

    it('should update existing comment', async () => {
      mockSecureSystemExec
        .mockResolvedValueOnce({
          success: true,
          stdout: '12345', // 既存コメント発見
          stderr: '',
          failed: false,
        })
        .mockResolvedValueOnce({
          success: true,
          stdout: 'Comment updated',
          stderr: '',
          failed: false,
        });

      const result = await prCommentTool.execute({
        context: {
          prNumber: 123,
          body: 'Updated comment\n\nGenerated by [renovate-safety]',
          mode: 'update' as const,
          marker: 'Generated by [renovate-safety]',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.updated).toBe(true);
      expect(result.commentId).toBe(12345);
      
      // API呼び出し確認
      expect(mockSecureSystemExec).toHaveBeenCalledWith('gh', [
        'api',
        expect.stringContaining('/issues/comments/12345'),
        '-X',
        'PATCH',
        '-F',
        expect.stringContaining('body=@'),
      ]);
    });
  });

  describe('prLabelTool', () => {
    it('should add labels to PR', async () => {
      mockSecureSystemExec.mockResolvedValue({
        success: true,
        stdout: 'https://github.com/owner/repo.git',
        stderr: '',
        failed: false,
      });

      mockOctokit.issues.listLabelsOnIssue
        .mockResolvedValueOnce({
          data: [
            { name: 'existing-label' },
          ],
        })
        .mockResolvedValueOnce({
          data: [
            { name: 'existing-label' },
            { name: 'new-label' },
          ],
        });

      mockOctokit.issues.addLabels.mockResolvedValue({
        data: [
          { name: 'existing-label' },
          { name: 'new-label' },
        ],
      });

      const result = await prLabelTool.execute({
        context: {
          prNumber: 123,
          labels: ['new-label'],
          operation: 'add' as const,
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('add');
      expect(result.labelsAdded).toContain('new-label');
      expect(result.currentLabels).toEqual(['existing-label', 'new-label']);
      
      // API呼び出し確認
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 123,
        labels: ['new-label'],
      });
    });

    it('should replace labels with prefix removal', async () => {
      mockSecureSystemExec.mockResolvedValue({
        success: true,
        stdout: 'https://github.com/owner/repo.git',
        stderr: '',
        failed: false,
      });

      mockOctokit.issues.listLabelsOnIssue
        .mockResolvedValueOnce({
          data: [
            { name: 'renovate-safety:high' },
            { name: 'renovate-safety:breaking' },
            { name: 'other-label' },
          ],
        })
        .mockResolvedValueOnce({
          data: [
            { name: 'other-label' },
            { name: 'renovate-safety:safe' },
          ],
        });

      mockOctokit.issues.removeLabel.mockResolvedValue({ data: {} });
      mockOctokit.issues.addLabels.mockResolvedValue({ data: [] });

      const result = await prLabelTool.execute({
        context: {
          prNumber: 123,
          labels: ['renovate-safety:safe'],
          removePrefix: 'renovate-safety:',
          operation: 'replace' as const,
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('replace');
      expect(result.labelsRemoved).toEqual(['renovate-safety:high', 'renovate-safety:breaking']);
      
      // 既存ラベル削除確認
      expect(mockOctokit.issues.removeLabel).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo', 
        issue_number: 123,
        name: 'renovate-safety:high',
      });
    });
  });

  describe('githubCompareTool', () => {
    it('should categorize different lockfile types', async () => {
      mockOctokit.repos.compareCommits.mockResolvedValue({
        data: {
          files: [
            { filename: 'package-lock.json', status: 'modified', additions: 10, deletions: 5, changes: 15 },
            { filename: 'yarn.lock', status: 'modified', additions: 8, deletions: 3, changes: 11 },
            { filename: 'Cargo.lock', status: 'added', additions: 20, deletions: 0, changes: 20 },
            { filename: 'poetry.lock', status: 'modified', additions: 5, deletions: 2, changes: 7 },
          ],
          ahead_by: 2,
          behind_by: 0, 
          total_commits: 2,
        },
      });

      const result = await githubCompareTool.execute({
        context: {
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'main',
          head: 'feature',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.data?.isLockfileOnly).toBe(true);
      expect(result.data?.lockfileCount).toBe(4);
      expect(result.data?.sourceFileCount).toBe(0);
      
      // すべてのファイルがlockfileとして認識される
      const allLockfiles = result.data?.files.every(f => f.isLockfile);
      expect(allLockfiles).toBe(true);
    });
  });

  describe('dependencyReviewTool', () => {
    it('should get dependency changes from GitHub API', async () => {
      const mockDependencyData = [
        {
          name: '@types/node',
          version_before: '24.0.6',
          version_after: '24.0.7', 
          change_type: 'updated',
          manifest: 'package.json',
          scope: 'runtime',
          vulnerabilities: [],
          ecosystem: 'npm',
          package_url: null,
          license: null,
          source_repository_url: null,
        },
        {
          name: 'typescript',
          version: '5.0.0',
          change_type: 'added',
          manifest: 'package.json',
          scope: 'development',
          vulnerabilities: [],
          ecosystem: 'npm', 
          package_url: null,
          license: null,
          source_repository_url: null,
        },
      ];

      mockOctokit.request.mockResolvedValue({
        data: mockDependencyData,
      });

      const result = await dependencyReviewTool.execute({
        context: {
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'main',
          head: 'feature',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.totalChanges).toBe(2);
      
      // 更新されたパッケージ
      const updatedPkg = result.data?.[0];
      expect(updatedPkg?.name).toBe('@types/node');
      expect(updatedPkg?.fromVersion).toBe('24.0.6');
      expect(updatedPkg?.toVersion).toBe('24.0.7');
      expect(updatedPkg?.changeType).toBe('updated');
      
      // 追加されたパッケージ
      const addedPkg = result.data?.[1];
      expect(addedPkg?.name).toBe('typescript');
      expect(addedPkg?.toVersion).toBe('5.0.0');
      expect(addedPkg?.changeType).toBe('added');
      
      // GitHub API呼び出し確認
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}',
        {
          owner: 'test-owner',
          repo: 'test-repo',
          basehead: 'main...feature',
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
    });

    it('should handle 404 dependency graph not available', async () => {
      const error404 = Object.assign(new Error('Not Found'), { status: 404 });
      mockOctokit.request.mockRejectedValue(error404);

      const result = await dependencyReviewTool.execute({
        context: {
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'main',
          head: 'feature',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dependency graph not available for this repository');
      expect(result.fallback).toBe('Repository may not have dependency graph enabled or is private');
    });

    it('should handle missing authentication', async () => {
      mockGetEnvironmentConfig.mockReturnValue({
        githubToken: '',
        language: 'en' as const,
        debug: false,
        verbose: false,
      });

      const result = await dependencyReviewTool.execute({
        context: {
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'main', 
          head: 'feature',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No GitHub authentication available');
      expect(result.fallback).toBe('Use package.json diff as fallback');
    });
  });

  describe('Error Handling', () => {
    it('should handle gh CLI not found error', async () => {
      mockSecureSystemExec.mockResolvedValue({
        success: false,
        error: 'gh: command not found',
        stdout: '',
        stderr: 'gh: command not found',
        failed: true,
      });

      const result = await prCommentTool.execute({
        context: {
          prNumber: 123,
          body: 'Test comment',
          mode: 'create' as const,
          marker: 'Generated by [renovate-safety]',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('gh: command not found');
    });

    it('should handle authentication errors', async () => {
      mockSecureSystemExec.mockResolvedValue({
        success: false,
        error: 'not authenticated with GitHub',
        stdout: '',
        stderr: 'not authenticated with GitHub',
        failed: true,
      });

      const result = await prCommentTool.execute({
        context: {
          prNumber: 123,
          body: 'Test comment',
          mode: 'create' as const,
          marker: 'Generated by [renovate-safety]',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('not authenticated with GitHub');
    });

    it('should handle PR not found error', async () => {
      mockSecureSystemExec.mockResolvedValue({
        success: false,
        error: 'HTTP 404: Not Found (gh api)',
        stdout: '',
        stderr: 'HTTP 404: Not Found (gh api)',
        failed: true,
      });

      const result = await prCommentTool.execute({
        context: {
          prNumber: 999,
          body: 'Test comment',
          mode: 'create' as const,
          marker: 'Generated by [renovate-safety]',
        },
        runtimeContext: new RuntimeContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 404: Not Found (gh api)');
    });
  });
});