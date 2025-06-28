#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'path';
import { homedir } from 'os';
import { CLIOptions, AnalysisResult, RiskLevel } from './types/index.js';
import { extractPackageInfo } from './lib/pr.js';
import { fetchChangelogDiff } from './lib/changelog.js';
import { extractBreakingChanges } from './lib/breaking.js';
import { summarizeWithLLM } from './lib/llm.js';
import { scanAPIUsage } from './lib/scan.js';
import { assessRisk } from './lib/grade.js';
import { generateReport } from './lib/report.js';
import { postToPR } from './lib/post.js';

const program = new Command();

program
  .name('renovate-safety')
  .description('Analyze dependency update PRs for breaking changes')
  .version('1.0.0')
  .option('-p, --pr <number>', 'PR number to analyze', parseInt)
  .option('--from <version>', 'From version (manual override)')
  .option('--to <version>', 'To version (manual override)')
  .option('--package <name>', 'Package name (manual override)')
  .option('--post', 'Post report as PR comment', false)
  .option('--no-llm', 'Skip LLM summarization')
  .option('--llm <provider>', 'LLM provider (anthropic|openai)', /^(anthropic|openai)$/i)
  .option('--cache-dir <path>', 'Cache directory', resolve(homedir(), '.renovate-safety-cache'))
  .option('--json', 'Output as JSON instead of Markdown', false)
  .option('--force', 'Force analysis even for patch updates', false)
  .parse(process.argv);

async function main() {
  const options = program.opts<CLIOptions>();
  
  let spinner = ora('Starting renovate-safety analysis').start();
  
  try {
    // Step 1: Extract package information
    spinner.text = 'Extracting package information...';
    const packageUpdate = await extractPackageInfo(options);
    
    if (!packageUpdate) {
      spinner.fail('Could not determine package information');
      process.exit(1);
    }
    
    spinner.succeed(`Analyzing ${packageUpdate.name}: ${packageUpdate.fromVersion} → ${packageUpdate.toVersion}`);
    
    // Check if we should skip patch updates
    if (!options.force && await isPatchUpdate(packageUpdate.fromVersion, packageUpdate.toVersion)) {
      console.log(chalk.yellow('Skipping patch update (use --force to analyze)'));
      process.exit(0);
    }
    
    // Step 2: Fetch changelog diff
    spinner = ora('Fetching changelog differences...').start();
    const changelogDiff = await fetchChangelogDiff(packageUpdate, options.cacheDir);
    
    if (!changelogDiff) {
      spinner.warn('No changelog found');
    } else {
      spinner.succeed(`Fetched changelog from ${changelogDiff.source}`);
    }
    
    // Step 3: Extract breaking changes
    spinner = ora('Analyzing for breaking changes...').start();
    const breakingChanges = changelogDiff ? extractBreakingChanges(changelogDiff.content) : [];
    
    if (breakingChanges.length > 0) {
      spinner.succeed(`Found ${breakingChanges.length} potential breaking changes`);
    } else {
      spinner.succeed('No breaking changes detected');
    }
    
    // Step 4: LLM summarization
    let llmSummary = null;
    if (!options.noLlm && changelogDiff) {
      spinner = ora('Generating AI summary...').start();
      llmSummary = await summarizeWithLLM(
        packageUpdate,
        changelogDiff,
        breakingChanges,
        options.llm,
        options.cacheDir
      );
      
      if (llmSummary) {
        spinner.succeed('Generated AI summary');
      } else {
        spinner.warn('AI summary generation failed');
      }
    }
    
    // Step 5: Scan API usage
    spinner = ora('Scanning codebase for API usage...').start();
    const apiUsages = await scanAPIUsage(packageUpdate.name, breakingChanges);
    
    if (apiUsages.length > 0) {
      spinner.succeed(`Found ${apiUsages.length} API usage locations`);
    } else {
      spinner.succeed('No direct API usage found');
    }
    
    // Step 6: Assess risk
    const riskLevel = assessRisk(breakingChanges, apiUsages, llmSummary);
    
    // Step 7: Generate analysis result
    const analysisResult: AnalysisResult = {
      package: packageUpdate,
      changelogDiff,
      breakingChanges,
      llmSummary,
      apiUsages,
      riskLevel,
      recommendation: generateRecommendation(riskLevel, breakingChanges.length, apiUsages.length)
    };
    
    // Step 8: Generate report
    const report = generateReport(analysisResult, options.json ? 'json' : 'markdown');
    
    // Output report
    console.log('\n' + report);
    
    // Step 9: Post to PR if requested
    if (options.post && options.pr) {
      spinner = ora('Posting report to PR...').start();
      await postToPR(options.pr, report);
      spinner.succeed('Posted report to PR');
    }
    
    // Exit with appropriate code
    process.exit(riskLevel === 'review' ? 1 : 0);
    
  } catch (error) {
    spinner.fail('Analysis failed');
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function isPatchUpdate(fromVersion: string, toVersion: string): Promise<boolean> {
  const semver = await import('semver');
  const fromMajor = semver.major(fromVersion);
  const fromMinor = semver.minor(fromVersion);
  const toMajor = semver.major(toVersion);
  const toMinor = semver.minor(toVersion);
  
  return fromMajor === toMajor && fromMinor === toMinor;
}

function generateRecommendation(riskLevel: RiskLevel, breakingCount: number, usageCount: number): string {
  switch (riskLevel) {
    case 'safe':
      return 'This update appears safe to merge. No breaking changes detected.';
    case 'low':
      return `Low risk update. Found ${breakingCount} potential breaking changes but no direct usage in codebase.`;
    case 'review':
      return `Manual review required. Found ${breakingCount} breaking changes affecting ${usageCount} locations in codebase.`;
    default:
      return 'Unknown risk level.';
  }
}

main().catch(console.error);