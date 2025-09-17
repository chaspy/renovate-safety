import { describe, it, expect } from 'vitest';
import { gatherLibraryIntelligence } from '../library-intelligence.js';
import { FALLBACK_VALUES } from '../constants.js';

describe('Library Intelligence', () => {
  describe('gatherLibraryIntelligence', () => {
    it('should return default values when package is not found', async () => {
      const result = await gatherLibraryIntelligence('non-existent-package', '1.0.0', '2.0.0');
      
      expect(result.packageName).toBe('non-existent-package');
      expect(result.packageInfo.description).toBe(FALLBACK_VALUES.DESCRIPTION);
      expect(result.packageInfo.license).toBe(FALLBACK_VALUES.LICENSE);
      expect(result.packageInfo.latestVersion).toBe(FALLBACK_VALUES.VERSION);
      expect(result.packageInfo.maintainers).toEqual([]);
      expect(result.packageInfo.keywords).toEqual([]);
      expect(result.packageInfo.size.unpacked).toBe(FALLBACK_VALUES.UNPACKED_SIZE);
    });

    it('should handle valid package name input', async () => {
      const result = await gatherLibraryIntelligence('lodash', '4.0.0', '4.17.0');
      
      expect(result.packageName).toBe('lodash');
      expect(result.ecosystemInfo.packageManager).toBe('npm');
      expect(result.migrationIntelligence.fromVersion).toBe('4.0.0');
      expect(result.migrationIntelligence.toVersion).toBe('4.17.0');
    });

    it('should have proper structure for all intelligence sections', async () => {
      const result = await gatherLibraryIntelligence('test-package', '1.0.0', '1.1.0');
      
      expect(result).toHaveProperty('packageName');
      expect(result).toHaveProperty('packageInfo');
      expect(result).toHaveProperty('ecosystemInfo');
      expect(result).toHaveProperty('maintenanceInfo');
      expect(result).toHaveProperty('securityInfo');
      expect(result).toHaveProperty('popularityMetrics');
      expect(result).toHaveProperty('technicalDetails');
      expect(result).toHaveProperty('migrationIntelligence');
    });
  });
});