import { describe, it, expect } from 'vitest';
import { generateReport } from './report.js';
import type { AnalysisResult } from '../types/index.js';

describe('Report Generation', () => {
  const sampleAnalysisResult: AnalysisResult = {
    package: {
      name: 'test-package',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    },
    changelogDiff: {
      content: 'Sample changelog',
      source: 'github',
    },
    breakingChanges: [
      {
        line: 'BREAKING: API removed',
        severity: 'breaking',
      },
    ],
    llmSummary: {
      summary: 'This update contains breaking changes',
      language: 'en',
      breakingChanges: ['API removed'],
    },
    apiUsages: [
      {
        file: 'src/test.ts',
        line: 10,
        snippet: 'removedApi()',
        apiName: 'removedApi',
      },
    ],
    riskLevel: 'review',
    recommendation: 'Manual review required',
  };

  it('should generate markdown report', () => {
    const report = generateReport(sampleAnalysisResult, 'markdown');

    expect(report).toContain('# Renovate Safety Analysis Report');
    expect(report).toContain('test-package');
    expect(report).toContain('1.0.0 → 2.0.0');
    expect(report).toContain('🔍');
    expect(report).toContain('REVIEW');
    expect(report).toContain('Breaking Changes Detected');
    expect(report).toContain('src/test.ts:10');
  });

  it('should generate JSON report', () => {
    const report = generateReport(sampleAnalysisResult, 'json');
    const parsed = JSON.parse(report);

    expect(parsed.package.name).toBe('test-package');
    expect(parsed.riskLevel).toBe('review');
    expect(parsed.breakingChanges.total).toBe(1);
    expect(parsed.apiUsages.total).toBe(1);
    expect(parsed.aiAnalysis.summary).toBe('This update contains breaking changes');
  });
});
