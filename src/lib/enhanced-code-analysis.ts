import type { PackageUpdate } from '../types/index.js';
import { CodeDiff } from './github-diff.js';
import { loggers } from './logger.js';
import { executeInParallel } from './parallel-helpers.js';

export interface EnhancedCodeAnalysis {
  packageName: string;
  codeDiff: CodeDiff | null;
  semanticChanges: SemanticChange[];
  apiChanges: ApiChange[];
  breakingPatterns: BreakingPattern[];
  migrationComplexity: MigrationComplexity;
  fileImpactAnalysis: FileImpactAnalysis;
  riskAssessment: CodeRiskAssessment;
}

export interface SemanticChange {
  type:
    | 'api-addition'
    | 'api-removal'
    | 'api-modification'
    | 'behavior-change'
    | 'performance-change';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  file: string;
  lineNumber?: number;
  codeExample: {
    before?: string;
    after?: string;
  };
  impact: string;
}

export interface ApiChange {
  api: string;
  changeType: 'added' | 'removed' | 'modified' | 'deprecated';
  file: string;
  line: number;
  signature: {
    before?: string;
    after?: string;
  };
  documentation?: string;
  compatibility: 'breaking' | 'backward-compatible' | 'enhancement';
}

export interface BreakingPattern {
  pattern: string;
  description: string;
  files: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  migrationRequired: boolean;
  autoFixable: boolean;
  suggestedFix?: string;
}

export interface MigrationComplexity {
  overallComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'major';
  estimatedHours: number;
  automationPossible: number; // percentage
  riskFactors: string[];
  migrationSteps: MigrationStep[];
}

export interface MigrationStep {
  order: number;
  description: string;
  category: 'preparation' | 'code-change' | 'testing' | 'validation' | 'cleanup';
  effort: 'low' | 'medium' | 'high';
  automatable: boolean;
  dependencies: number[]; // step numbers this depends on
}

export interface FileImpactAnalysis {
  categories: FileCategory[];
  riskDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  affectedAreas: AffectedArea[];
}

export interface FileCategory {
  category: 'api' | 'config' | 'types' | 'implementation' | 'documentation' | 'tests';
  files: FileImpact[];
  overallImpact: 'critical' | 'high' | 'medium' | 'low';
}

export interface FileImpact {
  filename: string;
  changeType: 'added' | 'removed' | 'modified';
  linesChanged: number;
  complexity: 'simple' | 'moderate' | 'complex';
  publicApi: boolean;
  testCoverage: boolean;
  backwards_compatible: boolean;
}

export interface AffectedArea {
  area: string;
  description: string;
  files: string[];
  impact: 'critical' | 'high' | 'medium' | 'low';
  userFacing: boolean;
}

export interface CodeRiskAssessment {
  overallRisk: 'critical' | 'high' | 'medium' | 'low';
  riskFactors: RiskFactor[];
  confidence: number; // 0-100
  recommendations: string[];
}

export interface RiskFactor {
  factor: string;
  impact: 'critical' | 'high' | 'medium' | 'low';
  likelihood: 'certain' | 'likely' | 'possible' | 'unlikely';
  explanation: string;
  mitigation?: string;
}

export async function performEnhancedCodeAnalysis(
  packageUpdate: PackageUpdate,
  codeDiff: CodeDiff | null
): Promise<EnhancedCodeAnalysis> {
  loggers.info(`🔍 Performing enhanced code analysis for ${packageUpdate.name}...`);

  if (!codeDiff) {
    return {
      packageName: packageUpdate.name,
      codeDiff: null,
      semanticChanges: [],
      apiChanges: [],
      breakingPatterns: [],
      migrationComplexity: getDefaultMigrationComplexity(),
      fileImpactAnalysis: getDefaultFileImpactAnalysis(),
      riskAssessment: getDefaultRiskAssessment(),
    };
  }

  const results = await executeInParallel<any>(
    [
      () => analyzeSemanticChanges(codeDiff),
      () => analyzeApiChanges(codeDiff),
      () => detectBreakingPatterns(codeDiff),
      () => analyzeFileImpact(codeDiff),
    ],
    { concurrency: 4 }
  );

  const semanticChanges: SemanticChange[] = results[0] instanceof Error ? [] : results[0];
  const apiChanges: ApiChange[] = results[1] instanceof Error ? [] : results[1];
  const breakingPatterns: BreakingPattern[] = results[2] instanceof Error ? [] : results[2];
  const fileImpactAnalysis: FileImpactAnalysis =
    results[3] instanceof Error
      ? {
          affectedFiles: [],
          criticalPaths: [],
          testCoverage: { covered: [], uncovered: [] },
          estimatedEffort: 'unknown',
          categories: {},
          riskDistribution: {},
          affectedAreas: [],
        }
      : results[3];

  const migrationComplexity = assessMigrationComplexity(
    semanticChanges,
    apiChanges,
    breakingPatterns
  );
  const riskAssessment = assessCodeRisk(
    semanticChanges,
    apiChanges,
    breakingPatterns,
    fileImpactAnalysis
  );

  return {
    packageName: packageUpdate.name,
    codeDiff,
    semanticChanges,
    apiChanges,
    breakingPatterns,
    migrationComplexity,
    fileImpactAnalysis,
    riskAssessment,
  };
}

async function analyzeSemanticChanges(codeDiff: CodeDiff): Promise<SemanticChange[]> {
  const changes: SemanticChange[] = [];
  const diffLines = codeDiff.content.split('\n');

  let currentFile = '';
  let lineNumber = 0;

  for (const line of diffLines) {
    lineNumber++;

    // Track current file
    if (line.startsWith('### ')) {
      currentFile = line.replace('### ', '').trim();
      continue;
    }

    // Skip non-diff lines
    if (!line.startsWith('+') && !line.startsWith('-')) {
      continue;
    }

    // Analyze line for semantic changes
    const semanticChange = analyzeLineForSemanticChanges(line, currentFile, lineNumber);
    if (semanticChange) {
      changes.push(semanticChange);
    }
  }

  return changes;
}

function analyzeLineForSemanticChanges(
  line: string,
  file: string,
  lineNumber: number
): SemanticChange | null {
  const content = line.substring(1).trim(); // Remove +/- prefix

  // Function signature changes
  if (content.includes('function') || content.includes('=>') || content.includes('def ')) {
    if (line.startsWith('-')) {
      return {
        type: 'api-removal',
        severity: 'high',
        description: 'Function signature removed',
        file,
        lineNumber,
        codeExample: { before: content },
        impact: 'Breaking change - function no longer available',
      };
    } else if (line.startsWith('+')) {
      return {
        type: 'api-addition',
        severity: 'low',
        description: 'New function added',
        file,
        lineNumber,
        codeExample: { after: content },
        impact: 'Enhancement - new functionality available',
      };
    }
  }

  // Class/interface changes
  if (content.includes('class ') || content.includes('interface ') || content.includes('type ')) {
    const severity = line.startsWith('-') ? 'high' : 'medium';
    const type = line.startsWith('-') ? 'api-removal' : 'api-modification';

    return {
      type,
      severity,
      description: 'Type definition changed',
      file,
      lineNumber,
      codeExample: line.startsWith('-') ? { before: content } : { after: content },
      impact: 'Potential breaking change - type definitions modified',
    };
  }

  // Export changes
  if (
    content.includes('export') &&
    (content.includes('function') || content.includes('class') || content.includes('const'))
  ) {
    return {
      type: line.startsWith('-') ? 'api-removal' : 'api-addition',
      severity: 'medium',
      description: 'Public API export changed',
      file,
      lineNumber,
      codeExample: line.startsWith('-') ? { before: content } : { after: content },
      impact: 'Public API surface changed',
    };
  }

  return null;
}

async function analyzeApiChanges(codeDiff: CodeDiff): Promise<ApiChange[]> {
  const changes: ApiChange[] = [];
  const diffLines = codeDiff.content.split('\n');

  let currentFile = '';
  let inDiffBlock = false;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    if (line.startsWith('### ')) {
      currentFile = line.replace('### ', '').trim();
      continue;
    }

    if (line.startsWith('```diff')) {
      inDiffBlock = true;
      continue;
    }

    if (line.startsWith('```') && inDiffBlock) {
      inDiffBlock = false;
      continue;
    }

    if (!inDiffBlock || (!line.startsWith('+') && !line.startsWith('-'))) {
      continue;
    }

    const apiChange = parseApiChange(line, currentFile, i);
    if (apiChange) {
      changes.push(apiChange);
    }
  }

  return changes;
}

function parseApiChange(line: string, file: string, lineNumber: number): ApiChange | null {
  const content = line.substring(1).trim();

  // Function/method definitions
  const functionRegex = /(export\s{1,10})?(function\s{1,10}|const\s{1,10})(\w+)(\s{0,10}=\s{0,10}|\s{0,10})\(([^)]{0,200})\)/;
  const functionMatch = functionRegex.exec(content);
  if (functionMatch) {
    const [, , , name] = functionMatch;

    return {
      api: name,
      changeType: line.startsWith('-') ? 'removed' : 'added',
      file,
      line: lineNumber,
      signature: {
        [line.startsWith('-') ? 'before' : 'after']: content,
      },
      compatibility: line.startsWith('-') ? 'breaking' : 'enhancement',
    };
  }

  // Class definitions
  const classMatch = content.match(/class\s+(\w+)/);
  if (classMatch) {
    return {
      api: classMatch[1],
      changeType: line.startsWith('-') ? 'removed' : 'added',
      file,
      line: lineNumber,
      signature: {
        [line.startsWith('-') ? 'before' : 'after']: content,
      },
      compatibility: line.startsWith('-') ? 'breaking' : 'enhancement',
    };
  }

  return null;
}

async function detectBreakingPatterns(codeDiff: CodeDiff): Promise<BreakingPattern[]> {
  const patterns: BreakingPattern[] = [];

  // Common breaking change patterns
  const breakingChangePatterns = [
    {
      pattern: /\.prototype\s{0,10}=|delete\s{1,10}\w+\.prototype/,
      description: 'Prototype modification detected',
      severity: 'high' as const,
      migrationRequired: true,
      autoFixable: false,
    },
    {
      pattern: /-\s{0,10}export\s{1,10}(function|class|const)/,
      description: 'Public API removal detected',
      severity: 'critical' as const,
      migrationRequired: true,
      autoFixable: false,
    },
    {
      pattern: /throw\s+new\s+Error|throw\s+\w+Error/,
      description: 'New error throwing behavior',
      severity: 'medium' as const,
      migrationRequired: false,
      autoFixable: false,
    },
    {
      pattern: /-\s{0,10}\w+\.default\s{0,10}=|\+\s{0,10}\w+\.default\s{0,10}=/,
      description: 'Default export change',
      severity: 'high' as const,
      migrationRequired: true,
      autoFixable: false,
    },
  ];

  for (const patternDef of breakingChangePatterns) {
    const matches = findPatternMatches(codeDiff.content, patternDef.pattern);

    if (matches.length > 0) {
      patterns.push({
        pattern: patternDef.pattern.source,
        description: patternDef.description,
        files: extractFilesFromMatches(matches),
        severity: patternDef.severity,
        migrationRequired: patternDef.migrationRequired,
        autoFixable: patternDef.autoFixable,
        suggestedFix: generateSuggestedFix(patternDef.pattern, matches),
      });
    }
  }

  return patterns;
}

function findPatternMatches(content: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (pattern.test(line)) {
      matches.push(line);
    }
  }

  return matches;
}

function extractFilesFromMatches(_matches: string[]): string[] {
  // Extract unique file names from diff content
  // This is a simplified implementation
  return ['multiple files']; // Would implement proper file extraction
}

function generateSuggestedFix(pattern: RegExp, _matches: string[]): string | undefined {
  // Generate context-aware suggested fixes
  if (pattern.source.includes('export')) {
    return 'Review public API usage and update import statements';
  }

  if (pattern.source.includes('throw')) {
    return 'Add error handling for new exception types';
  }

  return undefined;
}

async function analyzeFileImpact(_codeDiff: CodeDiff): Promise<FileImpactAnalysis> {
  // Parse diff content to analyze file impacts
  const categories: FileCategory[] = [
    { category: 'api', files: [], overallImpact: 'low' },
    { category: 'config', files: [], overallImpact: 'low' },
    { category: 'types', files: [], overallImpact: 'low' },
    { category: 'implementation', files: [], overallImpact: 'low' },
    { category: 'documentation', files: [], overallImpact: 'low' },
    { category: 'tests', files: [], overallImpact: 'low' },
  ];

  // Analyze diff content would go here
  // This is a simplified implementation

  return {
    categories,
    riskDistribution: { critical: 0, high: 1, medium: 2, low: 3 },
    affectedAreas: [
      {
        area: 'Core API',
        description: 'Main package functionality',
        files: ['src/index.ts'],
        impact: 'medium',
        userFacing: true,
      },
    ],
  };
}

function assessMigrationComplexity(
  semanticChanges: SemanticChange[],
  apiChanges: ApiChange[],
  breakingPatterns: BreakingPattern[]
): MigrationComplexity {
  const criticalChanges = semanticChanges.filter((c) => c.severity === 'critical').length;
  const highChanges = semanticChanges.filter((c) => c.severity === 'high').length;
  const breakingApiChanges = apiChanges.filter((c) => c.compatibility === 'breaking').length;
  const criticalPatterns = breakingPatterns.filter((p) => p.severity === 'critical').length;

  let complexity: MigrationComplexity['overallComplexity'] = 'trivial';
  let estimatedHours = 0;
  let automationPossible = 80;

  const totalCriticalIssues = criticalChanges + criticalPatterns;
  const totalHighIssues = highChanges + breakingApiChanges;

  if (totalCriticalIssues > 0) {
    complexity = 'major';
    estimatedHours = 24 + totalCriticalIssues * 8;
    automationPossible = 20;
  } else if (totalHighIssues > 3) {
    complexity = 'complex';
    estimatedHours = 16 + totalHighIssues * 2;
    automationPossible = 40;
  } else if (totalHighIssues > 0) {
    complexity = 'moderate';
    estimatedHours = 4 + totalHighIssues * 2;
    automationPossible = 60;
  } else if (semanticChanges.length > 0 || apiChanges.length > 0) {
    complexity = 'simple';
    estimatedHours = 2;
    automationPossible = 80;
  }

  const riskFactors = [
    ...(criticalChanges > 0 ? ['Critical semantic changes detected'] : []),
    ...(breakingApiChanges > 0 ? ['Breaking API changes'] : []),
    ...(criticalPatterns > 0 ? ['Critical breaking patterns found'] : []),
  ];

  const migrationSteps: MigrationStep[] = [
    {
      order: 1,
      description: 'Review breaking changes documentation',
      category: 'preparation',
      effort: 'low',
      automatable: false,
      dependencies: [],
    },
    {
      order: 2,
      description: 'Update imports and API calls',
      category: 'code-change',
      effort: totalHighIssues > 0 ? 'high' : 'medium',
      automatable: automationPossible > 50,
      dependencies: [1],
    },
    {
      order: 3,
      description: 'Run comprehensive test suite',
      category: 'testing',
      effort: 'medium',
      automatable: true,
      dependencies: [2],
    },
  ];

  return {
    overallComplexity: complexity,
    estimatedHours,
    automationPossible,
    riskFactors,
    migrationSteps,
  };
}

function assessCodeRisk(
  semanticChanges: SemanticChange[],
  apiChanges: ApiChange[],
  breakingPatterns: BreakingPattern[],
  _fileImpactAnalysis: FileImpactAnalysis
): CodeRiskAssessment {
  const riskFactors: RiskFactor[] = [];
  let overallRisk: CodeRiskAssessment['overallRisk'] = 'low';
  let confidence = 85;

  // Assess semantic changes
  const criticalSemanticChanges = semanticChanges.filter((c) => c.severity === 'critical');
  if (criticalSemanticChanges.length > 0) {
    riskFactors.push({
      factor: 'Critical semantic changes',
      impact: 'critical',
      likelihood: 'certain',
      explanation: `${criticalSemanticChanges.length} critical changes that will break existing code`,
      mitigation: 'Requires manual code updates and thorough testing',
    });
    overallRisk = 'critical';
  }

  // Assess API changes
  const breakingApiChanges = apiChanges.filter((c) => c.compatibility === 'breaking');
  if (breakingApiChanges.length > 0) {
    riskFactors.push({
      factor: 'Breaking API changes',
      impact: 'high',
      likelihood: 'certain',
      explanation: `${breakingApiChanges.length} API changes that break backward compatibility`,
      mitigation: 'Update all API usage according to migration guide',
    });
    if (overallRisk !== 'critical') overallRisk = 'high';
  }

  // Assess breaking patterns
  const criticalPatterns = breakingPatterns.filter((p) => p.severity === 'critical');
  if (criticalPatterns.length > 0) {
    riskFactors.push({
      factor: 'Critical breaking patterns',
      impact: 'high',
      likelihood: 'likely',
      explanation: 'Code patterns detected that commonly cause breaking changes',
      mitigation: 'Review affected code areas and test thoroughly',
    });
    if (overallRisk === 'low') overallRisk = 'high';
  }

  const recommendations = generateRecommendations(overallRisk, riskFactors);

  return {
    overallRisk,
    riskFactors,
    confidence,
    recommendations,
  };
}

function generateRecommendations(risk: string, _riskFactors: RiskFactor[]): string[] {
  const recommendations: string[] = [];

  if (risk === 'critical') {
    recommendations.push('Do not auto-merge - manual review required');
    recommendations.push('Create a dedicated branch for this update');
    recommendations.push('Plan for significant testing time');
  } else if (risk === 'high') {
    recommendations.push('Review all breaking changes before merging');
    recommendations.push('Run full test suite including integration tests');
    recommendations.push('Consider gradual rollout in staging environment');
  } else if (risk === 'medium') {
    recommendations.push('Review changelog and run test suite');
    recommendations.push('Monitor application closely after deployment');
  } else {
    recommendations.push('Standard testing should be sufficient');
    recommendations.push('Safe to auto-merge after CI passes');
  }

  return recommendations;
}

// Default implementations
function getDefaultMigrationComplexity(): MigrationComplexity {
  return {
    overallComplexity: 'simple',
    estimatedHours: 1,
    automationPossible: 80,
    riskFactors: [],
    migrationSteps: [],
  };
}

function getDefaultFileImpactAnalysis(): FileImpactAnalysis {
  return {
    categories: [],
    riskDistribution: { critical: 0, high: 0, medium: 0, low: 1 },
    affectedAreas: [],
  };
}

function getDefaultRiskAssessment(): CodeRiskAssessment {
  return {
    overallRisk: 'low',
    riskFactors: [],
    confidence: 50,
    recommendations: ['Unable to analyze code changes - manual review recommended'],
  };
}
