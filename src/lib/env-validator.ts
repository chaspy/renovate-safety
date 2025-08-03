/**
 * Environment variable validation utilities
 */

/**
 * Validate and get environment variable
 * @param name Environment variable name
 * @param validator Optional validation function
 * @returns Environment variable value or undefined
 */
export function getEnvVar(
  name: string,
  validator?: (value: string) => boolean
): string | undefined {
  const value = process.env[name];

  if (!value || typeof value !== 'string') {
    return undefined;
  }

  // Check for empty strings
  if (value.trim().length === 0) {
    return undefined;
  }

  // Apply custom validation if provided
  if (validator && !validator(value)) {
    console.warn(`Invalid value for environment variable ${name}`);
    return undefined;
  }

  return value;
}

/**
 * Get environment variable with allowed values
 * @param name Environment variable name
 * @param allowedValues Array of allowed values
 * @returns Environment variable value if valid, undefined otherwise
 */
export function getEnvVarEnum<T extends string>(
  name: string,
  allowedValues: readonly T[]
): T | undefined {
  const value = getEnvVar(name);

  if (!value) {
    return undefined;
  }

  if (allowedValues.includes(value as T)) {
    return value as T;
  }

  console.warn(
    `Invalid value '${value}' for environment variable ${name}. Allowed values: ${allowedValues.join(', ')}`
  );
  return undefined;
}

/**
 * Get required environment variable
 * @param name Environment variable name
 * @throws Error if environment variable is not set
 */
export function getRequiredEnvVar(name: string): string {
  const value = getEnvVar(name);

  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }

  return value;
}

/**
 * Path validation for environment variables
 */
export function isValidPath(value: string): boolean {
  // Basic path validation - no null bytes, etc
  if (value.includes('\0')) {
    return false;
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /\.\.[/\\]\.\.[/\\]/, // Multiple parent directory traversals
    /^[/\\]etc[/\\]/, // System config directories
    /^[/\\]proc[/\\]/, // Process information
  ];

  return !suspiciousPatterns.some((pattern) => pattern.test(value));
}
