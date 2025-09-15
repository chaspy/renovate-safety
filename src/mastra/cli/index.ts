#!/usr/bin/env node

import { program } from 'commander';
import { execSync } from 'child_process';
import { analyzeRenovatePR } from '../workflows/analyze-renovate-pr.js';
import { validateConfig } from '../config/index.js';

program
  .name('renovate-safety')
  .description('Analyze Renovate PRs for breaking changes and risks')
  .version('2.0.0');

program
  .command('agent')
  .description('Mastra agent commands')
  .command('analyze')
  .description('Analyze a Renovate PR')
  .option('-p, --pr <number>', 'PR number to analyze', parseInt)
  .option('--post <mode>', 'Post mode: always|update|never', 'always')
  .option('--format <format>', 'Output format: markdown|json', 'markdown')
  .option('--language <lang>', 'Language: en|ja', 'en')
  .option('--threshold <score>', 'Risk threshold for auto-merge', parseInt, 1)
  .option('--concurrency <number>', 'Number of dependencies to analyze in parallel', parseInt, 3)
  .action(async (options) => {
    await handleAnalyzeCommand(options, false);
  });

// Legacy commands for backward compatibility
program
  .command('doctor')
  .description('Check environment setup')
  .action(async () => {
    try {
      validateConfig();
      console.log('✅ Environment setup is valid');
      console.log('  - OpenAI API key: configured');
      console.log('  - GitHub access: available');
      console.log('  - Mastra: initialized');
      process.exit(0);
    } catch (error) {
      console.error('❌ Environment check failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Support legacy analyze command (without agent subcommand)
program
  .command('analyze')
  .description('Legacy: Analyze a Renovate PR (use "agent analyze" instead)')
  .option('-p, --pr <number>', 'PR number to analyze', parseInt)
  .option('--post <mode>', 'Post mode: always|update|never', 'always')
  .option('--format <format>', 'Output format: markdown|json', 'markdown')
  .option('--language <lang>', 'Language: en|ja', 'en')
  .option('--threshold <score>', 'Risk threshold for auto-merge', parseInt, 1)
  .option('--concurrency <number>', 'Number of dependencies to analyze in parallel', parseInt, 3)
  .action(async (options) => {
    console.warn('⚠️ Using legacy command. Use "renovate-safety agent analyze" instead.');
    await handleAnalyzeCommand(options, true);
  });

program.parse(process.argv);

// Helper function to get and validate PR number
async function getPRNumber(options: any, isLegacy: boolean): Promise<number> {
  const prNumber = options.pr || await detectCurrentPR();

  if (!prNumber) {
    console.error('❌ No PR number provided and could not detect from current branch');
    const command = isLegacy ? 'renovate-safety analyze' : 'renovate-safety agent analyze';
    console.error(`💡 Use: ${command} --pr <number>`);
    process.exit(1);
  }

  return prNumber;
}

// Helper function to output results
function outputResults(result: any, format: string): void {
  if (format === 'json') {
    const output = result.report.format === 'json' ? result.report.json : JSON.stringify(result);
    console.log(output);
  } else {
    const output = result.report.format === 'markdown' ? result.report.markdown : JSON.stringify(result);
    console.log('\n' + output);
  }
}

// Helper function to handle exit based on risk score
function handleExitBasedOnRisk(result: any, threshold: number): void {
  const riskScore = getRiskScore(result.overallRisk);

  if (riskScore <= threshold) {
    console.log(`✅ Risk score ${riskScore} is within threshold ${threshold}`);
    process.exit(0);
  } else {
    console.log(`⚠️ Risk score ${riskScore} exceeds threshold ${threshold}`);
    process.exit(1);
  }
}

// Shared function to handle analyze command logic
async function handleAnalyzeCommand(options: any, isLegacy: boolean = false): Promise<void> {
  try {
    // Validate configuration
    console.log('🔧 Validating configuration...');
    validateConfig();

    // Get PR number
    const prNumber = await getPRNumber(options, isLegacy);

    console.log(`🔍 Analyzing PR #${prNumber}...`);
    console.log('DEBUG - CLI working directory:', process.cwd());

    // Run workflow
    const result = await analyzeRenovatePR({
      prNumber,
      postMode: options.post,
      format: options.format,
      language: options.language,
      threshold: options.threshold,
      concurrency: options.concurrency,
    });

    // Output results
    outputResults(result, options.format);

    // Exit code based on risk
    handleExitBasedOnRisk(result, options.threshold);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    if (!isLegacy && error instanceof Error && error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

async function detectCurrentPR(): Promise<number | null> {
  try {
    // Try to detect PR from current git branch
    const result = execSync('git branch --show-current', { encoding: 'utf8' });
    const branch = result.trim();
    
    // Check if branch matches renovate pattern
    const match = branch.match(/renovate\/.*-(\d+)$|renovate\/.*|(\d+)/);
    if (match) {
      // Try to extract PR number from branch name
      const prNumber = match[1] || match[2];
      if (prNumber) {
        return parseInt(prNumber, 10);
      }
    }
    
    // Try gh CLI to get PR for current branch
    try {
      const ghResult = execSync('gh pr view --json number', { encoding: 'utf8' });
      const prData = JSON.parse(ghResult);
      return prData.number;
    } catch {
      // gh command failed, continue
    }
    
    return null;
  } catch {
    return null;
  }
}

function getRiskScore(level: string): number {
  switch (level) {
    case 'safe': return 0;
    case 'low': return 1;
    case 'medium': return 3;
    case 'high': return 5;
    case 'critical': return 10;
    default: return 5;
  }
}