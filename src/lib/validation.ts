/**
 * Validation utilities for package names and versions
 * Helps prevent command injection and other security issues
 */

/**
 * Validates npm package name format
 * @see https://docs.npmjs.com/cli/v8/configuring-npm/package-json#name
 */
export function validatePackageName(packageName: string): string {
  if (!packageName || typeof packageName !== 'string') {
    throw new Error('Package name must be a non-empty string');
  }

  // Maximum length for npm package names
  if (packageName.length > 214) {
    throw new Error('Package name too long (max 214 characters)');
  }

  // npm package name pattern
  // Allows scoped packages like @scope/package
  const npmPackagePattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
  
  if (!npmPackagePattern.test(packageName)) {
    throw new Error(`Invalid package name format: ${packageName}`);
  }

  // Additional security checks
  const dangerousPatterns = [
    /[;&|`$(){}[\]<>]/,  // Shell metacharacters
    /\.\./,              // Path traversal
    /^[._]/,             // Hidden files
    /\0/,                // Null bytes
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(packageName)) {
      throw new Error(`Package name contains unsafe characters: ${packageName}`);
    }
  }
  
  return packageName;
}

/**
 * Validates semantic version format
 * @see https://semver.org/
 */
export function validateVersion(version: string): string {
  if (!version || typeof version !== 'string') {
    throw new Error('Version must be a non-empty string');
  }

  // Maximum reasonable length for versions
  if (version.length > 256) {
    throw new Error('Version string too long');
  }

  // Semantic version pattern (simplified to reduce complexity)
  // Basic format: major.minor.patch[-prerelease][+build]
  const semverPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
  
  // Also allow npm dist-tags like 'latest', 'next', 'beta'
  const distTagPattern = /^[a-z][a-z0-9-]*$/i;
  
  if (!semverPattern.test(version) && !distTagPattern.test(version)) {
    throw new Error(`Invalid version format: ${version}`);
  }

  // Security checks for versions
  const dangerousPatterns = [
    /[;&|`$(){}[\]<>]/,  // Shell metacharacters
    /\.\./,              // Path traversal
    /\0/,                // Null bytes
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(version)) {
      throw new Error(`Version contains unsafe characters: ${version}`);
    }
  }
  
  return version;
}

/**
 * Validates and sanitizes URL for API calls
 */
export function validateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    
    // Only allow https (and http for localhost)
    if (parsed.protocol !== 'https:' && 
        !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
      throw new Error('Only HTTPS URLs are allowed');
    }
    
    // Validate hostname
    const validHosts = [
      'pypi.org',
      'www.pypi.org',
      'registry.npmjs.org',
      'www.npmjs.com',
      'api.github.com',
      'github.com',
      'raw.githubusercontent.com',
    ];
    
    // Allow localhost for development
    if (parsed.hostname === 'localhost') {
      return url;
    }
    
    if (!validHosts.includes(parsed.hostname) && 
        !parsed.hostname.endsWith('.npmjs.org')) {
      throw new Error(`Untrusted host: ${parsed.hostname}`);
    }
    
    return url;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid URL: ${error.message}`);
    }
    throw new Error('Invalid URL format');
  }
}

/**
 * Escapes package name for safe inclusion in URLs
 */
export function escapeForUrl(str: string): string {
  return encodeURIComponent(str);
}

/**
 * Validates Python package name format
 * @see https://peps.python.org/pep-0508/
 */
export function validatePythonPackageName(packageName: string): string {
  if (!packageName || typeof packageName !== 'string') {
    throw new Error('Package name must be a non-empty string');
  }

  // Python package name pattern (PEP 508)
  // Allows letters, numbers, hyphens, underscores, and dots
  const pythonPackagePattern = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
  
  if (!pythonPackagePattern.test(packageName)) {
    throw new Error(`Invalid Python package name format: ${packageName}`);
  }

  // Normalize package name (PEP 503)
  // Replace underscores and dots with hyphens, convert to lowercase
  const normalized = packageName.toLowerCase().replace(/[._]/g, '-');
  
  return normalized;
}