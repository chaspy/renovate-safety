import { URL } from 'node:url';

/**
 * Common string validation and manipulation utilities to reduce code duplication
 */

/**
 * Check if a string contains only safe characters for shell arguments
 */
export function isSafeArg(arg: string): boolean {
  return /^[a-zA-Z0-9._\-/]+$/.test(arg);
}

/**
 * Check if a string is a valid package name
 */
export function isValidPackageName(name: string): boolean {
  // npm package name rules
  const npmPattern = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
  return npmPattern.test(name) && name.length <= 214;
}

/**
 * Check if a string is a valid version string
 */
export function isValidVersion(version: string): boolean {
  const semverPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
  return semverPattern.test(version);
}

/**
 * Normalize package name by removing scope prefix if needed
 */
export function normalizePackageName(name: string): string {
  // Remove @ scope for certain operations
  if (name.startsWith('@') && name.includes('/')) {
    const parts = name.split('/');
    return parts[1];
  }
  return name;
}

/**
 * Extract package scope from scoped package name
 */
export function extractPackageScope(name: string): string | null {
  if (name.startsWith('@') && name.includes('/')) {
    const parts = name.split('/');
    return parts[0].substring(1); // Remove @
  }
  return null;
}

/**
 * Sanitize string for use in regular expressions
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Convert string to kebab-case
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Convert string to camelCase
 */
export function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ''))
    .replace(/^./, (char) => char.toLowerCase());
}

/**
 * Check if string contains only alphanumeric characters
 */
export function isAlphanumeric(str: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(str);
}

/**
 * Extract numbers from string
 */
export function extractNumbers(str: string): number[] {
  const regex = /\d+/g;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(str)) !== null) {
    matches.push(match[0]);
  }
  return matches.map(Number);
}

/**
 * Check if string is a valid URL
 */
export function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

/**
 * Remove common prefixes from strings
 */
export function removePrefix(str: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    if (str.startsWith(prefix)) {
      return str.substring(prefix.length);
    }
  }
  return str;
}

/**
 * Remove common suffixes from strings
 */
export function removeSuffix(str: string, suffixes: string[]): string {
  for (const suffix of suffixes) {
    if (str.endsWith(suffix)) {
      return str.substring(0, str.length - suffix.length);
    }
  }
  return str;
}

/**
 * Pluralize a word based on count
 */
export function pluralize(word: string, count: number): string {
  if (count === 1) {
    return word;
  }

  // Simple pluralization rules
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return word.slice(0, -1) + 'ies';
  }
  if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) {
    return word + 'es';
  }
  return word + 's';
}

/**
 * Join strings with proper grammar (Oxford comma)
 */
export function joinWithGrammar(items: string[], conjunction: string = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;

  const last = items[items.length - 1];
  const rest = items.slice(0, -1);
  return `${rest.join(', ')}, ${conjunction} ${last}`;
}
