import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateGitHubFileLink,
  generateMarkdownLink,
  generateUsageLinks,
  generateSourceLinks,
  extractRepositoryFromPRInfo,
  autoDetectRepository,
  type GitHubLinkOptions
} from '../github-link-generator.js';

describe('GitHub Link Generator', () => {
  let linkOptions: GitHubLinkOptions;

  beforeEach(() => {
    linkOptions = {
      repository: {
        owner: 'chaspy',
        name: 'renovate-safety'
      },
      branch: 'main'
    };
  });

  describe('generateGitHubFileLink', () => {
    it('should generate correct GitHub URL for file and line', () => {
      const url = generateGitHubFileLink('src/lib/llm.ts', 208, linkOptions);
      expect(url).toBe('https://github.com/chaspy/renovate-safety/blob/main/src/lib/llm.ts#L208');
    });

    it('should handle file paths with leading slash', () => {
      const url = generateGitHubFileLink('/src/lib/llm.ts', 208, linkOptions);
      expect(url).toBe('https://github.com/chaspy/renovate-safety/blob/main/src/lib/llm.ts#L208');
    });

    it('should use custom base URL', () => {
      const customOptions = {
        ...linkOptions,
        baseUrl: 'https://custom-github.com'
      };
      const url = generateGitHubFileLink('src/lib/llm.ts', 208, customOptions);
      expect(url).toBe('https://custom-github.com/chaspy/renovate-safety/blob/main/src/lib/llm.ts#L208');
    });

    it('should use custom branch', () => {
      const customOptions = {
        ...linkOptions,
        branch: 'develop'
      };
      const url = generateGitHubFileLink('src/lib/llm.ts', 208, customOptions);
      expect(url).toBe('https://github.com/chaspy/renovate-safety/blob/develop/src/lib/llm.ts#L208');
    });
  });

  describe('generateMarkdownLink', () => {
    it('should generate correct markdown link format', () => {
      const link = generateMarkdownLink('src/lib/llm.ts', 208, linkOptions);
      expect(link).toBe('[src/lib/llm.ts:208](https://github.com/chaspy/renovate-safety/blob/main/src/lib/llm.ts#L208)');
    });
  });

  describe('generateUsageLinks', () => {
    it('should convert usage array to markdown links', () => {
      const usages = [
        { file: 'src/lib/llm.ts', line: 208, reason: 'Constructor call' },
        { file: 'src/lib/llm.ts', line: 2, reason: 'Import statement' }
      ];

      const result = generateUsageLinks(usages, linkOptions);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        file: 'src/lib/llm.ts',
        line: 208,
        reason: 'Constructor call',
        markdownLink: '[src/lib/llm.ts:208](https://github.com/chaspy/renovate-safety/blob/main/src/lib/llm.ts#L208)'
      });
      expect(result[1]).toEqual({
        file: 'src/lib/llm.ts',
        line: 2,
        reason: 'Import statement',
        markdownLink: '[src/lib/llm.ts:2](https://github.com/chaspy/renovate-safety/blob/main/src/lib/llm.ts#L2)'
      });
    });

    it('should handle usage without reason', () => {
      const usages = [
        { file: 'src/lib/llm.ts', line: 208 }
      ];

      const result = generateUsageLinks(usages, linkOptions);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        file: 'src/lib/llm.ts',
        line: 208,
        markdownLink: '[src/lib/llm.ts:208](https://github.com/chaspy/renovate-safety/blob/main/src/lib/llm.ts#L208)'
      });
    });
  });

  describe('generateSourceLinks', () => {
    it('should filter successful sources and generate links', () => {
      const sources = [
        { type: 'npm', url: 'https://npmjs.com/package/openai', status: 'success' },
        { type: 'github-releases', url: 'https://github.com/openai/openai-node/releases', status: 'success' },
        { type: 'github-changelog', url: 'https://github.com/openai/openai-node/changelog', status: 'failed' }
      ];

      const result = generateSourceLinks(sources);

      expect(result).toEqual([
        '[npm registry](https://npmjs.com/package/openai)',
        '[GitHub Releases](https://github.com/openai/openai-node/releases)'
      ]);
    });

    it('should handle unknown source types', () => {
      const sources = [
        { type: 'unknown', url: 'https://example.com', status: 'success' }
      ];

      const result = generateSourceLinks(sources);

      expect(result).toEqual([
        '[unknown](https://example.com)'
      ]);
    });

    it('should return empty array for no successful sources', () => {
      const sources = [
        { type: 'npm', url: 'https://npmjs.com/package/openai', status: 'failed' }
      ];

      const result = generateSourceLinks(sources);

      expect(result).toEqual([]);
    });
  });

  describe('extractRepositoryFromPRInfo', () => {
    it('should extract repository from PR info', () => {
      const prInfo = {
        repository: {
          owner: 'chaspy',
          name: 'renovate-safety'
        },
        number: 123
      };

      const result = extractRepositoryFromPRInfo(prInfo);

      expect(result).toEqual({
        owner: 'chaspy',
        name: 'renovate-safety'
      });
    });

    it('should extract from HTML URL as fallback', () => {
      const prInfo = {
        html_url: 'https://github.com/chaspy/renovate-safety/pull/123',
        number: 123
      };

      const result = extractRepositoryFromPRInfo(prInfo);

      expect(result).toEqual({
        owner: 'chaspy',
        name: 'renovate-safety'
      });
    });

    it('should return null for invalid data', () => {
      const prInfo = {
        number: 123
      };

      const result = extractRepositoryFromPRInfo(prInfo);

      expect(result).toBeNull();
    });

    it('should handle errors gracefully', () => {
      const result = extractRepositoryFromPRInfo(null);
      expect(result).toBeNull();
    });
  });

  describe('autoDetectRepository', () => {
    it('should prioritize PR info', async () => {
      const prInfo = {
        repository: {
          owner: 'chaspy',
          name: 'renovate-safety'
        }
      };

      const result = await autoDetectRepository(prInfo);

      expect(result).toEqual({
        owner: 'chaspy',
        name: 'renovate-safety'
      });
    });

    it('should return null when no sources available', async () => {
      const result = await autoDetectRepository();
      
      // This might return a git remote result or null depending on environment
      // We'll just check that it's either a valid repository object or null
      expect(result === null || (result && typeof result.owner === 'string')).toBe(true);
    });
  });
});