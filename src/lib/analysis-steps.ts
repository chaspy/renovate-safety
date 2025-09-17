import ora from 'ora';
import { CLIOptions, AnalysisResult, DeepAnalysisResult } from '../types/index.js';
import { extractPackageInfo } from './pr.js';
import { extractBreakingChanges } from './breaking.js';
import { summarizeApiDiff } from './api-diff-summary.js';
import { enhancedLLMAnalysis } from './llm.js';
import { fetchCodeDiff } from './github-diff.js';
import { analyzeDependencyUsage } from './dependency-tree.js';
import { performDeepAnalysis } from './deep-analysis.js';
import { assessEnhancedRisk } from './enhanced-grade.js';
import { generateEnhancedReport } from './enhanced-report.js';
import { postToPR } from './post.js';
import { packageKnowledgeBase } from './package-knowledge.js';
import { analyzerRegistry, UsageAnalysis } from '../analyzers/base.js';
import { createDefaultAnalysisChain } from '../analyzers/strategies/index.js';
import { logSection, logListItem } from './logger-extended.js';

export async function extractPackageInformation(
  spinner: any,
  options: CLIOptions,
  exitOnComplete: boolean
) {
  spinner.text = 'Extracting package information...';
  const packageUpdate = await extractPackageInfo(options);

  if (!packageUpdate) {
    spinner.fail('Could not determine package information');
    if (exitOnComplete) process.exit(1);
    throw new Error('Could not determine package information');
  }

  spinner.succeed(
    `Analyzing ${packageUpdate.name}: ${packageUpdate.fromVersion} → ${packageUpdate.toVersion}`
  );
  return packageUpdate;
}

export async function checkShouldSkipPatchUpdate(
  packageUpdate: any,
  options: CLIOptions,
  exitOnComplete: boolean
) {
  const { logWarningMessage } = await import('./logger-extended.js');

  if (!options.force && (await isPatchUpdate(packageUpdate.fromVersion, packageUpdate.toVersion))) {
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
        testingScope: 'none',
      },
      recommendation: 'Patch update - automatically skipped',
    } as AnalysisResult;
  }
  return null;
}

export async function findAppropriateAnalyzer(spinner: any, packageUpdate: any) {
  spinner = ora('Finding appropriate package analyzer...').start();
  const analyzer = await analyzerRegistry.findAnalyzer(packageUpdate.name, process.cwd());

  if (!analyzer) {
    spinner.warn('No specific analyzer found, using fallback strategies');
  } else {
    spinner.succeed(`Using ${analyzer.constructor.name} for analysis`);
  }

  return analyzer;
}

export async function fetchChangelogAndKnowledge(
  spinner: any,
  analyzer: any,
  packageUpdate: any,
  options: CLIOptions
) {
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
        toVersion: packageUpdate.toVersion,
      };
      spinner.succeed(
        `Analysis completed using ${strategyResult.source} (confidence: ${Math.round(strategyResult.confidence * 100)}%)`
      );
    } else {
      spinner.warn('Limited information available from all sources');
    }
  } else {
    spinner.succeed(`Fetched changelog from ${changelogDiff.source}`);
  }

  return { changelogDiff, knowledgeBasedBreaking };
}

export async function fetchCodeDifference(spinner: any, packageUpdate: any) {
  spinner = ora('Fetching code differences from GitHub...').start();
  const codeDiff = await fetchCodeDiff(packageUpdate);

  if (!codeDiff) {
    spinner.warn('No code diff available');
  } else {
    spinner.succeed(`Fetched code diff: ${codeDiff.filesChanged} files changed`);
  }

  return codeDiff;
}

export async function analyzeDependencyUsageStep(spinner: any, packageUpdate: any) {
  spinner = ora('Analyzing dependency usage...').start();
  const dependencyUsage = await analyzeDependencyUsage(packageUpdate.name);

  if (!dependencyUsage) {
    spinner.warn('No dependency usage information found');
  } else {
    spinner.succeed(
      `Dependency analysis: ${dependencyUsage.isDirect ? 'Direct' : 'Transitive'} (${dependencyUsage.dependents.length} dependents)`
    );
  }

  return dependencyUsage;
}

export async function analyzePackageUsageStep(spinner: any, analyzer: any, packageUpdate: any) {
  spinner = ora('Analyzing package usage in codebase...').start();
  let usageAnalysis: UsageAnalysis | null = null;

  if (analyzer) {
    usageAnalysis = await analyzer.analyzeUsage(packageUpdate.name, process.cwd());
    spinner.succeed(
      `Found ${usageAnalysis.totalUsageCount} usage locations (${usageAnalysis.productionUsageCount} in production)`
    );
  } else {
    spinner.warn('Usage analysis not available for this package type');
  }

  return usageAnalysis;
}

export async function extractBreakingChangesStep(
  spinner: any,
  changelogDiff: any,
  codeDiff: any,
  knowledgeBasedBreaking: string[]
) {
  spinner = ora('Analyzing for breaking changes...').start();

  // Extract engines diff from code diff if available
  let enginesDiff: { from: string; to: string } | undefined;
  if (codeDiff) {
    try {
      const apiDiffSummary = await summarizeApiDiff(codeDiff);
      enginesDiff = apiDiffSummary.enginesDiff;
    } catch {}
  }

  let breakingChanges = changelogDiff
    ? extractBreakingChanges(changelogDiff.content, enginesDiff, changelogDiff.source)
    : [];

  // Add knowledge-based breaking changes
  knowledgeBasedBreaking.forEach((change) => {
    breakingChanges.push({
      line: change,
      severity: 'breaking',
      source: 'package-knowledge',
    });
  });

  if (breakingChanges.length > 0) {
    spinner.succeed(`Found ${breakingChanges.length} potential breaking changes`);
  } else {
    spinner.succeed('No breaking changes detected');
  }

  return breakingChanges;
}

export async function performLLMAnalysis(
  spinner: any,
  options: CLIOptions,
  packageUpdate: any,
  changelogDiff: any,
  codeDiff: any,
  dependencyUsage: any,
  breakingChanges: any[],
  knowledgeBasedBreaking: string[]
) {
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
        knowledgeBasedBreaking.length > 0 ? 'knowledge-base' : null,
      ].filter(Boolean);

      spinner.succeed(`Generated AI analysis (${analysisTypes.join(', ')})`);
    } else {
      spinner.warn('AI analysis generation failed');
    }
  }

  return llmSummary;
}

export function convertUsageAnalysisToApiUsages(
  usageAnalysis: UsageAnalysis | null,
  packageUpdate: any
) {
  return usageAnalysis
    ? usageAnalysis.locations.map((loc) => ({
        filePath: loc.file,
        line: loc.line,
        column: loc.column,
        apiName: packageUpdate.name,
        usageType: loc.type as any,
        snippet: loc.code,
        context: loc.context,
      }))
    : [];
}

export async function performDeepAnalysisStep(
  spinner: any,
  options: CLIOptions,
  packageUpdate: any,
  breakingChanges: any[]
) {
  let deepAnalysis: DeepAnalysisResult | undefined = undefined;
  if (options.deep) {
    spinner = ora('Performing deep code analysis...').start();
    const breakingAPINames = breakingChanges
      .map((bc) => {
        const matches = bc.line.match(/`([a-zA-Z_$][a-zA-Z0-9_$]*)`/g);
        return matches ? matches.map((m) => m.slice(1, -1)) : [];
      })
      .flat();

    deepAnalysis = await performDeepAnalysis(packageUpdate, breakingAPINames);

    spinner.succeed(
      `Deep analysis: ${deepAnalysis.filesUsingPackage}/${deepAnalysis.totalFiles} files use package`
    );
  }

  return deepAnalysis;
}

export async function generateAnalysisResult(
  packageUpdate: any,
  changelogDiff: any,
  codeDiff: any,
  dependencyUsage: any,
  breakingChanges: any[],
  llmSummary: any,
  apiUsages: any[],
  deepAnalysis: any,
  usageAnalysis: any,
  options: CLIOptions
): Promise<AnalysisResult> {
  // Enhanced risk assessment
  const riskAssessment = await assessEnhancedRisk(
    packageUpdate,
    breakingChanges,
    usageAnalysis,
    llmSummary,
    Boolean(changelogDiff),
    Boolean(codeDiff)
  );

  // Get migration steps from knowledge base
  const migrationSteps = await packageKnowledgeBase.getMigrationSteps(
    packageUpdate.name,
    packageUpdate.fromVersion,
    packageUpdate.toVersion
  );

  if (migrationSteps.length > 0) {
    logSection('Known migration steps:', '📚');
    migrationSteps.forEach((step) => {
      logListItem(step);
    });
  }

  const { generateRecommendation } = await import('../index.js');

  return {
    package: packageUpdate,
    changelogDiff,
    codeDiff,
    dependencyUsage,
    breakingChanges,
    llmSummary,
    apiUsages,
    deepAnalysis,
    riskAssessment,
    recommendation: generateRecommendation(
      riskAssessment,
      breakingChanges.length,
      apiUsages.length,
      options.language || 'en'
    ),
  };
}

export async function generateAndDisplayReport(
  analysisResult: AnalysisResult,
  options: CLIOptions
) {
  const report = await generateEnhancedReport(
    analysisResult,
    options.json ? 'json' : 'markdown',
    options.language || 'en'
  );

  console.log('\n' + report);
  return report;
}

export async function handlePRPosting(
  spinner: any,
  options: CLIOptions,
  analysisResult: AnalysisResult
) {
  if (options.pr && options.post !== 'never') {
    const { findExistingComment, updateComment } = await import('./post.js');

    const report = await generateEnhancedReport(
      analysisResult,
      options.json ? 'json' : 'markdown',
      options.language || 'en'
    );

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
