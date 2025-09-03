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

  describe('@types/* package handling', () => {
    it('should assess @types/* patch updates as SAFE', async () => {
      const result = await assessEnhancedRisk(
        {
          name: '@types/node',
          fromVersion: '24.0.6',
          toVersion: '24.0.15'
        },
        [],
        null,
        null,
        false,
        false
      );

      expect(result.level).toBe('safe');
      expect(result.detailedFactors.packageSpecific.isTypeDefinition).toBe(true);
    });

    it('should assess @types/* minor updates as SAFE or LOW', async () => {
      const result = await assessEnhancedRisk(
        {
          name: '@types/react',
          fromVersion: '18.0.0',
          toVersion: '18.1.0'
        },
        [],
        null,
        null,
        false,
        false
      );

      expect(['safe', 'low']).toContain(result.level);
      expect(result.detailedFactors.packageSpecific.isTypeDefinition).toBe(true);
    });

    it('should assess @types/* major updates with appropriate risk', async () => {
      const result = await assessEnhancedRisk(
        {
          name: '@types/react',
          fromVersion: '17.0.0',
          toVersion: '18.0.0'
        },
        [],
        {
          locations: [],
          totalUsageCount: 10,
          productionUsageCount: 10,
          testUsageCount: 0,
          configUsageCount: 0,
          criticalPaths: ['src/index.ts'],
          hasDynamicImports: false
        },
        null,
        false,
        false
      );

      // Major updates can still have risk, but reduced
      expect(['low', 'medium', 'high']).toContain(result.level);
      expect(result.detailedFactors.packageSpecific.isTypeDefinition).toBe(true);
    });

    it('should handle normal packages differently from @types/*', async () => {
      const normalResult = await assessEnhancedRisk(
        {
          name: 'lodash',
          fromVersion: '4.17.20',
          toVersion: '4.17.21'
        },
        [],
        null,
        null,
        false,
        false
      );

      const typesResult = await assessEnhancedRisk(
        {
          name: '@types/lodash',
          fromVersion: '4.17.20',
          toVersion: '4.17.21'
        },
        [],
        null,
        null,
        false,
        false
      );

      // @types/* should have lower or equal risk than normal packages
      expect(typesResult.level).toBe('safe');
      expect(typesResult.detailedFactors.packageSpecific.isTypeDefinition).toBe(true);
      expect(normalResult.detailedFactors.packageSpecific.isTypeDefinition).toBeFalsy();
    });
  });
});