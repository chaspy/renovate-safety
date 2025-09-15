/**
 * Tests for Usage Impact Analyzer
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { UsageImpactAnalyzer } from '../usage-impact-analyzer.js';

// Mock modules
vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}));

vi.mock('glob', () => ({
  glob: vi.fn()
}));

import * as fs from 'fs/promises';
import { glob } from 'glob';

const mockReadFile = vi.mocked(fs.readFile);
const mockGlob = vi.mocked(glob);

describe('UsageImpactAnalyzer', () => {
  let analyzer: UsageImpactAnalyzer;

  beforeEach(() => {
    analyzer = new UsageImpactAnalyzer();
    mockGlob.mockReset();
    mockReadFile.mockReset();
  });

  test('should detect p-limit activeCount usage correctly', async () => {
    // Mock file system
    const mockFiles = ['/project/src/worker.ts'];
    const mockFileContent = `
import pLimit from 'p-limit';

const limit = pLimit(3);
console.log('Active tasks:', limit.activeCount);
`;

    mockGlob.mockResolvedValue(mockFiles);
    mockReadFile.mockResolvedValue(mockFileContent);

    const breakingChanges = [
      { text: 'activeCount now increments correctly', category: 'api-change' }
    ];

    const result = await analyzer.analyzeImpact('p-limit', breakingChanges, '/project');

    expect(result.isAffected).toBe(true);
    expect(result.riskLevel).toBe('high');
    expect(result.affectedFiles).toContain('/project/src/worker.ts');
    expect(result.affectedPatterns).toContain('Uses activeCount property');
    expect(result.recommendations).toContain('⚠️ Your code uses activeCount - verify behavior change in v7.0.0');
  });

  test('should return no impact when package is not used', async () => {
    // Mock file system
    const mockFiles = ['/project/src/app.ts'];
    const mockFileContent = `
import express from 'express';

const app = express();
app.listen(3000);
`;

    mockGlob.mockResolvedValue(mockFiles);
    mockReadFile.mockResolvedValue(mockFileContent);

    const breakingChanges = [
      { text: 'activeCount behavior changed', category: 'api-change' }
    ];

    const result = await analyzer.analyzeImpact('p-limit', breakingChanges, '/project');

    expect(result.isAffected).toBe(false);
    expect(result.riskLevel).toBe('none');
    expect(result.affectedFiles).toHaveLength(0);
    expect(result.recommendations).toContain('No specific usage patterns detected that would be affected by p-limit changes');
  });

  test('should detect React deprecated lifecycle methods', async () => {
    // Mock file system
    const mockFiles = ['/project/src/Component.tsx'];
    const mockFileContent = `
import React from 'react';

class MyComponent extends React.Component {
  componentWillMount() {
    console.log('deprecated');
  }
  
  render() {
    return <div>Hello</div>;
  }
}
`;

    mockGlob.mockResolvedValue(mockFiles);
    mockReadFile.mockResolvedValue(mockFileContent);

    const breakingChanges = [
      { text: 'Deprecated lifecycle methods removed', category: 'api-change' }
    ];

    const result = await analyzer.analyzeImpact('react', breakingChanges, '/project');

    expect(result.isAffected).toBe(true);
    expect(result.riskLevel).toBe('high');
    expect(result.affectedPatterns).toContain('Uses deprecated lifecycle methods');
  });

  test('should calculate confidence based on pattern coverage', async () => {
    // Mock file system with multiple patterns
    const mockFiles = ['/project/src/test.ts'];
    const mockFileContent = `
import pLimit from 'p-limit';

const limit = pLimit(5);
console.log('Active:', limit.activeCount);
console.log('Pending:', limit.pendingCount);
`;

    mockGlob.mockResolvedValue(mockFiles);
    mockReadFile.mockResolvedValue(mockFileContent);

    const breakingChanges = [
      { text: 'activeCount behavior changed', category: 'api-change' }
    ];

    const result = await analyzer.analyzeImpact('p-limit', breakingChanges, '/project');

    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.confidence).toBeLessThanOrEqual(0.9);
  });

  test('should handle file read errors gracefully', async () => {
    // Mock file system
    const mockFiles = ['/project/src/broken.ts'];
    
    mockGlob.mockResolvedValue(mockFiles);
    mockReadFile.mockRejectedValue(new Error('Permission denied'));

    const breakingChanges = [
      { text: 'some breaking change', category: 'api-change' }
    ];

    const result = await analyzer.analyzeImpact('test-package', breakingChanges, '/project');

    expect(result.isAffected).toBe(false);
    expect(result.affectedFiles).toHaveLength(0);
  });

  test('should limit file processing for performance', async () => {
    // Mock many files
    const manyFiles = Array.from({ length: 100 }, (_, i) => `/project/file${i}.ts`);
    
    mockGlob.mockResolvedValue(manyFiles);
    mockReadFile.mockResolvedValue('import test from "test-package";');

    const breakingChanges = [
      { text: 'breaking change', category: 'api-change' }
    ];

    const result = await analyzer.analyzeImpact('test-package', breakingChanges, '/project');

    // Should only process up to 50 files as per the implementation
    expect(mockReadFile.mock.calls.length).toBeLessThanOrEqual(50);
    expect(result).toBeDefined();  // Ensure result is used
  });
});