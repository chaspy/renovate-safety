#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'path';
import { homedir } from 'os';
import { CLIOptions, AnalysisResult, RiskAssessment, DeepAnalysisResult } from './types/index.js';
import { extractPackageInfo } from './lib/pr.js';
import { extractBreakingChanges } from './lib/breaking.js';
import { enhancedLLMAnalysis } from './lib/llm.js';
import { fetchCodeDiff } from './lib/github-diff.js';
import { analyzeDependencyUsage } from './lib/dependency-tree.js';
import { performDeepAnalysis } from './lib/deep-analysis.js';
import { assessEnhancedRisk } from './lib/enhanced-grade.js';
import { generateEnhancedReport } from './lib/enhanced-report.js';
import { postToPR } from './lib/post.js';
import { runDoctorCheck } from './lib/doctor.js';
import { loadConfig } from './lib/config.js';
import { getEnvironmentConfig } from './lib/env-config.js';
import { packageKnowledgeBase } from './lib/package-knowledge.js';
import { getErrorMessage } from './analyzers/utils.js';
import { loggers } from './lib/logger.js';
import { logSection, logListItem, logProgress, logWarningMessage, logError, logSeparator } from './lib/logger-extended.js';

// Import new analyzer system
import './analyzers/index.js';
import { analyzerRegistry, UsageAnalysis } from './analyzers/base.js';
import { createDefaultAnalysisChain } from './analyzers/strategies/index.js';

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
    // Error handling is done in analyzeSinglePR
  }
}

async function isPatchUpdate(fromVersion: string, toVersion: string): Promise<boolean> {
  const semver = await import('semver');
  
  try {
    // Coerce versions to handle partial versions like "16" -> "16.0.0"
    const from = semver.coerce(fromVersion);
    const to = semver.coerce(toVersion);
    
    if (!from || !to) {
      return false;
    }
    
    const fromMajor = semver.major(from);
    const fromMinor = semver.minor(from);
    const toMajor = semver.major(to);
    const toMinor = semver.minor(to);
    
    return fromMajor === toMajor && fromMinor === toMinor;
  } catch {
    return false;
  }
}

function generateRecommendation(riskAssessment: RiskAssessment, breakingCount: number, usageCount: number): string {
  switch (riskAssessment.level) {
    case 'safe':
      return 'This update appears safe to merge. No breaking changes detected.';
    case 'low':
      return `Low risk update. Found ${breakingCount} potential breaking changes but no direct usage in codebase. ${riskAssessment.estimatedEffort} effort required.`;
    case 'medium':
      return `Medium risk update. Found ${breakingCount} breaking changes potentially affecting ${usageCount} locations. ${riskAssessment.estimatedEffort} effort with ${riskAssessment.testingScope} testing recommended.`;
    case 'high':
      return `High risk update. Found ${breakingCount} breaking changes affecting ${usageCount} locations in codebase. ${riskAssessment.estimatedEffort} effort with ${riskAssessment.testingScope} testing required.`;
    case 'critical':
      return `Critical risk update. Found ${breakingCount} breaking changes affecting ${usageCount} locations. Requires ${riskAssessment.estimatedEffort} effort and ${riskAssessment.testingScope} testing. Manual intervention strongly recommended.`;
    case 'unknown':
      return `Risk level unknown due to insufficient information. Found ${breakingCount} potential issues. Manual review strongly recommended.`;
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
    spinner.text = 'Extracting package information...';
    const packageUpdate = await extractPackageInfo(options);
    
    if (!packageUpdate) {
      spinner.fail('Could not determine package information');
      if (exitOnComplete) process.exit(1);
      throw new Error('Could not determine package information');
    }
    
    spinner.succeed(`Analyzing ${packageUpdate.name}: ${packageUpdate.fromVersion} → ${packageUpdate.toVersion}`);
    
    // Check if we should skip patch updates
    if (!options.force && await isPatchUpdate(packageUpdate.fromVersion, packageUpdate.toVersion)) {
      logWarningMessage('Skipping patch update (use --force to analyze)');
      if (exitOnComplete) process.exit(0);
      return {
        package: packageUpdate,
        changelogDiff: null,
        codeDiff: null,
        dependencyUsage: null,
        breakingChanges: [],
        llmSummary: null,
        apiUsages: [],
        riskAssessment: {
          level: 'safe',
          factors: ['Patch update - automatically skipped'],
          estimatedEffort: 'none',
          testingScope: 'none'
        },
        recommendation: 'Patch update - automatically skipped'
      };
    }
    
    // Step 2: Find appropriate analyzer
    spinner = ora('Finding appropriate package analyzer...').start();
    const analyzer = await analyzerRegistry.findAnalyzer(packageUpdate.name, process.cwd());
    
    if (!analyzer) {
      spinner.warn('No specific analyzer found, using fallback strategies');
    } else {
      spinner.succeed(`Using ${analyzer.constructor.name} for analysis`);
    }
    
    // Step 3: Fetch changelog/diff using analyzer or fallback
    spinner = ora('Fetching package information...').start();
    let changelogDiff = null;
    let knowledgeBasedBreaking: string[] = [];
    
    if (analyzer) {
      changelogDiff = await analyzer.fetchChangelog(packageUpdate, options.cacheDir);
    }
    
    // Try package knowledge base
    const knownBreaking = await packageKnowledgeBase.getBreakingChanges(
      packageUpdate.name,
      packageUpdate.fromVersion,
      packageUpdate.toVersion
    );
    if (knownBreaking.length > 0) {
      knowledgeBasedBreaking = knownBreaking;
      spinner.succeed(`Found ${knownBreaking.length} known breaking changes from knowledge base`);
    }
    
    // If no changelog, use fallback strategies
    if (!changelogDiff) {
      spinner.text = 'Using fallback analysis strategies...';
      const analysisChain = createDefaultAnalysisChain();
      const strategyResult = await analysisChain.analyze(packageUpdate);
      
      if (strategyResult.confidence > 0) {
        changelogDiff = {
          content: strategyResult.content,
          source: strategyResult.source as any,
          fromVersion: packageUpdate.fromVersion,
          toVersion: packageUpdate.toVersion
        };
        spinner.succeed(`Analysis completed using ${strategyResult.source} (confidence: ${Math.round(strategyResult.confidence * 100)}%)`);
      } else {
        spinner.warn('Limited information available from all sources');
      }
    } else {
      spinner.succeed(`Fetched changelog from ${changelogDiff.source}`);
    }
    
    // Step 4: Fetch code diff from GitHub
    spinner = ora('Fetching code differences from GitHub...').start();
    const codeDiff = await fetchCodeDiff(packageUpdate);
    
    if (!codeDiff) {
      spinner.warn('No code diff available');
    } else {
      spinner.succeed(`Fetched code diff: ${codeDiff.filesChanged} files changed`);
    }
    
    // Step 5: Analyze dependency usage
    spinner = ora('Analyzing dependency usage...').start();
    const dependencyUsage = await analyzeDependencyUsage(packageUpdate.name);
    
    if (!dependencyUsage) {
      spinner.warn('No dependency usage information found');
    } else {
      spinner.succeed(`Dependency analysis: ${dependencyUsage.isDirect ? 'Direct' : 'Transitive'} (${dependencyUsage.dependents.length} dependents)`);
    }
    
    // Step 6: Analyze package usage with new analyzer
    spinner = ora('Analyzing package usage in codebase...').start();
    let usageAnalysis: UsageAnalysis | null = null;
    
    if (analyzer) {
      usageAnalysis = await analyzer.analyzeUsage(packageUpdate.name, process.cwd());
      spinner.succeed(`Found ${usageAnalysis.totalUsageCount} usage locations (${usageAnalysis.productionUsageCount} in production)`);
    } else {
      spinner.warn('Usage analysis not available for this package type');
    }
    
    // Step 7: Extract breaking changes
    spinner = ora('Analyzing for breaking changes...').start();
    let breakingChanges = changelogDiff ? extractBreakingChanges(changelogDiff.content) : [];
    
    // Add knowledge-based breaking changes
    knowledgeBasedBreaking.forEach(change => {
      breakingChanges.push({
        line: change,
        severity: 'breaking'
      });
    });
    
    if (breakingChanges.length > 0) {
      spinner.succeed(`Found ${breakingChanges.length} potential breaking changes`);
    } else {
      spinner.succeed('No breaking changes detected');
    }
    
    // Step 8: Enhanced LLM analysis
    let llmSummary = null;
    if (!options.noLlm) {
      spinner = ora('Generating enhanced AI analysis...').start();
      
      llmSummary = await enhancedLLMAnalysis(
        packageUpdate,
        changelogDiff,
        codeDiff,
        dependencyUsage,
        breakingChanges,
        options.llm,
        options.cacheDir,
        options.language || 'en'
      );
      
      if (llmSummary) {
        const analysisTypes = [
          changelogDiff ? 'changelog' : null,
          codeDiff ? 'code-diff' : null,
          dependencyUsage ? 'dependency-tree' : null,
          knowledgeBasedBreaking.length > 0 ? 'knowledge-base' : null
        ].filter(Boolean);
        
        spinner.succeed(`Generated AI analysis (${analysisTypes.join(', ')})`);
      } else {
        spinner.warn('AI analysis generation failed');
      }
    }
    
    // Step 9: Convert usage analysis to API usages for compatibility
    const apiUsages = usageAnalysis ? usageAnalysis.locations.map(loc => ({
      filePath: loc.file,
      line: loc.line,
      column: loc.column,
      apiName: packageUpdate.name,
      usageType: loc.type as any,
      snippet: loc.code,
      context: loc.context
    })) : [];
    
    // Step 10: Deep analysis (optional)
    let deepAnalysis: DeepAnalysisResult | undefined = undefined;
    if (options.deep) {
      spinner = ora('Performing deep code analysis...').start();
      const breakingAPINames = breakingChanges.map(bc => {
        const matches = bc.line.match(/`([a-zA-Z_$][a-zA-Z0-9_$]*)`/g);
        return matches ? matches.map(m => m.slice(1, -1)) : [];
      }).flat();
      
      deepAnalysis = await performDeepAnalysis(packageUpdate, breakingAPINames);
      
      spinner.succeed(`Deep analysis: ${deepAnalysis.filesUsingPackage}/${deepAnalysis.totalFiles} files use package`);
    }
    
    // Step 11: Enhanced risk assessment
    const riskAssessment = await assessEnhancedRisk(
      packageUpdate,
      breakingChanges,
      usageAnalysis,
      llmSummary,
      !!changelogDiff,
      !!codeDiff
    );
    
    // Get migration steps from knowledge base
    const migrationSteps = await packageKnowledgeBase.getMigrationSteps(
      packageUpdate.name,
      packageUpdate.fromVersion,
      packageUpdate.toVersion
    );
    
    if (migrationSteps.length > 0) {
      logSection('Known migration steps:', '📚');
      migrationSteps.forEach(step => logListItem(step));
    }
    
    const analysisResult: AnalysisResult = {
      package: packageUpdate,
      changelogDiff,
      codeDiff,
      dependencyUsage,
      breakingChanges,
      llmSummary,
      apiUsages,
      deepAnalysis,
      riskAssessment,
      recommendation: generateRecommendation(riskAssessment, breakingChanges.length, apiUsages.length)
    };
    
    const report = await generateEnhancedReport(analysisResult, options.json ? 'json' : 'markdown');
    
    console.log('\n' + report);
    
    // Handle PR posting based on post mode
    if (options.pr && options.post !== 'never') {
      const { findExistingComment, updateComment } = await import('./lib/post.js');
      
      spinner = ora('Checking for existing comment...').start();
      const existingCommentId = await findExistingComment(options.pr);
      
      if (existingCommentId) {
        if (options.post === 'update') {
          spinner.text = 'Updating existing comment...';
          await updateComment(existingCommentId, report);
          spinner.succeed('Updated existing comment');
        } else {
          spinner.succeed('Comment already exists (use --post update to overwrite)');
        }
      } else {
        spinner.text = 'Posting new comment to PR...';
        await postToPR(options.pr, report);
        spinner.succeed('Posted new comment to PR');
      }
    }
    
    if (exitOnComplete) {
      process.exit(riskAssessment.level === 'high' || riskAssessment.level === 'critical' ? 1 : 0);
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