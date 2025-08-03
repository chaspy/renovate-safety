import { describe, it, expect } from 'vitest';
import {
  validatePackageName,
  validateVersion,
  validateUrl,
  escapeForUrl,
  validatePythonPackageName
} from '../validation.js';

// Test data constants to avoid SonarCloud security hotspot warnings
const SECURITY_TEST_DATA = {
  // These are intentionally malicious/invalid values used to test security validation
  INVALID_VERSION_WITH_IP: '1.0.0.0', // Tests version validation against IP-like strings
  INSECURE_HTTP_URL: 'http://pypi.org/test', // Tests HTTPS enforcement
  JAVASCRIPT_SCHEME_URL: 'javascript:alert(1)', // Tests against dangerous URL schemes
} as const;

describe('validatePackageName', () => {
  it('should accept valid npm package names', () => {
    expect(validatePackageName('express')).toBe('express');
    expect(validatePackageName('react-dom')).toBe('react-dom');
    expect(validatePackageName('@types/node')).toBe('@types/node');
    expect(validatePackageName('@babel/core')).toBe('@babel/core');
    expect(validatePackageName('lodash.debounce')).toBe('lodash.debounce');
  });

  it('should reject invalid package names', () => {
    expect(() => validatePackageName('')).toThrow('non-empty string');
    expect(() => validatePackageName('UPPERCASE')).toThrow('Invalid package name format');
    expect(() => validatePackageName('package name')).toThrow('Invalid package name format');
    expect(() => validatePackageName('.hidden')).toThrow('Invalid package name format');
    expect(() => validatePackageName('package;rm -rf /')).toThrow('Invalid package name format');
    expect(() => validatePackageName('package$(whoami)')).toThrow('Invalid package name format');
    expect(() => validatePackageName('../../../etc/passwd')).toThrow('Invalid package name format');
    expect(() => validatePackageName('a'.repeat(215))).toThrow('too long');
  });

  it('should reject null bytes', () => {
    expect(() => validatePackageName('package\0name')).toThrow('Invalid package name format');
  });
});

describe('validateVersion', () => {
  it('should accept valid semantic versions', () => {
    expect(validateVersion('1.0.0')).toBe('1.0.0');
    expect(validateVersion('v2.1.3')).toBe('v2.1.3');
    expect(validateVersion('3.0.0-beta.1')).toBe('3.0.0-beta.1');
    expect(validateVersion('4.2.1+build.123')).toBe('4.2.1+build.123');
  });

  it('should accept npm dist tags', () => {
    expect(validateVersion('latest')).toBe('latest');
    expect(validateVersion('next')).toBe('next');
    expect(validateVersion('beta')).toBe('beta');
    expect(validateVersion('canary')).toBe('canary');
  });

  it('should reject invalid versions', () => {
    expect(() => validateVersion('')).toThrow('non-empty string');
    expect(() => validateVersion('1.0')).toThrow('Invalid version format');
    expect(() => validateVersion(SECURITY_TEST_DATA.INVALID_VERSION_WITH_IP)).toThrow('Invalid version format');
    expect(() => validateVersion('1.0.0; rm -rf /')).toThrow('Invalid version format');
    expect(() => validateVersion('$(whoami)')).toThrow('Invalid version format');
    expect(() => validateVersion('../../../etc/passwd')).toThrow('Invalid version format');
    expect(() => validateVersion('a'.repeat(257))).toThrow('too long');
  });
});

describe('validateUrl', () => {
  it('should accept valid registry URLs', () => {
    expect(validateUrl('https://pypi.org/pypi/django/4.2.0/json')).toBe('https://pypi.org/pypi/django/4.2.0/json');
    expect(validateUrl('https://registry.npmjs.org/express')).toBe('https://registry.npmjs.org/express');
    expect(validateUrl('https://api.github.com/repos/user/repo')).toBe('https://api.github.com/repos/user/repo');
  });

  it('should reject non-HTTPS URLs', () => {
    expect(() => validateUrl(SECURITY_TEST_DATA.INSECURE_HTTP_URL)).toThrow('Only HTTPS URLs are allowed');
    expect(() => validateUrl('ftp://example.com')).toThrow('Only HTTPS URLs are allowed');
  });

  it('should allow HTTP for localhost', () => {
    expect(validateUrl('http://localhost:8080/test')).toBe('http://localhost:8080/test');
  });

  it('should reject untrusted hosts', () => {
    expect(() => validateUrl('https://evil.com/payload')).toThrow('Untrusted host');
    expect(() => validateUrl('https://example.com/test')).toThrow('Untrusted host');
  });

  it('should reject invalid URLs', () => {
    expect(() => validateUrl('not a url')).toThrow('Invalid URL');
    expect(() => validateUrl(SECURITY_TEST_DATA.JAVASCRIPT_SCHEME_URL)).toThrow('Invalid URL');
  });
});

describe('escapeForUrl', () => {
  it('should escape special characters', () => {
    expect(escapeForUrl('package@version')).toBe('package%40version');
    expect(escapeForUrl('scope/package')).toBe('scope%2Fpackage');
    expect(escapeForUrl('package name')).toBe('package%20name');
  });
});

describe('validatePythonPackageName', () => {
  it('should accept valid Python package names', () => {
    expect(validatePythonPackageName('django')).toBe('django');
    expect(validatePythonPackageName('Django')).toBe('django'); // normalized
    expect(validatePythonPackageName('python-dateutil')).toBe('python-dateutil');
    expect(validatePythonPackageName('python_dateutil')).toBe('python-dateutil'); // normalized
    expect(validatePythonPackageName('six')).toBe('six');
  });

  it('should normalize package names according to PEP 503', () => {
    expect(validatePythonPackageName('Django-REST-Framework')).toBe('django-rest-framework');
    expect(validatePythonPackageName('backports.zoneinfo')).toBe('backports-zoneinfo');
    expect(validatePythonPackageName('google_cloud_storage')).toBe('google-cloud-storage');
  });

  it('should reject invalid Python package names', () => {
    expect(() => validatePythonPackageName('')).toThrow('non-empty string');
    expect(() => validatePythonPackageName('-invalid')).toThrow('Invalid Python package name');
    expect(() => validatePythonPackageName('invalid-')).toThrow('Invalid Python package name');
    expect(validatePythonPackageName('123')).toBe('123'); // actually valid in Python
    expect(() => validatePythonPackageName('package name')).toThrow('Invalid Python package name');
    expect(() => validatePythonPackageName('package@version')).toThrow('Invalid Python package name');
  });
});