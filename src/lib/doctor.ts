import chalk from 'chalk';
import * as fs from 'fs/promises';
import { secureSystemExec } from './secure-exec.js';
import { getFiles, getSourceFiles } from './glob-helpers.js';

interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  suggestion?: string;
}

export async function runDoctorCheck(): Promise<void> {
  console.log(chalk.bold('\n🏥 Renovate Safety Doctor\n'));

  const checks: HealthCheck[] = [];

  // Check 1: Git repository
  checks.push(await checkGitRepository());

  // Check 2: GitHub CLI
  checks.push(await checkGitHubCLI());

  // Check 3: LLM providers (in priority order)
  checks.push(await checkClaudeCLI());
  checks.push(await checkAnthropicAPI());
  checks.push(await checkOpenAIAPI());

  // Check 4: Node.js version
  checks.push(await checkNodeVersion());

  // Check 5: TypeScript/JavaScript files
  checks.push(await checkSourceFiles());

  // Display results
  displayResults(checks);

  // Summary
  const hasErrors = checks.some((check) => check.status === 'error');
  const hasWarnings = checks.some((check) => check.status === 'warning');

  console.log('\n' + '='.repeat(60));

  if (hasErrors) {
    console.log(chalk.red('❌ Critical issues found. Please fix the errors above.'));
    process.exit(1);
  } else if (hasWarnings) {
    console.log(chalk.yellow('⚠️  Some warnings found. Review the suggestions above.'));
    console.log(chalk.green('✅ Ready to use renovate-safety with basic features.'));
  } else {
    console.log(chalk.green('✅ All checks passed! Ready to use renovate-safety.'));
  }
}

async function checkGitRepository(): Promise<HealthCheck> {
  try {
    await fs.access('.git');

    // Check if it's a GitHub repository
    try {
      const result = await secureSystemExec('git', ['remote', 'get-url', 'origin']);
      if (result.success && result.stdout.includes('github.com')) {
        return {
          name: 'Git Repository',
          status: 'ok',
          message: 'In a GitHub repository',
        };
      } else {
        return {
          name: 'Git Repository',
          status: 'warning',
          message: 'In a git repository, but not GitHub',
          suggestion: 'Some features (PR analysis) may not work without GitHub',
        };
      }
    } catch {
      return {
        name: 'Git Repository',
        status: 'warning',
        message: 'In a git repository, but no remote origin',
        suggestion: 'Add GitHub remote for PR analysis features',
      };
    }
  } catch {
    return {
      name: 'Git Repository',
      status: 'error',
      message: 'Not in a git repository',
      suggestion: 'Run renovate-safety from the root of your project',
    };
  }
}

async function checkGitHubCLI(): Promise<HealthCheck> {
  try {
    const versionResult = await secureSystemExec('gh', ['--version']);
    
    if (!versionResult.success) {
      throw new Error('gh command failed');
    }
    
    const versionMatch = /gh version (\d+\.\d+\.\d+)/.exec(versionResult.stdout);

    if (versionMatch) {
      const version = versionMatch[1];
      try {
        const authResult = await secureSystemExec('gh', ['auth', 'status']);
        if (authResult.success) {
          return {
            name: 'GitHub CLI',
            status: 'ok',
            message: `Installed and authenticated (v${version})`,
          };
        } else {
          return {
            name: 'GitHub CLI',
            status: 'warning',
            message: `Installed (v${version}) but not authenticated`,
            suggestion: 'Run "gh auth login" to enable PR features',
          };
        }
      } catch {
        return {
          name: 'GitHub CLI',
          status: 'warning',
          message: `Installed (v${version}) but not authenticated`,
          suggestion: 'Run "gh auth login" to enable PR features',
        };
      }
    } else {
      return {
        name: 'GitHub CLI',
        status: 'warning',
        message: 'Installed but version unknown',
        suggestion: 'Update to latest version for best compatibility',
      };
    }
  } catch {
    return {
      name: 'GitHub CLI',
      status: 'warning',
      message: 'Not installed',
      suggestion: 'Install from https://cli.github.com/ to enable PR features',
    };
  }
}

async function checkClaudeCLI(): Promise<HealthCheck> {
  try {
    const versionResult = await secureSystemExec('claude', ['--version']);
    
    if (!versionResult.success) {
      throw new Error('claude command failed');
    }

    // Check if logged in by trying a simple command
    try {
      const testResult = await secureSystemExec('claude', ['-p', 'test', '--max-turns', '1'], {
        timeout: 5000,
        input: 'test',
      });
      
      if (testResult.success) {
        return {
          name: 'Claude CLI (Priority 1)',
          status: 'ok',
          message: 'Installed and ready - will be used for AI analysis (Max Plan subscription)',
        };
      } else {
        const errorMsg = testResult.error || 'Unknown error';
        if (errorMsg.includes('not logged in') || errorMsg.includes('authentication')) {
          return {
            name: 'Claude CLI (Priority 1)',
            status: 'warning',
            message: 'Installed but not authenticated',
            suggestion: 'Run "claude login" to enable AI analysis for Pro/Max users',
          };
        } else {
          return {
            name: 'Claude CLI (Priority 1)',
            status: 'ok',
            message: 'Installed and ready - will be used for AI analysis (Max Plan subscription)',
          };
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.includes('not logged in') || errorMsg.includes('authentication')) {
        return {
          name: 'Claude CLI (Priority 1)',
          status: 'warning',
          message: 'Installed but not authenticated',
          suggestion: 'Run "claude login" to enable AI analysis for Pro/Max users',
        };
      } else {
        return {
          name: 'Claude CLI (Priority 1)',
          status: 'ok',
          message: 'Installed and ready - will be used for AI analysis (Max Plan subscription)',
        };
      }
    }
  } catch {
    return {
      name: 'Claude CLI (Priority 1)',
      status: 'warning',
      message: 'Not installed',
      suggestion: 'Install Claude CLI to use your Max Plan subscription (no API costs)',
    };
  }
}

async function checkAnthropicAPI(): Promise<HealthCheck> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    if (apiKey.startsWith('sk-ant-')) {
      return {
        name: 'Anthropic API (Priority 2)',
        status: 'ok',
        message: 'API key configured - will be used if Claude CLI unavailable',
      };
    } else {
      return {
        name: 'Anthropic API (Priority 2)',
        status: 'error',
        message: 'Invalid API key format',
        suggestion: 'Set valid ANTHROPIC_API_KEY from https://console.anthropic.com/',
      };
    }
  } else {
    return {
      name: 'Anthropic API (Priority 2)',
      status: 'warning',
      message: 'No API key found',
      suggestion: 'Set ANTHROPIC_API_KEY environment variable for API access',
    };
  }
}

async function checkOpenAIAPI(): Promise<HealthCheck> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey) {
    if (apiKey.startsWith('sk-')) {
      return {
        name: 'OpenAI API (Priority 3)',
        status: 'ok',
        message: 'API key configured - will be used as fallback',
      };
    } else {
      return {
        name: 'OpenAI API (Priority 3)',
        status: 'error',
        message: 'Invalid API key format',
        suggestion: 'Set valid OPENAI_API_KEY from https://platform.openai.com/',
      };
    }
  } else {
    return {
      name: 'OpenAI API (Priority 3)',
      status: 'warning',
      message: 'No API key found',
      suggestion: 'Set OPENAI_API_KEY environment variable for fallback AI access',
    };
  }
}

async function checkNodeVersion(): Promise<HealthCheck> {
  const version = process.version;
  const majorVersion = parseInt(version.slice(1).split('.')[0]);

  if (majorVersion >= 18) {
    return {
      name: 'Node.js Version',
      status: 'ok',
      message: `Node.js ${version} (supported)`,
    };
  } else {
    return {
      name: 'Node.js Version',
      status: 'error',
      message: `Node.js ${version} (unsupported)`,
      suggestion: 'Upgrade to Node.js 18 or higher',
    };
  }
}

async function checkSourceFiles(): Promise<HealthCheck> {
  let jsFileCount = 0;
  let pyFileCount = 0;

  // Check JavaScript/TypeScript files
  try {
    const jsFiles = await getSourceFiles(process.cwd(), 'node');
    jsFileCount = jsFiles.length;
  } catch {
    // Ignore errors
  }

  // Check Python files
  try {
    const pyFiles = await getSourceFiles(process.cwd(), 'python');
    pyFileCount = pyFiles.length;
  } catch {
    // Ignore errors
  }

  const totalFiles = jsFileCount + pyFileCount;

  if (totalFiles > 0) {
    const fileTypes = [];
    if (jsFileCount > 0) fileTypes.push(`${jsFileCount} TypeScript/JavaScript`);
    if (pyFileCount > 0) fileTypes.push(`${pyFileCount} Python`);

    return {
      name: 'Source Files',
      status: 'ok',
      message: `Found ${fileTypes.join(' and ')} files for analysis`,
    };
  } else {
    return {
      name: 'Source Files',
      status: 'warning',
      message: 'No supported source files found',
      suggestion:
        "Make sure you're in the right directory with TypeScript/JavaScript or Python files",
    };
  }
}

function displayResults(checks: HealthCheck[]): void {
  for (const check of checks) {
    const icon = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
    const color =
      check.status === 'ok' ? chalk.green : check.status === 'warning' ? chalk.yellow : chalk.red;

    console.log(`${icon} ${chalk.bold(check.name)}: ${color(check.message)}`);

    if (check.suggestion) {
      console.log(`   ${chalk.gray('💡 ' + check.suggestion)}`);
    }
    console.log();
  }
}
