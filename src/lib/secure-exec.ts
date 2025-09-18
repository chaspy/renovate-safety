/**
 * Secure command execution utilities
 * Provides centralized, validated command execution to prevent injection attacks
 */

import { execa, ExecaError } from 'execa';
import { validatePackageName, validateVersion } from './validation.js';
import { tmpdir } from 'os';

export type SecureExecOptions = {
  cwd?: string;
  timeout?: number;
  throwOnError?: boolean;
  env?: Record<string, string>;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  failed: boolean;
  exitCode?: number;
  success: boolean;
  error?: string;
};

/**
 * Common error handler for execa errors
 */
function handleExecError(error: unknown, options: SecureExecOptions): ExecResult {
  if (options.throwOnError) {
    throw error;
  }

  const execaError = error as ExecaError;
  return {
    stdout: typeof execaError.stdout === 'string' ? execaError.stdout : '',
    stderr:
      typeof execaError.stderr === 'string'
        ? execaError.stderr
        : execaError.message || 'Unknown error',
    failed: true,
    exitCode: execaError.exitCode,
    success: false,
    error:
      typeof execaError.stderr === 'string'
        ? execaError.stderr
        : execaError.message || 'Unknown error',
  };
}

/**
 * Common execution wrapper with error handling
 */
async function executeCommand(
  command: string,
  args: string[],
  options: SecureExecOptions = {},
  cwdDefault?: string
): Promise<ExecResult> {
  try {
    const result = await execa(command, args, {
      cwd: options.cwd || cwdDefault || process.cwd(),
      timeout: options.timeout || 30000,
      reject: false,
      env: options.env,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      failed: result.failed,
      exitCode: result.exitCode,
      success: !result.failed,
    };
  } catch (error) {
    return handleExecError(error, options);
  }
}

/**
 * Secure execution of npm commands with input validation
 */
export async function secureNpmExec(
  command: string,
  args: string[],
  options: SecureExecOptions = {}
): Promise<ExecResult> {
  // Validate npm command
  const allowedCommands = ['view', 'diff', 'ls', 'audit', 'info'];
  if (!allowedCommands.includes(command)) {
    throw new Error(`Unsafe npm command: ${command}`);
  }

  // Validate and sanitize arguments
  const safeArgs = args.map((arg) => {
    // Skip flags
    if (arg.startsWith('-')) {
      const allowedFlags = ['--json', '--depth', '--prod', '--dev', '--diff'];
      if (!allowedFlags.some((flag) => arg.startsWith(flag))) {
        throw new Error(`Unsafe flag: ${arg}`);
      }
      // For --diff flag, validate the package spec
      if (arg.startsWith('--diff=')) {
        const spec = arg.substring(7); // Remove '--diff='
        if (spec.includes('@') && !spec.startsWith('@')) {
          // Handle format: package@version
          const lastAtIndex = spec.lastIndexOf('@');
          const name = spec.substring(0, lastAtIndex);
          const version = spec.substring(lastAtIndex + 1);
          const safeName = validatePackageName(name);
          const safeVersion = validateVersion(version);
          return `--diff=${safeName}@${safeVersion}`;
        } else if (spec.startsWith('@')) {
          // Handle scoped packages
          const safeSpec = validatePackageName(spec);
          return `--diff=${safeSpec}`;
        }
      }
      return arg;
    }

    // Handle package specifications
    if (arg.includes('@') && !arg.startsWith('@')) {
      // Handle format: package@version
      const lastAtIndex = arg.lastIndexOf('@');
      const name = arg.substring(0, lastAtIndex);
      const version = arg.substring(lastAtIndex + 1);
      const safeName = validatePackageName(name);
      const safeVersion = validateVersion(version);
      return `${safeName}@${safeVersion}`;
    }

    // Handle scoped packages
    if (arg.startsWith('@')) {
      return validatePackageName(arg);
    }

    // Validate other arguments
    if (/^[a-zA-Z0-9._\-/]+$/.test(arg)) {
      return arg;
    }

    throw new Error(`Unsafe argument: ${arg}`);
  });

  return executeCommand('npm', [command, ...safeArgs], options, tmpdir());
}

/**
 * Secure execution of GitHub CLI commands
 */
export async function secureGhExec(
  args: string[],
  options: SecureExecOptions = {}
): Promise<ExecResult> {
  if (args.length === 0) {
    throw new Error('No gh command provided');
  }

  // Validate gh command
  const allowedCommands = ['pr', 'auth', 'api', 'repo', '--version'];
  if (!allowedCommands.includes(args[0])) {
    throw new Error(`Unsafe gh command: ${args[0]}`);
  }

  // Validate subcommands
  const commandValidation: Record<string, string[]> = {
    pr: ['view', 'comment', 'list', 'create', 'edit'],
    auth: ['status', 'login', 'logout', 'token'],
    api: [], // API calls need special handling
    repo: ['view', 'list', 'clone'],
  };

  if (args[0] in commandValidation && args.length > 1) {
    const allowedSubcommands = commandValidation[args[0]];
    if (allowedSubcommands.length > 0 && !allowedSubcommands.includes(args[1])) {
      throw new Error(`Unsafe gh subcommand: ${args[0]} ${args[1]}`);
    }
  }

  // Validate arguments (prevent injection)
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    // Allow flags
    if (arg.startsWith('-')) {
      continue;
    }

    // Allow numbers (PR numbers, etc.)
    if (/^\d+$/.test(arg)) {
      continue;
    }

    // Allow JSON for --json flag
    if (args[i - 1] === '--json' || args[i - 1] === '--body' || args[i - 1] === '--body-file') {
      continue;
    }

    // Validate other arguments
    if (!/^[a-zA-Z0-9._\-/:\s]+$/.test(arg)) {
      throw new Error(`Potentially unsafe gh argument: ${arg}`);
    }
  }

  return executeCommand('gh', args, options);
}

/**
 * Secure execution of git commands
 */
export async function secureGitExec(
  args: string[],
  options: SecureExecOptions = {}
): Promise<ExecResult> {
  if (args.length === 0) {
    throw new Error('No git command provided');
  }

  // Validate git command
  const allowedCommands = [
    'remote',
    'log',
    'diff',
    'status',
    'branch',
    'rev-parse',
    'show',
    'describe',
    'tag',
  ];

  if (!allowedCommands.includes(args[0])) {
    throw new Error(`Unsafe git command: ${args[0]}`);
  }

  // Validate arguments
  for (const arg of args.slice(1)) {
    // Allow flags
    if (arg.startsWith('-')) {
      continue;
    }

    // Validate other arguments (prevent injection)
    if (!/^[a-zA-Z0-9._\-/^~:]+$/.test(arg)) {
      throw new Error(`Potentially unsafe git argument: ${arg}`);
    }
  }

  return executeCommand('git', args, options);
}

/**
 * Secure execution of claude CLI commands
 */
export async function secureClaudeExec(
  args: string[],
  options: SecureExecOptions = {}
): Promise<ExecResult> {
  // Validate claude command arguments
  const allowedFlags = [
    '--version',
    '-p',
    '--max-turns',
    '--model',
    '--temperature',
    '--max-tokens',
  ];

  for (const arg of args) {
    if (arg.startsWith('-') && !allowedFlags.includes(arg.split('=')[0])) {
      throw new Error(`Unsafe claude flag: ${arg}`);
    }
  }

  return executeCommand('claude', args, { ...options, timeout: options.timeout || 60000 });
}

/**
 * Generic secure system command execution
 * Routes to appropriate specialized function based on command
 */
export async function secureSystemExec(
  command: string,
  args: string[],
  options: SecureExecOptions & { input?: string } = {}
): Promise<ExecResult> {
  switch (command) {
    case 'gh':
      return secureGhExec(args, options);
    case 'git':
      return secureGitExec(args, options);
    case 'claude':
      return secureClaudeExec(args, options);
    case 'npm':
      if (args.length === 0) {
        throw new Error('No npm command provided');
      }
      return secureNpmExec(args[0], args.slice(1), options);
    case 'yarn':
      return secureYarnExec(args, options);
    case 'find':
      return secureFindExec(args, options);
    default:
      throw new Error(`Unsupported command: ${command}`);
  }
}

/**
 * Secure execution of yarn commands
 */
async function secureYarnExec(
  args: string[],
  options: SecureExecOptions = {}
): Promise<ExecResult> {
  if (args.length === 0) {
    throw new Error('No yarn command provided');
  }

  // Validate yarn command
  const allowedCommands = ['why', 'list', 'info', 'outdated'];
  if (!allowedCommands.includes(args[0])) {
    throw new Error(`Unsafe yarn command: ${args[0]}`);
  }

  // Basic argument validation
  for (const arg of args.slice(1)) {
    if (arg.startsWith('-')) continue; // Allow flags
    if (!/^[a-zA-Z0-9@._\-/]+$/.test(arg)) {
      throw new Error(`Potentially unsafe yarn argument: ${arg}`);
    }
  }

  return executeCommand('yarn', args, options);
}

/**
 * Secure execution of find commands (limited subset)
 */
async function secureFindExec(
  args: string[],
  options: SecureExecOptions = {}
): Promise<ExecResult> {
  // Very restrictive find validation
  const safeArgs = args.filter((arg) => {
    // Allow basic directory and name patterns
    return (
      /^[\w.\-/*]+$/.test(arg) ||
      arg === '-name' ||
      arg === '-not' ||
      arg === '-path' ||
      arg === '-type' ||
      arg === 'f' ||
      arg === 'd'
    );
  });

  if (safeArgs.length !== args.length) {
    throw new Error('Potentially unsafe find arguments detected');
  }

  return executeCommand('find', args, { ...options, timeout: options.timeout || 15000 });
}

/**
 * Helper to check if a command succeeded
 */
export function isSuccessful(result: ExecResult): boolean {
  return !result.failed && result.exitCode === 0;
}

/**
 * Helper to parse JSON output safely
 */
export function parseJsonOutput<T = unknown>(output: string): T | null {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}
