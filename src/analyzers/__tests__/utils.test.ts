import { describe, it, expect } from 'vitest';
import {
  getFileContext,
  categorizeUsages,
  isPackageImport,
  extractPackageNameFromImport,
  normalizePackageName,
  getErrorMessage
} from '../utils.js';
import type { UsageLocation } from '../base.js';

describe('getFileContext', () => {
  it('should identify test files', () => {
    expect(getFileContext('src/__tests__/index.test.ts')).toBe('test');
    expect(getFileContext('test/unit/component.spec.js')).toBe('test');
    expect(getFileContext('tests/integration/api.test.py')).toBe('test');
    expect(getFileContext('src/components/__mocks__/Button.tsx')).toBe('test');
    expect(getFileContext('conftest.py')).toBe('test');
  });

  it('should identify config files', () => {
    expect(getFileContext('webpack.config.js')).toBe('config');
    expect(getFileContext('.eslintrc.json')).toBe('config');
    expect(getFileContext('tsconfig.json')).toBe('config');
    expect(getFileContext('package.json')).toBe('config');
    expect(getFileContext('pyproject.toml')).toBe('config');
    expect(getFileContext('requirements.txt')).toBe('config');
  });

  it('should identify build files', () => {
    expect(getFileContext('dist/bundle.js')).toBe('build');
    expect(getFileContext('build/index.js')).toBe('build');
    expect(getFileContext('.next/static/chunks/main.js')).toBe('build');
    expect(getFileContext('out/compiled.js')).toBe('build');
  });

  it('should identify production files', () => {
    expect(getFileContext('src/index.ts')).toBe('production');
    expect(getFileContext('lib/utils.js')).toBe('production');
    expect(getFileContext('app/components/Button.tsx')).toBe('production');
    expect(getFileContext('server/api/routes.py')).toBe('production');
  });
});

describe('categorizeUsages', () => {
  it('should categorize usage locations correctly', () => {
    const locations: UsageLocation[] = [
      {
        file: 'src/index.ts',
        line: 10,
        column: 0,
        type: 'import',
        code: 'import express from "express"',
        context: 'production'
      },
      {
        file: 'src/server.ts',
        line: 5,
        column: 0,
        type: 'import',
        code: 'import express from "express"',
        context: 'production'
      },
      {
        file: 'tests/server.test.ts',
        line: 3,
        column: 0,
        type: 'import',
        code: 'import express from "express"',
        context: 'test'
      },
      {
        file: 'webpack.config.js',
        line: 15,
        column: 0,
        type: 'config',
        code: 'express reference',
        context: 'config'
      }
    ];

    const result = categorizeUsages(locations);
    
    expect(result.totalUsageCount).toBe(4);
    expect(result.productionUsageCount).toBe(2);
    expect(result.testUsageCount).toBe(1);
    expect(result.configUsageCount).toBe(1);
    expect(result.criticalPaths).toEqual(['src/index.ts', 'src/server.ts']);
    expect(result.hasDynamicImports).toBe(false);
  });

  it('should detect dynamic imports', () => {
    const locations: UsageLocation[] = [
      {
        file: 'src/loader.ts',
        line: 20,
        column: 0,
        type: 'require',
        code: 'const mod = import("./module")',
        context: 'production'
      }
    ];

    const result = categorizeUsages(locations);
    expect(result.hasDynamicImports).toBe(true);
  });

  it('should handle Python dynamic imports', () => {
    const locations: UsageLocation[] = [
      {
        file: 'app/loader.py',
        line: 10,
        column: 0,
        type: 'require',
        code: 'mod = importlib.import_module("module")',
        context: 'production'
      }
    ];

    const result = categorizeUsages(locations);
    expect(result.hasDynamicImports).toBe(true);
  });
});

describe('isPackageImport', () => {
  it('should match direct package imports', () => {
    expect(isPackageImport('express', 'express')).toBe(true);
    expect(isPackageImport('react', 'react')).toBe(true);
  });

  it('should match subpath imports', () => {
    expect(isPackageImport('express/lib/router', 'express')).toBe(true);
    expect(isPackageImport('lodash/debounce', 'lodash')).toBe(true);
  });

  it('should match scoped packages', () => {
    expect(isPackageImport('@babel/core', '@babel/core')).toBe(true);
    expect(isPackageImport('@babel/core/lib/parser', '@babel/core')).toBe(true);
  });

  it('should not match different packages', () => {
    expect(isPackageImport('express', 'koa')).toBe(false);
    expect(isPackageImport('express-session', 'express')).toBe(false);
  });
});

describe('extractPackageNameFromImport', () => {
  it('should extract from ES6 imports', () => {
    expect(extractPackageNameFromImport('import express from "express"')).toBe('express');
    expect(extractPackageNameFromImport('import { Router } from "express"')).toBe('express');
    expect(extractPackageNameFromImport('import * as React from "react"')).toBe('react');
    expect(extractPackageNameFromImport('import("lodash")')).toBe('lodash');
  });

  it('should extract from CommonJS requires', () => {
    expect(extractPackageNameFromImport('const express = require("express")')).toBe('express');
    expect(extractPackageNameFromImport('require.resolve("typescript")')).toBe('typescript');
  });

  it('should extract from Python imports', () => {
    expect(extractPackageNameFromImport('import django')).toBe('django');
    expect(extractPackageNameFromImport('from flask import Flask')).toBe('flask');
    expect(extractPackageNameFromImport('importlib.import_module("numpy")')).toBe('numpy');
    expect(extractPackageNameFromImport('__import__("pandas")')).toBe('pandas');
  });

  it('should return null for invalid imports', () => {
    expect(extractPackageNameFromImport('// not an import')).toBe(null);
    expect(extractPackageNameFromImport('const x = 5')).toBe(null);
  });
});

describe('normalizePackageName', () => {
  it('should normalize npm packages', () => {
    expect(normalizePackageName('Express', 'npm')).toBe('Express'); // npm is case-sensitive
    expect(normalizePackageName('@babel/core', 'npm')).toBe('@babel/core');
  });

  it('should normalize PyPI packages', () => {
    expect(normalizePackageName('Django', 'pypi')).toBe('django');
    expect(normalizePackageName('python_dateutil', 'pypi')).toBe('python-dateutil');
    expect(normalizePackageName('backports.zoneinfo', 'pypi')).toBe('backports-zoneinfo');
  });

  it('should handle other ecosystems', () => {
    expect(normalizePackageName('github.com/gin-gonic/gin', 'go')).toBe('github.com/gin-gonic/gin');
    expect(normalizePackageName('org.springframework:spring-core', 'maven')).toBe('org.springframework:spring-core');
  });
});

describe('getErrorMessage', () => {
  it('should extract message from Error objects', () => {
    expect(getErrorMessage(new Error('Test error'))).toBe('Test error');
  });

  it('should handle string errors', () => {
    expect(getErrorMessage('String error')).toBe('String error');
  });

  it('should handle objects with message property', () => {
    expect(getErrorMessage({ message: 'Object error' })).toBe('Object error');
  });

  it('should handle unknown error types', () => {
    expect(getErrorMessage(null)).toBe('Unknown error occurred');
    expect(getErrorMessage(undefined)).toBe('Unknown error occurred');
    expect(getErrorMessage(123)).toBe('Unknown error occurred');
  });
});