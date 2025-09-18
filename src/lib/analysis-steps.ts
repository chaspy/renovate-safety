import ora, { Ora } from 'ora';
import {
  CLIOptions,
  AnalysisResult,
  DeepAnalysisResult,
  PackageUpdate,
  ChangelogDiff,
  CodeDiff,
  DependencyUsage,
  BreakingChange,
  LLMSummary,
  APIUsage,
} from '../types/index.js';
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
  spinner: Ora,
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
  packageUpdate: PackageUpdate,
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

export async function findAppropriateAnalyzer(_spinner: Ora, packageUpdate: PackageUpdate) {
  const analyzeSpinner = ora('Finding appropriate package analyzer...').start();
  const analyzer = await analyzerRegistry.findAnalyzer(packageUpdate.name, process.cwd());

  if (!analyzer) {
    analyzeSpinner.warn('No specific analyzer found, using fallback strategies');
  } else {
    analyzeSpinner.succeed(`Using ${analyzer.constructor.name} for analysis`);
  }

  return analyzer;
}

export async function fetchChangelogAndKnowledge(
  _spinner: Ora,
  analyzer: unknown,
  packageUpdate: PackageUpdate,
  options: CLIOptions
) {
  const fetchSpinner = ora('Fetching package information...').start();
  let changelogDiff = null;
  let knowledgeBasedBreaking: string[] = [];

  if (
    analyzer &&
    typeof analyzer === 'object' &&
    analyzer !== null &&
    'fetchChangelog' in analyzer
  ) {
    const analyzerWithFetch = analyzer as {
      fetchChangelog: (pkg: PackageUpdate, cacheDir: string) => Promise<ChangelogDiff | null>;
    };
    changelogDiff = await analyzerWithFetch.fetchChangelog(packageUpdate, options.cacheDir);
  }

  // Try package knowledge base
  const knownBreaking = await packageKnowledgeBase.getBreakingChanges(
    packageUpdate.name,
    packageUpdate.fromVersion,
    packageUpdate.toVersion
  );
  if (knownBreaking.length > 0) {
    knowledgeBasedBreaking = knownBreaking;
    fetchSpinner.succeed(
      `Found ${knownBreaking.length} known breaking changes from knowledge base`
    );
  }

  // If no changelog, use fallback strategies
  if (!changelogDiff) {
    fetchSpinner.text = 'Using fallback analysis strategies...';
    const analysisChain = createDefaultAnalysisChain();
    const strategyResult = await analysisChain.analyze(packageUpdate);

    if (strategyResult.confidence > 0) {
      changelogDiff = {
        content: strategyResult.content,
        source: strategyResult.source as ChangelogDiff['source'],
        fromVersion: packageUpdate.fromVersion,
        toVersion: packageUpdate.toVersion,
      };
      fetchSpinner.succeed(
        `Analysis completed using ${String(strategyResult.source)} (confidence: ${Math.round(strategyResult.confidence * 100)}%)`
      );
    } else {
      fetchSpinner.warn('Limited information available from all sources');
    }
  } else {
    const source: string = changelogDiff?.source ?? 'unknown';
    fetchSpinner.succeed(`Fetched changelog from ${source}`);
  }

  return { changelogDiff, knowledgeBasedBreaking };
}

export async function fetchCodeDifference(_spinner: Ora, packageUpdate: PackageUpdate) {
  const codeDiffSpinner = ora('Fetching code differences from GitHub...').start();
  const codeDiff = await fetchCodeDiff(packageUpdate);

  if (!codeDiff) {
    codeDiffSpinner.warn('No code diff available');
  } else {
    codeDiffSpinner.succeed(`Fetched code diff: ${codeDiff.filesChanged} files changed`);
  }

  return codeDiff;
}

export async function analyzeDependencyUsageStep(_spinner: Ora, packageUpdate: PackageUpdate) {
  const dependencySpinner = ora('Analyzing dependency usage...').start();
  const dependencyUsage = await analyzeDependencyUsage(packageUpdate.name);

  if (!dependencyUsage) {
    dependencySpinner.warn('No dependency usage information found');
  } else {
    dependencySpinner.succeed(
      `Dependency analysis: ${dependencyUsage.isDirect ? 'Direct' : 'Transitive'} (${dependencyUsage.dependents.length} dependents)`
    );
  }

  return dependencyUsage;
}

export async function analyzePackageUsageStep(
  _spinner: Ora,
  analyzer: unknown,
  packageUpdate: PackageUpdate
) {
  const usageSpinner = ora('Analyzing package usage in codebase...').start();
  let usageAnalysis: UsageAnalysis | null = null;

  if (analyzer && typeof analyzer === 'object' && analyzer !== null && 'analyzeUsage' in analyzer) {
    const analyzerWithUsage = analyzer as {
      analyzeUsage: (name: string, cwd: string) => Promise<UsageAnalysis>;
    };
    usageAnalysis = await analyzerWithUsage.analyzeUsage(packageUpdate.name, process.cwd());
    usageSpinner.succeed(
      `Found ${usageAnalysis.totalUsageCount} usage locations (${usageAnalysis.productionUsageCount} in production)`
    );
  } else {
    usageSpinner.warn('Usage analysis not available for this package type');
  }

  return usageAnalysis;
}

export async function extractBreakingChangesStep(
  _spinner: Ora,
  changelogDiff: ChangelogDiff | null,
  codeDiff: CodeDiff | null,
  knowledgeBasedBreaking: string[]
) {
  const breakingSpinner = ora('Analyzing for breaking changes...').start();

  // Extract engines diff from code diff if available
  let enginesDiff: { from: string; to: string } | undefined;
  if (codeDiff) {
    try {
      const apiDiffSummary = await summarizeApiDiff(codeDiff);
      enginesDiff = apiDiffSummary.enginesDiff;
    } catch {
      // Silently ignore API diff extraction errors
    }
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
    breakingSpinner.succeed(`Found ${breakingChanges.length} potential breaking changes`);
  } else {
    breakingSpinner.succeed('No breaking changes detected');
  }

  return breakingChanges;
}

interface LLMAnalysisParams {
  packageUpdate: PackageUpdate;
  changelogDiff: ChangelogDiff | null;
  codeDiff: CodeDiff | null;
  dependencyUsage: DependencyUsage | null;
  breakingChanges: BreakingChange[];
  knowledgeBasedBreaking: string[];
}

export async function performLLMAnalysis(
  _spinner: Ora,
  options: CLIOptions,
  params: LLMAnalysisParams
) {
  let llmSummary = null;
  if (!options.noLlm) {
    const llmSpinner = ora('Generating enhanced AI analysis...').start();

    llmSummary = await enhancedLLMAnalysis(
      params.packageUpdate,
      params.changelogDiff,
      params.codeDiff,
      params.dependencyUsage,
      params.breakingChanges,
      {
        provider: options.llm,
        cacheDir: options.cacheDir,
        language: options.language || 'en'
      }
    );

    if (llmSummary) {
      const analysisTypes = [
        params.changelogDiff ? 'changelog' : null,
        params.codeDiff ? 'code-diff' : null,
        params.dependencyUsage ? 'dependency-tree' : null,
        params.knowledgeBasedBreaking.length > 0 ? 'knowledge-base' : null,
      ].filter(Boolean);

      llmSpinner.succeed(`Generated AI analysis (${analysisTypes.join(', ')})`);
    } else {
      llmSpinner.warn('AI analysis generation failed');
    }
  }

  return llmSummary;
}

export function convertUsageAnalysisToApiUsages(
  usageAnalysis: UsageAnalysis | null,
  packageUpdate: PackageUpdate
) {
  return usageAnalysis
    ? usageAnalysis.locations.map((loc) => ({
        filePath: loc.file,
        line: loc.line,
        column: loc.column,
        apiName: packageUpdate.name,
        usageType: loc.type as 'import' | 'call' | 'reference',
        snippet: loc.code,
        context: loc.context,
      }))
    : [];
}

export async function performDeepAnalysisStep(
  spinner: Ora,
  options: CLIOptions,
  packageUpdate: PackageUpdate,
  breakingChanges: BreakingChange[]
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

interface AnalysisResultParams {
  packageUpdate: PackageUpdate;
  changelogDiff: ChangelogDiff | null;
  codeDiff: CodeDiff | null;
  dependencyUsage: DependencyUsage | null;
  breakingChanges: BreakingChange[];
  llmSummary: LLMSummary | null;
  apiUsages: APIUsage[];
  deepAnalysis: DeepAnalysisResult | undefined;
  usageAnalysis: UsageAnalysis | null;
}

export async function generateAnalysisResult(
  params: AnalysisResultParams,
  options: CLIOptions
): Promise<AnalysisResult> {
  // Enhanced risk assessment
  const riskAssessment = await assessEnhancedRisk(
    params.packageUpdate,
    params.breakingChanges,
    params.usageAnalysis,
    params.llmSummary,
    Boolean(params.changelogDiff),
    Boolean(params.codeDiff)
  );

  // Get migration steps from knowledge base
  const migrationSteps = await packageKnowledgeBase.getMigrationSteps(
    params.packageUpdate.name,
    params.packageUpdate.fromVersion,
    params.packageUpdate.toVersion
  );

  if (migrationSteps.length > 0) {
    logSection('Known migration steps:', '📚');
    migrationSteps.forEach((step) => {
      logListItem(step);
    });
  }

  const { generateRecommendation } = await import('../index.js');

  return {
    package: params.packageUpdate,
    changelogDiff: params.changelogDiff,
    codeDiff: params.codeDiff,
    dependencyUsage: params.dependencyUsage,
    breakingChanges: params.breakingChanges,
    llmSummary: params.llmSummary,
    apiUsages: params.apiUsages,
    deepAnalysis: params.deepAnalysis,
    riskAssessment,
    recommendation: generateRecommendation(
      riskAssessment,
      params.breakingChanges.length,
      params.apiUsages.length,
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
  spinner: Ora,
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
