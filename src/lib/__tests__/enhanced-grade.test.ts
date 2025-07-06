import { describe, it, expect } from 'vitest';
import { assessEnhancedRisk } from '../enhanced-grade.js';
import type { PackageUpdate, BreakingChange } from '../../types/index.js';

describe('Enhanced Risk Assessment', () => {
  const mockPackageUpdate: PackageUpdate = {
    name: 'test-package',
    fromVersion: '1.0.0',
    toVersion: '2.0.0'
  };

  it('should return unknown risk for no information', async () => {
    const result = await assessEnhancedRisk(
      mockPackageUpdate,
      [],
      null,
      null,
      false,
      false
    );

    expect(result.level).toBe('unknown');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should assess major version upgrade as high risk', async () => {
    const breakingChanges: BreakingChange[] = [
      { line: 'Removed deprecated API', severity: 'breaking' },
      { line: 'Changed function signature', severity: 'breaking' }
    ];

    const result = await assessEnhancedRisk(
      mockPackageUpdate,
      breakingChanges,
      {
        locations: [],
        totalUsageCount: 10,
        productionUsageCount: 8,
        testUsageCount: 2,
        configUsageCount: 0,
        criticalPaths: ['src/index.ts'],
        hasDynamicImports: false
      },
      null,
      true,
      true
    );

    expect(['high', 'critical']).toContain(result.level);
    expect(result.detailedFactors.versionJump.major).toBe(1);
  });

  it('should consider test coverage in risk assessment', async () => {
    const result = await assessEnhancedRisk(
      {
        name: 'test-package',
        fromVersion: '1.0.0',
        toVersion: '1.1.0'
      },
      [],
      {
        locations: [],
        totalUsageCount: 10,
        productionUsageCount: 5,
        testUsageCount: 5,
        configUsageCount: 0,
        criticalPaths: [],
        hasDynamicImports: false
      },
      null,
      true,
      false
    );

    // Good test coverage should lower risk
    expect(result.detailedFactors.usage.testCoverage).toBeGreaterThan(50);
  });
});