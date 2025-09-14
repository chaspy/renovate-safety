import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeImpact, analyzeUsage } from '../impact-analyzer.js';
import type { TsUsage } from '../../tools/ts-usage-scanner.js';
import type { ConfigUsage } from '../../tools/config-scanner.js';

// Mock the tools
vi.mock('../../tools/ts-usage-scanner.js', () => ({
  tsUsageScannerTool: {
    execute: vi.fn(),
  },
}));

vi.mock('../../tools/config-scanner.js', () => ({
  configScannerTool: {
    execute: vi.fn(),
  },
}));

describe('CodeImpactAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  describe('analyzeImpact', () => {
    it('should find package usages in TypeScript files', () => {
      const mockUsages: TsUsage[] = [
        { 
          file: 'src/index.ts', 
          line: 10, 
          type: 'import',
          specifiers: ['express'],
        },
        { 
          file: 'src/app.ts', 
          line: 25, 
          type: 'function-call',
          code: 'express()',
        },
      ];
      
      const analysis = analyzeImpact(mockUsages, []);
      
      expect(analysis.level).toBe('low');
      expect(analysis.totalCount).toBe(2);
      expect(analysis.byType).toEqual({
        'import': 1,
        'function-call': 1,
      });
    });
    
    it('should identify critical usage paths', () => {
      const mockUsages: Array<TsUsage | ConfigUsage> = [
        { 
          file: 'src/index.ts', 
          line: 1, 
          type: 'import',
        },
        { 
          file: 'src/main.ts', 
          line: 10, 
          type: 'constructor',
          code: 'new App()',
        },
        { 
          file: 'src/base.ts', 
          line: 5, 
          type: 'extends',
          code: 'class MyApp extends BaseApp',
        },
      ];
      
      const analysis = analyzeImpact(mockUsages, []);
      
      expect(analysis.criticalPaths).toHaveLength(3);
      expect(analysis.criticalPaths[0]?.reason).toContain('Entry point');
    });
    
    it('should increase impact score for breaking changes', () => {
      const mockUsages: TsUsage[] = [
        { 
          file: 'src/api.ts', 
          line: 20, 
          type: 'function-call',
          code: 'oldMethod()',
          specifiers: ['oldMethod']
        },
      ];
      
      const analysisWithBreaking = analyzeImpact(mockUsages, ['oldMethod']);
      const analysisWithoutBreaking = analyzeImpact(mockUsages, []);
      
      expect(analysisWithBreaking.score).toBeGreaterThan(analysisWithoutBreaking.score);
      expect(analysisWithBreaking.level).not.toBe('minimal');
    });
    
    it('should handle config file usages', () => {
      const mockUsages: ConfigUsage[] = [
        {
          file: 'package.json',
          line: 10,
          type: 'config',
          content: '"express": "^4.18.0"',
        },
        {
          file: 'webpack.config.js',
          line: 5,
          type: 'config',
          content: 'const express = require("express")',
        },
      ];
      
      const analysis = analyzeImpact(mockUsages, []);
      
      expect(analysis.files).toContain('package.json');
      expect(analysis.files).toContain('webpack.config.js');
      expect(analysis.recommendations).toContainEqual(expect.stringContaining('configuration'));
    });
    
    it('should determine correct impact levels', () => {
      // Minimal impact
      const minimalUsages: TsUsage[] = [
        { file: 'test.ts', line: 1, type: 'import' },
      ];
      expect(analyzeImpact(minimalUsages, []).level).toBe('minimal');
      
      // Low impact
      const lowUsages: TsUsage[] = Array(10).fill(null).map((_, i) => ({
        file: `file${i}.ts`,
        line: i,
        type: 'import' as const,
      }));
      expect(analyzeImpact(lowUsages, []).level).toBe('low');
      
      // Medium impact
      const mediumUsages: TsUsage[] = Array(20).fill(null).map((_, i) => ({
        file: `file${i}.ts`,
        line: i,
        type: i % 2 === 0 ? 'function-call' as const : 'import' as const,
      }));
      expect(analyzeImpact(mediumUsages, []).level).toBe('medium');
      
      // High impact
      const highUsages: Array<TsUsage | ConfigUsage> = [
        ...Array(30).fill(null).map((_, i) => ({
          file: `critical${i}.ts`,
          line: i,
          type: 'constructor' as const,
        })),
        {
          file: 'package.json',
          line: 1,
          type: 'config' as const,
          content: 'version',
        },
      ];
      expect(analyzeImpact(highUsages, []).level).toBe('high');
    });
    
    it('should provide appropriate recommendations', () => {
      // High impact recommendations
      const highImpactUsages = Array(50).fill(null).map((_, i) => ({
        file: `file${i}.ts`,
        line: i,
        type: 'constructor' as const,
      }));
      const highAnalysis = analyzeImpact(highImpactUsages, []);
      expect(highAnalysis.recommendations).toContainEqual(expect.stringContaining('High impact'));
      
      // Low impact recommendations
      const lowImpactUsages: TsUsage[] = [
        { file: 'test.ts', line: 1, type: 'import' },
      ];
      const lowAnalysis = analyzeImpact(lowImpactUsages, []);
      expect(lowAnalysis.recommendations).toContainEqual(expect.stringContaining('Low impact'));
      
      // TypeScript recommendations
      const tsUsages: TsUsage[] = [
        { file: 'types.ts', line: 1, type: 'type-reference' },
      ];
      const tsAnalysis = analyzeImpact(tsUsages, []);
      expect(tsAnalysis.recommendations).toContainEqual(expect.stringContaining('TypeScript'));
    });
  });
  
  describe('analyzeUsage', () => {
    it('should combine code and config usages', () => {
      const codeUsage: TsUsage[] = [
        { file: 'src/app.ts', line: 10, type: 'import' },
      ];
      
      const configUsage: ConfigUsage[] = [
        {
          file: 'package.json',
          line: 5,
          type: 'config',
          content: '"dependency": "1.0.0"',
        },
      ];
      
      const analysis = analyzeUsage({
        codeUsage,
        configUsage,
        breakingChanges: [],
      });
      
      expect(analysis.totalCount).toBe(2);
      expect(analysis.files).toHaveLength(2);
      expect(analysis.byType).toEqual({
        'import': 1,
        'config': 1,
      });
    });
    
    it('should handle empty usages', () => {
      const analysis = analyzeUsage({
        codeUsage: [],
        configUsage: [],
        breakingChanges: [],
      });
      
      expect(analysis.totalCount).toBe(0);
      expect(analysis.level).toBe('minimal');
      expect(analysis.files).toHaveLength(0);
    });
    
    it('should detect breaking changes in combined usages', () => {
      const codeUsage: TsUsage[] = [
        {
          file: 'src/app.ts',
          line: 10,
          type: 'function-call',
          code: 'deprecatedFunction()',
          specifiers: ['deprecatedFunction'],
        },
      ];
      
      const configUsage: ConfigUsage[] = [
        {
          file: 'webpack.config.js',
          line: 15,
          type: 'config',
          content: 'use: ["deprecatedFunction"]',
        },
      ];
      
      const analysis = analyzeUsage({
        codeUsage,
        configUsage,
        breakingChanges: ['deprecatedFunction'],
      });
      
      expect(analysis.score).toBeGreaterThan(10);
      expect(analysis.recommendations).toContainEqual(expect.stringContaining('breaking change'));
    });
  });
});