#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'path';
import { homedir } from 'os';
import { CLIOptions, AnalysisResult, RiskAssessment } from './types/index.js';
import { runDoctorCheck } from './lib/doctor.js';
import { loadConfig } from './lib/config.js';
import { getEnvironmentConfig } from './lib/env-config.js';
import { getErrorMessage } from './analyzers/utils.js';
import { loggers } from './lib/logger.js';
import { logSection, logListItem, logProgress, logWarningMessage, logError, logSeparator } from './lib/logger-extended.js';
import {
  extractPackageInformation,
  checkShouldSkipPatchUpdate,
  findAppropriateAnalyzer,
  fetchChangelogAndKnowledge,
  fetchCodeDifference,
  analyzeDependencyUsageStep,
  analyzePackageUsageStep,
  extractBreakingChangesStep,
  performLLMAnalysis,
  convertUsageAnalysisToApiUsages,
  performDeepAnalysisStep,
  generateAnalysisResult,
  generateAndDisplayReport,
  handlePRPosting,
} from './lib/analysis-steps.js';

// Import new analyzer system
import './analyzers/index.js';

const program = new Command();

program
  .name('renovate-safety')
  .description('Analyze dependency update PRs for breaking changes')
  .version('1.1.0');

// Doctor subcommand
program
  .command('doctor')
  .description('Check if environment is ready for renovate-safety')
  .action(async () => {
    await runDoctorCheck();
  });

// Main analysis command
program
  .command('analyze', { isDefault: true })
  .description('Analyze dependency update PRs for breaking changes')
  .option('-p, --pr <number>', 'PR number to analyze', parseInt)
  .option('--from <version>', 'From version (manual override)')
  .option('--to <version>', 'To version (manual override)')
  .option('--package <name>', 'Package name (manual override)')
  .option('--post <mode>', 'Post mode: always (default), update (overwrite existing), never', 'always')
  .option('--no-llm', 'Skip LLM summarization')
  .option('--llm <provider>', 'LLM provider (claude-cli|anthropic|openai)', /^(claude-cli|anthropic|openai)$/i)
  .option('--cache-dir <path>', 'Cache directory', resolve(homedir(), '.renovate-safety-cache'))
  .option('--json', 'Output as JSON instead of Markdown', false)
  .option('--force', 'Force analysis even for patch updates', false)
  .option('--language <lang>', 'Language for AI analysis (en|ja)', /^(en|ja)$/i, getEnvironmentConfig().language)
  .option('--deep', 'Perform deep code analysis', false)
  .action(async (options) => {
    await analyzeCommand(options);
  });

// Legacy support - if no subcommand provided, treat as analyze
const args = process.argv.slice(2);
if (args.length > 0 && !['doctor', 'analyze'].includes(args[0]) && !args[0].startsWith('-')) {
  // If first arg is not a subcommand or option, prepend 'analyze'
  process.argv.splice(2, 0, 'analyze');
}

program.parse(process.argv);

async function analyzeCommand(options: CLIOptions) {
  // Load config from files and environment
  const config = await loadConfig();
  
  // Merge config with CLI options (CLI options take precedence)
  if (!options.language && config.language) {
    options.language = config.language;
  }
  if (!options.llm && config.llmProvider) {
    options.llm = config.llmProvider;
  }
  if (!options.cacheDir && config.cacheDir) {
    options.cacheDir = config.cacheDir;
  }
  
  loggers.info(chalk.gray(`- Language setting: ${options.language || 'en'}`));
  loggers.info(chalk.gray(`- Using enhanced analyzer system v1.1`));
  
  // Ensure we're in a git repository
  try {
    await import('fs/promises').then(fs => fs.access('.git'));
  } catch {
    logError('Error: Not in a git repository. Please run from the root of your project.');
    process.exit(1);
  }
  
  // If no PR specified and no manual package info, analyze all Renovate PRs
  if (!options.pr && !options.package) {
    await analyzeAllRenovatePRs(options);
    return;
  }
  
  try {
    await analyzeSinglePR(options);
  } catch (error) {
    // analyzeSinglePR already handles error logging and process exit
    // Re-throwing is handled internally, so we can safely ignore here
    logError('Analysis completed with errors', error);
  }
}


export function generateRecommendation(riskAssessment: RiskAssessment, breakingCount: number, usageCount: number, language: 'en' | 'ja' = 'en'): string {
  const isJa = language === 'ja';
  switch (riskAssessment.level) {
    case 'safe':
      return isJa ? '破壊的変更は検出されていないため、マージして問題ない見込みです。' : 'This update appears safe to merge. No breaking changes detected.';
    case 'low':
      return isJa
        ? `低リスクの更新です。破壊的変更の候補は ${breakingCount} 件ありますが、直接の使用は検出されていません。必要工数: ${riskAssessment.estimatedEffort}`
        : `Low risk update. Found ${breakingCount} potential breaking changes but no direct usage in codebase. ${riskAssessment.estimatedEffort} effort required.`;
    case 'medium':
      return isJa
        ? `中リスクの更新です。破壊的変更が ${breakingCount} 件あり、最大で ${usageCount} 箇所に影響する可能性があります。必要工数: ${riskAssessment.estimatedEffort}、推奨テスト範囲: ${riskAssessment.testingScope}`
        : `Medium risk update. Found ${breakingCount} breaking changes potentially affecting ${usageCount} locations. ${riskAssessment.estimatedEffort} effort with ${riskAssessment.testingScope} testing recommended.`;
    case 'high':
      return isJa
        ? `高リスクの更新です。破壊的変更が ${breakingCount} 件検出され、${usageCount} 箇所に影響します。必要工数: ${riskAssessment.estimatedEffort}、必要テスト範囲: ${riskAssessment.testingScope}`
        : `High risk update. Found ${breakingCount} breaking changes affecting ${usageCount} locations in codebase. ${riskAssessment.estimatedEffort} effort with ${riskAssessment.testingScope} testing required.`;
    case 'critical':
      return isJa
        ? `クリティカルな更新です。破壊的変更が ${breakingCount} 件検出され、${usageCount} 箇所に影響します。必要工数: ${riskAssessment.estimatedEffort}、必要テスト範囲: ${riskAssessment.testingScope}。手動での対応を強く推奨します。`
        : `Critical risk update. Found ${breakingCount} breaking changes affecting ${usageCount} locations. Requires ${riskAssessment.estimatedEffort} effort and ${riskAssessment.testingScope} testing. Manual intervention strongly recommended.`;
    case 'unknown':
      return isJa
        ? `情報不足のためリスクレベルを特定できません。潜在的な問題が ${breakingCount} 件あります。手動での確認を推奨します。`
        : `Risk level unknown due to insufficient information. Found ${breakingCount} potential issues. Manual review strongly recommended.`;
    default:
      return 'Unknown risk level.';
  }
}

async function analyzeAllRenovatePRs(options: CLIOptions) {
  const spinner = ora('Searching for Renovate PRs...').start();
  
  try {
    // Get all open PRs from Renovate
    const { getRenovatePRs } = await import('./lib/pr.js');
    const prs = await getRenovatePRs();
    
    if (prs.length === 0) {
      spinner.fail('No open Renovate PRs found');
      logWarningMessage('\nTip: Use --pr <number> to analyze a specific PR');
      process.exit(0);
    }
    
    spinner.succeed(`Found ${prs.length} Renovate PR${prs.length > 1 ? 's' : ''}`);
    
    // Display PR list
    logSection('Renovate PRs to analyze:', '📋');
    for (const pr of prs) {
      logListItem(`#${pr.number}: ${pr.title}`);
    }
    
    // Analyze each PR
    let hasReviewRequired = false;
    const results: Array<{ pr: any; result: AnalysisResult }> = [];
    
    for (let i = 0; i < prs.length; i++) {
      const pr = prs[i];
      logProgress(i + 1, prs.length, `Analyzing PR #${pr.number}: ${pr.title}`);
      
      try {
        // Analyze single PR
        const result = await analyzeSinglePR({ ...options, pr: pr.number }, false);
        results.push({ pr, result });
        
        if (result.riskAssessment.level === 'high' || result.riskAssessment.level === 'critical') {
          hasReviewRequired = true;
        }
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        logError(`Failed to analyze PR #${pr.number}: ${errorMsg}`);
        
        // Provide helpful message for common issues
        if (errorMsg.includes('Could not extract package information')) {
          logWarningMessage('ℹ️  This might be a non-JavaScript package. Currently only npm packages are fully supported.');
        } else if (errorMsg.includes('Invalid Version')) {
          logWarningMessage('ℹ️  Version format not recognized. This tool expects semver-compatible versions.');
        }
      }
    }
    
    // Summary
    logSection('Summary', '📊');
    logSeparator('=', 60);
    
    const safeCount = results.filter(r => r.result.riskAssessment.level === 'safe').length;
    const lowCount = results.filter(r => r.result.riskAssessment.level === 'low').length;
    const reviewCount = results.filter(r => ['medium', 'high', 'critical', 'unknown'].includes(r.result.riskAssessment.level)).length;
    
    loggers.info(`✅ Safe: ${safeCount}`);
    loggers.info(`⚠️  Low Risk: ${lowCount}`);
    loggers.info(`🔍 Review Required: ${reviewCount}`);
    logSeparator('=', 60);
    
    // Exit with error if any PR requires review
    process.exit(hasReviewRequired ? 1 : 0);
    
  } catch (error) {
    spinner.fail('Failed to analyze Renovate PRs');
    logError('Error:', error);
    process.exit(1);
  }
}

async function analyzeSinglePR(options: CLIOptions, exitOnComplete: boolean = true): Promise<AnalysisResult> {
  let spinner = ora('Starting renovate-safety analysis').start();
  
  try {
    // Step 1: Extract package information
    const packageUpdate = await extractPackageInformation(spinner, options, exitOnComplete);
    
    // Check if we should skip patch updates
    const skipResult = await checkShouldSkipPatchUpdate(packageUpdate, options, exitOnComplete);
    if (skipResult) return skipResult;
    
    // Step 2: Find appropriate analyzer
    const analyzer = await findAppropriateAnalyzer(spinner, packageUpdate);
    
    // Step 3: Fetch changelog/diff using analyzer or fallback
    const { changelogDiff, knowledgeBasedBreaking } = await fetchChangelogAndKnowledge(spinner, analyzer, packageUpdate, options);
    
    // Step 4: Fetch code diff from GitHub
    const codeDiff = await fetchCodeDifference(spinner, packageUpdate);
    
    // Step 5: Analyze dependency usage
    const dependencyUsage = await analyzeDependencyUsageStep(spinner, packageUpdate);
    
    // Step 6: Analyze package usage with new analyzer
    const usageAnalysis = await analyzePackageUsageStep(spinner, analyzer, packageUpdate);
    
    // Step 7: Extract breaking changes
    const breakingChanges = await extractBreakingChangesStep(spinner, changelogDiff, codeDiff, knowledgeBasedBreaking);
    
    // Step 8: Enhanced LLM analysis
    const llmSummary = await performLLMAnalysis(spinner, options, {
      packageUpdate,
      changelogDiff,
      codeDiff,
      dependencyUsage,
      breakingChanges,
      knowledgeBasedBreaking,
    });
    
    // Step 9: Convert usage analysis to API usages for compatibility
    const apiUsages = convertUsageAnalysisToApiUsages(usageAnalysis, packageUpdate);
    
    // Step 10: Deep analysis (optional)
    const deepAnalysis = await performDeepAnalysisStep(spinner, options, packageUpdate, breakingChanges);
    
    // Step 11: Enhanced risk assessment and result generation
    const analysisResult = await generateAnalysisResult({
      packageUpdate,
      changelogDiff,
      codeDiff,
      dependencyUsage,
      breakingChanges,
      llmSummary,
      apiUsages,
      deepAnalysis,
      usageAnalysis,
    }, options);
    
    // Generate and display report
    await generateAndDisplayReport(analysisResult, options);
    
    // Handle PR posting
    await handlePRPosting(spinner, options, analysisResult);
    
    if (exitOnComplete) {
      process.exit(analysisResult.riskAssessment.level === 'high' || analysisResult.riskAssessment.level === 'critical' ? 1 : 0);
    }
    
    return analysisResult;
    
  } catch (error) {
    spinner.fail('Analysis failed');
    logError('Error:', error);
    if (exitOnComplete) process.exit(1);
    throw error;
  }
}

// Entry point handled by commander
