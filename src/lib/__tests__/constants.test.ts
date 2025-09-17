import { describe, it, expect } from 'vitest';
import { 
  FALLBACK_VALUES, 
  PACKAGE_CATEGORIES, 
  FRAMEWORKS, 
  RUNTIMES, 
  RELEASE_FREQUENCIES,
  SEVERITY_LEVELS,
  COMPLEXITY_LEVELS
} from '../constants.js';

describe('Constants', () => {
  describe('FALLBACK_VALUES', () => {
    it('should have all required fallback values', () => {
      expect(FALLBACK_VALUES.DESCRIPTION).toBe('No description available');
      expect(FALLBACK_VALUES.LICENSE).toBe('Unknown');
      expect(FALLBACK_VALUES.VERSION).toBe('Unknown');
      expect(FALLBACK_VALUES.EMPTY_STRING).toBe('');
      expect(FALLBACK_VALUES.UNPACKED_SIZE).toBe(0);
      expect(FALLBACK_VALUES.TIMEOUT_DEFAULT).toBe(10000);
      expect(FALLBACK_VALUES.TIMEOUT_EXTENDED).toBe(15000);
    });
  });

  describe('PACKAGE_CATEGORIES', () => {
    it('should have all package categories', () => {
      expect(PACKAGE_CATEGORIES.FRONTEND).toBe('frontend');
      expect(PACKAGE_CATEGORIES.BUILD_TOOL).toBe('build-tool');
      expect(PACKAGE_CATEGORIES.TESTING).toBe('testing');
      expect(PACKAGE_CATEGORIES.UTILITY).toBe('utility');
      expect(PACKAGE_CATEGORIES.UNKNOWN).toBe('unknown');
    });
  });

  describe('FRAMEWORKS', () => {
    it('should have all major frameworks', () => {
      expect(FRAMEWORKS.REACT).toBe('React');
      expect(FRAMEWORKS.VUE).toBe('Vue');
      expect(FRAMEWORKS.ANGULAR).toBe('Angular');
      expect(FRAMEWORKS.SVELTE).toBe('Svelte');
      expect(FRAMEWORKS.NEXTJS).toBe('Next.js');
    });
  });

  describe('RUNTIMES', () => {
    it('should have all major runtimes', () => {
      expect(RUNTIMES.NODEJS).toBe('Node.js');
      expect(RUNTIMES.BROWSER).toBe('Browser');
      expect(RUNTIMES.DENO).toBe('Deno');
      expect(RUNTIMES.BUN).toBe('Bun');
    });
  });

  describe('RELEASE_FREQUENCIES', () => {
    it('should have all release frequency levels', () => {
      expect(RELEASE_FREQUENCIES.VERY_ACTIVE).toBe('very-active');
      expect(RELEASE_FREQUENCIES.ACTIVE).toBe('active');
      expect(RELEASE_FREQUENCIES.MODERATE).toBe('moderate');
      expect(RELEASE_FREQUENCIES.SLOW).toBe('slow');
      expect(RELEASE_FREQUENCIES.INACTIVE).toBe('inactive');
    });
  });

  describe('SEVERITY_LEVELS', () => {
    it('should have all severity levels', () => {
      expect(SEVERITY_LEVELS.CRITICAL).toBe('critical');
      expect(SEVERITY_LEVELS.HIGH).toBe('high');
      expect(SEVERITY_LEVELS.MODERATE).toBe('moderate');
      expect(SEVERITY_LEVELS.LOW).toBe('low');
    });
  });

  describe('COMPLEXITY_LEVELS', () => {
    it('should have all complexity levels', () => {
      expect(COMPLEXITY_LEVELS.SIMPLE).toBe('simple');
      expect(COMPLEXITY_LEVELS.MODERATE).toBe('moderate');
      expect(COMPLEXITY_LEVELS.COMPLEX).toBe('complex');
      expect(COMPLEXITY_LEVELS.VERY_COMPLEX).toBe('very-complex');
    });
  });
});