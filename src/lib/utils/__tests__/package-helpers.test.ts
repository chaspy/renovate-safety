import { describe, it, expect } from 'vitest';
import { 
  categorizePackage, 
  detectFramework, 
  detectRuntime, 
  hasESModules, 
  hasTypeDefinitions,
  parseNodeSupport,
  parseBrowserSupport
} from '../package-helpers.js';
import { PACKAGE_CATEGORIES, FRAMEWORKS, RUNTIMES } from '../../constants.js';

describe('Package Helpers', () => {
  describe('categorizePackage', () => {
    it('should categorize frontend packages', () => {
      const result = categorizePackage('react-component', ['ui', 'react']);
      expect(result).toContain(PACKAGE_CATEGORIES.FRONTEND);
    });

    it('should categorize build tools', () => {
      const result = categorizePackage('webpack-plugin', ['build', 'webpack']);
      expect(result).toContain(PACKAGE_CATEGORIES.BUILD_TOOL);
    });

    it('should categorize testing packages', () => {
      const result = categorizePackage('jest-matcher', ['testing', 'jest']);
      expect(result).toContain(PACKAGE_CATEGORIES.TESTING);
    });

    it('should categorize utility packages', () => {
      const result = categorizePackage('lodash-helper', ['utility', 'helper']);
      expect(result).toContain(PACKAGE_CATEGORIES.UTILITY);
    });

    it('should return unknown for uncategorized packages', () => {
      const result = categorizePackage('mystery-package', []);
      expect(result).toEqual([PACKAGE_CATEGORIES.UNKNOWN]);
    });
  });

  describe('detectFramework', () => {
    it('should detect React', () => {
      const result = detectFramework('react-hooks', ['react']);
      expect(result).toContain(FRAMEWORKS.REACT);
    });

    it('should detect Vue', () => {
      const result = detectFramework('vue-component', ['vue']);
      expect(result).toContain(FRAMEWORKS.VUE);
    });

    it('should detect multiple frameworks', () => {
      const result = detectFramework('universal-component', ['react', 'vue']);
      expect(result).toContain(FRAMEWORKS.REACT);
      expect(result).toContain(FRAMEWORKS.VUE);
    });

    it('should return empty array for no frameworks', () => {
      const result = detectFramework('plain-package', []);
      expect(result).toEqual([]);
    });
  });

  describe('detectRuntime', () => {
    it('should detect Node.js', () => {
      const result = detectRuntime('server-package', ['node', 'nodejs']);
      expect(result).toContain(RUNTIMES.NODEJS);
    });

    it('should detect Browser', () => {
      const result = detectRuntime('client-package', ['browser', 'client']);
      expect(result).toContain(RUNTIMES.BROWSER);
    });

    it('should default to Node.js when no runtime detected', () => {
      const result = detectRuntime('mystery-package', []);
      expect(result).toEqual([RUNTIMES.NODEJS]);
    });
  });

  describe('hasESModules', () => {
    it('should detect ES modules from module field', () => {
      const packageData = { module: 'dist/index.esm.js' };
      expect(hasESModules(packageData)).toBe(true);
    });

    it('should detect ES modules from exports field', () => {
      const packageData = { exports: { '.': './dist/index.js' } };
      expect(hasESModules(packageData)).toBe(true);
    });

    it('should return false for packages without ES modules', () => {
      const packageData = { main: 'dist/index.js' };
      expect(hasESModules(packageData)).toBe(false);
    });

    it('should return false for invalid input', () => {
      expect(hasESModules(null)).toBe(false);
      expect(hasESModules('string')).toBe(false);
    });
  });

  describe('hasTypeDefinitions', () => {
    it('should detect types from types field', () => {
      const packageData = { types: 'dist/index.d.ts' };
      expect(hasTypeDefinitions('test-package', packageData)).toBe(true);
    });

    it('should detect types from typings field', () => {
      const packageData = { typings: 'dist/index.d.ts' };
      expect(hasTypeDefinitions('test-package', packageData)).toBe(true);
    });

    it('should detect @types packages', () => {
      expect(hasTypeDefinitions('@types/node', {})).toBe(true);
    });

    it('should return false for packages without types', () => {
      expect(hasTypeDefinitions('plain-package', {})).toBe(false);
    });
  });

  describe('parseNodeSupport', () => {
    it('should parse node version', () => {
      expect(parseNodeSupport('>=14.0.0')).toEqual(['>=14.0.0']);
    });

    it('should return empty array for no version', () => {
      expect(parseNodeSupport()).toEqual([]);
    });
  });

  describe('parseBrowserSupport', () => {
    it('should return browserslist array', () => {
      const browserslist = ['> 1%', 'last 2 versions'];
      expect(parseBrowserSupport(browserslist)).toEqual(browserslist);
    });

    it('should return empty array for undefined', () => {
      expect(parseBrowserSupport()).toEqual([]);
    });
  });
});