/**
 * Tests for Enhanced Breaking Change Analyzer
 */

import { describe, test, expect } from 'vitest';
import { breakingChangeAnalyzer, type BreakingChange } from '../breaking-change-analyzer.js';

describe('BreakingChangeAnalyzer', () => {
  test('should detect Node.js requirement changes accurately', () => {
    const mockDiff = [
      {
        file: 'package.json',
        type: 'modified' as const,
        additions: 1,
        deletions: 1,
        content: `-    "node": ">=16",\n+    "node": ">=18"`
      }
    ];

    const result = breakingChangeAnalyzer.analyze(
      mockDiff, 
      'p-limit', 
      '6.2.0', 
      '7.0.0'
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      text: 'Node.js requirement raised from >=16 to >=18',
      severity: 'critical',
      source: 'npm-diff',
      category: 'runtime-requirement',
      confidence: 0.95
    });
  });

  test('should not over-detect API additions as breaking changes', () => {
    const mockDiff = [
      {
        file: 'index.js',
        type: 'modified' as const,
        additions: 5,
        deletions: 0,
        content: `+export function newHelperFunction() {\n+  return 'helper';\n+}`
      }
    ];

    const result = breakingChangeAnalyzer.analyze(
      mockDiff,
      'example-lib',
      '1.0.0',
      '1.1.0'
    );

    // Should not detect API additions as breaking changes
    expect(result).toHaveLength(0);
  });

  test('should detect documented breaking changes', () => {
    const mockDiff = [
      {
        file: 'CHANGELOG.md',
        type: 'modified' as const,
        additions: 3,
        deletions: 0,
        content: `+## v7.0.0\n+\n+BREAKING CHANGE: activeCount now increments correctly`
      }
    ];

    const result = breakingChangeAnalyzer.analyze(
      mockDiff,
      'p-limit',
      '6.2.0', 
      '7.0.0'
    );

    // Should detect both documented breaking change and major version change
    expect(result.length).toBeGreaterThanOrEqual(1);
    
    // Find the documented breaking change
    const documentedChange = result.find(change => 
      change.category === 'documented-change' || change.category === 'api-change'
    );
    
    expect(documentedChange).toMatchObject({
      text: 'activeCount now increments correctly',
      severity: 'breaking',
      confidence: expect.any(Number)
    });
  });

  test('should filter out generic major version changes when specific changes exist', () => {
    const mockDiff = [
      {
        file: 'package.json',
        type: 'modified' as const,
        additions: 1,
        deletions: 1,
        content: `-    "node": ">=16",\n+    "node": ">=18"`
      }
    ];

    const result = breakingChangeAnalyzer.analyze(
      mockDiff,
      'p-limit',
      '6.2.0',
      '7.0.0'
    );

    // Should have specific Node.js requirement change, not generic major version bump
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('runtime-requirement');
    expect(result[0].text).toContain('Node.js requirement');
    
    // Should not have generic "potential breaking changes" message
    const hasGenericMessage = result.some(change => 
      change.text.includes('potential breaking changes')
    );
    expect(hasGenericMessage).toBe(false);
  });

  test('should detect multiple types of breaking changes with proper categorization', () => {
    const mockDiff = [
      {
        file: 'package.json',
        type: 'modified' as const,
        additions: 1,
        deletions: 1,
        content: `-    "node": ">=16",\n+    "node": ">=18"`
      },
      {
        file: 'README.md',
        type: 'modified' as const,
        additions: 1,
        deletions: 0,
        content: `+💥 This version requires Node.js 18+`
      }
    ];

    const result = breakingChangeAnalyzer.analyze(
      mockDiff,
      'p-limit',
      '6.2.0',
      '7.0.0'
    );

    // Should have at least one high-confidence runtime requirement change
    const runtimeChange = result.find(change => change.category === 'runtime-requirement');
    expect(runtimeChange).toBeDefined();
    expect(runtimeChange?.confidence).toBeGreaterThan(0.8);
    expect(runtimeChange?.text).toContain('Node.js requirement');
    
    // Should have detected documented breaking change as well
    const documentedChange = result.find(change => 
      change.category === 'documented-change' || change.category === 'api-change'
    );
    expect(documentedChange).toBeDefined();
    
    // Should have at least 2 changes detected
    expect(result.length).toBeGreaterThanOrEqual(2);
    
    // All changes should have reasonable confidence scores
    result.forEach(change => {
      expect(change.confidence).toBeGreaterThan(0.0);
      expect(change.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  test('should handle empty diff gracefully', () => {
    const result = breakingChangeAnalyzer.analyze(
      [],
      'test-package',
      '1.0.0',
      '2.0.0'
    );

    // Should detect major version bump but with low confidence
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('Major version update');
    expect(result[0].confidence).toBe(0.7);
  });

  test('should offset API removals when re-added in same diff (no false removal)', () => {
    const mockDiff = [
      {
        file: 'src/index.js',
        type: 'modified' as const,
        additions: 1,
        deletions: 1,
        content: `-export function foo(a) { return a }\n+export function foo(a) { return a }`,
      },
    ];

    const result = breakingChangeAnalyzer.analyze(
      mockDiff,
      'pkg',
      '1.0.0',
      '1.1.0'
    );

    // No API removal should be reported
    expect(result.some((c) => c.text.includes('API functions or classes removed'))).toBe(false);
  });

  test('should detect function signature changes only when params differ', () => {
    const mockDiff = [
      {
        file: 'src/index.ts',
        type: 'modified' as const,
        additions: 1,
        deletions: 1,
        content: `-export function bar(a: number) {}\n+export function bar(a: number, b: string) {}`,
      },
    ];

    const result = breakingChangeAnalyzer.analyze(
      mockDiff,
      'pkg',
      '1.0.0',
      '2.0.0'
    );

    const sig = result.find((c) => c.text.startsWith('Function signatures changed'));
    expect(sig).toBeDefined();
    expect(sig?.text).toContain('bar');
  });

  test('should ignore changes in test directories', () => {
    const mockDiff = [
      {
        file: 'tests/helpers.js',
        type: 'modified' as const,
        additions: 0,
        deletions: 1,
        content: `-export function onlyForTests() {}`,
      },
    ];

    const result = breakingChangeAnalyzer.analyze(
      mockDiff,
      'pkg',
      '1.0.0',
      '1.1.0'
    );

    expect(result.some((c) => c.category === 'api-change')).toBe(false);
  });
});
