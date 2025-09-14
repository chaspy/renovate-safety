import { describe, it, expect } from 'vitest';
import {
  generateEnhancedSourceLinks,
  generateSourceSection,
  buildNpmRegistryUrl,
  buildGitHubUrls,
  buildCompareUrl,
  buildSourceCollection,
  verifySourceAccessibility,
  type BreakingChangeSource,
  type SourceCollection
} from '../source-tracker.js';

describe('Source Tracker', () => {
  describe('generateEnhancedSourceLinks', () => {
    it('should categorize and sort sources by confidence', () => {
      const sources: BreakingChangeSource[] = [
        {
          type: 'npm',
          url: 'https://npmjs.com/package/test',
          status: 'success',
          confidence: 0.9,
          extractedAt: new Date()
        },
        {
          type: 'github-releases',
          url: 'https://github.com/test/test/releases',
          status: 'success',
          confidence: 0.8,
          extractedAt: new Date()
        },
        {
          type: 'github-changelog',
          url: 'https://github.com/test/test/changelog',
          status: 'failed',
          confidence: 0.7,
          extractedAt: new Date()
        }
      ];

      const result = generateEnhancedSourceLinks(sources);

      expect(result).toHaveLength(2); // Only successful sources
      expect(result[0].category).toBe('npm Registry');
      expect(result[0].confidence).toBe(0.9);
      expect(result[1].category).toBe('GitHub Releases');
      expect(result[1].confidence).toBe(0.8);
    });

    it('should handle multiple sources in same category', () => {
      const sources: BreakingChangeSource[] = [
        {
          type: 'npm',
          url: 'https://npmjs.com/package/test',
          status: 'success',
          title: 'npm Registry',
          confidence: 0.9,
          extractedAt: new Date()
        },
        {
          type: 'npm',
          url: 'https://npmjs.com/package/test/v/2.0.0',
          status: 'success',
          title: 'npm v2.0.0',
          confidence: 0.8,
          extractedAt: new Date()
        }
      ];

      const result = generateEnhancedSourceLinks(sources);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('npm Registry');
      expect(result[0].links).toHaveLength(2);
      expect(result[0].confidence).toBeCloseTo(0.85, 6); // Average of 0.9 and 0.8
    });
  });

  describe('generateSourceSection', () => {
    it('should generate markdown section with sources', () => {
      const collection: SourceCollection = {
        packageName: 'test-package',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        sources: [
          {
            type: 'npm',
            url: 'https://npmjs.com/package/test-package',
            status: 'success',
            title: 'npm Registry',
            confidence: 0.9,
            extractedAt: new Date()
          },
          {
            type: 'github-releases',
            url: 'https://github.com/test/test/releases',
            status: 'success',
            title: 'GitHub Releases',
            confidence: 0.8,
            extractedAt: new Date()
          }
        ],
        fallbackSources: []
      };

      const result = generateSourceSection(collection, false);

      expect(result).toContain('#### 📚 Sources');
      expect(result).toContain('**🟢 npm Registry**:');
      expect(result).toContain('[npm Registry](https://npmjs.com/package/test-package)');
      expect(result).toContain('**🟢 GitHub Releases**:');
      expect(result).toContain('[GitHub Releases](https://github.com/test/test/releases)');
    });

    it('should generate Japanese section when requested', () => {
      const collection: SourceCollection = {
        packageName: 'test-package',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        sources: [
          {
            type: 'npm',
            url: 'https://npmjs.com/package/test-package',
            status: 'success',
            confidence: 0.9,
            extractedAt: new Date()
          }
        ],
        fallbackSources: []
      };

      const result = generateSourceSection(collection, true);

      expect(result).toContain('#### 📚 参考資料');
    });

    it('should add low confidence warning', () => {
      const collection: SourceCollection = {
        packageName: 'test-package',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        sources: [
          {
            type: 'github-changelog',
            url: 'https://github.com/test/test/changelog',
            status: 'success',
            confidence: 0.3,
            extractedAt: new Date()
          }
        ],
        fallbackSources: []
      };

      const result = generateSourceSection(collection);

      expect(result).toContain('*Note: Some sources may have lower reliability');
    });

    it('should return empty string for no sources', () => {
      const collection: SourceCollection = {
        packageName: 'test-package',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        sources: [],
        fallbackSources: []
      };

      const result = generateSourceSection(collection);

      expect(result).toBe('');
    });
  });

  describe('buildNpmRegistryUrl', () => {
    it('should build npm registry URL', () => {
      const result = buildNpmRegistryUrl('test-package');

      expect(result.type).toBe('npm');
      expect(result.url).toBe('https://www.npmjs.com/package/test-package');
      expect(result.status).toBe('success');
      expect(result.confidence).toBe(0.9);
      expect(result.title).toBe('test-package on npm');
    });

    it('should build versioned npm registry URL', () => {
      const result = buildNpmRegistryUrl('test-package', '2.0.0');

      expect(result.url).toBe('https://www.npmjs.com/package/test-package/v/2.0.0');
      expect(result.title).toBe('test-package on npm');
    });
  });

  describe('buildGitHubUrls', () => {
    it('should build GitHub URLs from repository URL', () => {
      const result = buildGitHubUrls('test-package', 'https://github.com/test/test');

      expect(result.length).toBeGreaterThan(1);
      
      const releasesSource = result.find(s => s.type === 'github-releases');
      expect(releasesSource).toBeDefined();
      expect(releasesSource!.url).toBe('https://github.com/test/test/releases');
      expect(releasesSource!.confidence).toBe(0.85);

      const changelogSource = result.find(s => s.type === 'github-changelog');
      expect(changelogSource).toBeDefined();
      expect(changelogSource!.status).toBe('partial'); // Need verification
    });

    it('should handle SSH URL format', () => {
      const result = buildGitHubUrls('test-package', 'git@github.com:test/test.git');

      expect(result.length).toBeGreaterThan(0);
      
      const releasesSource = result.find(s => s.type === 'github-releases');
      expect(releasesSource!.url).toBe('https://github.com/test/test/releases');
    });

    it('should return empty array for invalid URL', () => {
      const result = buildGitHubUrls('test-package', 'https://invalid-url.com');

      expect(result).toEqual([]);
    });

    it('should return empty array for no repository URL', () => {
      const result = buildGitHubUrls('test-package');

      expect(result).toEqual([]);
    });
  });

  describe('buildCompareUrl', () => {
    it('should build compare URL for version range', () => {
      const result = buildCompareUrl(
        'https://github.com/test/test',
        '1.0.0',
        '2.0.0'
      );

      expect(result).toBeDefined();
      expect(result!.type).toBe('github-compare');
      expect(result!.url).toBe('https://github.com/test/test/compare/v1.0.0...v2.0.0');
      expect(result!.confidence).toBe(0.8);
      expect(result!.title).toBe('Compare 1.0.0...2.0.0');
    });

    it('should handle versions with v prefix', () => {
      const result = buildCompareUrl(
        'https://github.com/test/test',
        'v1.0.0',
        'v2.0.0'
      );

      expect(result!.url).toBe('https://github.com/test/test/compare/v1.0.0...v2.0.0');
    });

    it('should return null for invalid repository URL', () => {
      const result = buildCompareUrl('invalid-url', '1.0.0', '2.0.0');

      expect(result).toBeNull();
    });
  });

  describe('buildSourceCollection', () => {
    it('should build comprehensive source collection', async () => {
      const result = await buildSourceCollection(
        'test-package',
        '1.0.0',
        '2.0.0',
        'https://github.com/test/test'
      );

      expect(result.packageName).toBe('test-package');
      expect(result.fromVersion).toBe('1.0.0');
      expect(result.toVersion).toBe('2.0.0');
      expect(result.sources.length).toBeGreaterThan(2);

      // Should include npm sources
      const npmSources = result.sources.filter(s => s.type === 'npm');
      expect(npmSources.length).toBe(2);

      // Should include GitHub sources
      const githubSources = result.sources.filter(s => s.type.startsWith('github'));
      expect(githubSources.length).toBeGreaterThan(0);

      // Should be sorted by confidence
      const confidences = result.sources.map(s => s.confidence);
      const sortedConfidences = [...confidences].sort((a, b) => b - a);
      expect(confidences).toEqual(sortedConfidences);

      // Should identify primary source
      expect(result.primarySource).toBeDefined();
      expect(result.primarySource!.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should work without repository URL', async () => {
      const result = await buildSourceCollection(
        'test-package',
        '1.0.0',
        '2.0.0'
      );

      expect(result.sources.length).toBe(2); // Only npm sources
      expect(result.sources.every(s => s.type === 'npm')).toBe(true);
    });
  });

  describe('verifySourceAccessibility', () => {
    it('should verify valid HTTPS URL', async () => {
      const source: BreakingChangeSource = {
        type: 'npm',
        url: 'https://npmjs.com/package/test',
        status: 'success',
        confidence: 0.9,
        extractedAt: new Date()
      };

      const result = await verifySourceAccessibility(source);

      expect(result).toBe(true);
    });

    it('should verify valid HTTP URL', async () => {
      const source: BreakingChangeSource = {
        type: 'npm',
        url: 'http://npmjs.com/package/test',
        status: 'success',
        confidence: 0.9,
        extractedAt: new Date()
      };

      const result = await verifySourceAccessibility(source);

      expect(result).toBe(true);
    });

    it('should reject invalid URL', async () => {
      const source: BreakingChangeSource = {
        type: 'npm',
        url: 'invalid-url',
        status: 'success',
        confidence: 0.9,
        extractedAt: new Date()
      };

      const result = await verifySourceAccessibility(source);

      expect(result).toBe(false);
    });

    it('should reject non-HTTP protocols', async () => {
      const source: BreakingChangeSource = {
        type: 'npm',
        url: 'ftp://example.com/file',
        status: 'success',
        confidence: 0.9,
        extractedAt: new Date()
      };

      const result = await verifySourceAccessibility(source);

      expect(result).toBe(false);
    });
  });
});
