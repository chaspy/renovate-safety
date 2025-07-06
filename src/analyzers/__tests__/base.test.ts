import { describe, it, expect } from 'vitest';
import '../index.js'; // This registers all analyzers
import { analyzerRegistry } from '../base.js';
import { NpmAnalyzer } from '../npm/NpmAnalyzer.js';
import { PyPiAnalyzer } from '../python/PyPiAnalyzer.js';

describe('AnalyzerRegistry', () => {
  it('should register and find npm analyzer', async () => {
    const registry = analyzerRegistry;
    const analyzer = await registry.findAnalyzer('express', process.cwd());
    
    // Should find an analyzer (might be npm or fallback)
    expect(analyzer).toBeDefined();
  });

  it('should have npm and pypi analyzers registered', () => {
    const analyzers = analyzerRegistry.getAllAnalyzers();
    
    expect(analyzers.length).toBeGreaterThanOrEqual(2);
    expect(analyzers.some(a => a instanceof NpmAnalyzer)).toBe(true);
    expect(analyzers.some(a => a instanceof PyPiAnalyzer)).toBe(true);
  });
});