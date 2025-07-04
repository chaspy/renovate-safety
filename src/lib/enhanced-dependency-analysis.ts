import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DependencyUsage, DependentInfo } from './dependency-tree.js';

export interface EnhancedDependencyAnalysis {
  packageName: string;
  impactAnalysis: ImpactAnalysis;
  versionConstraints: VersionConstraints[];
  breakingChangeRisk: BreakingChangeRisk;
  usagePatterns: UsagePattern[];
  relatedPackages: RelatedPackage[];
  updateCompatibility: UpdateCompatibility;
}

export interface ImpactAnalysis {
  directUsages: DirectUsage[];
  transitiveUsages: TransitiveUsage[];
  configurationUsages: ConfigUsage[];
  runtimeImpact: 'critical' | 'high' | 'medium' | 'low' | 'none';
  buildTimeImpact: 'critical' | 'high' | 'medium' | 'low' | 'none';
  testImpact: 'critical' | 'high' | 'medium' | 'low' | 'none';
}

export interface DirectUsage {
  packageName: string;
  usageType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
  versionRange: string;
  workspaces?: string[];
  purpose: 'runtime' | 'build' | 'test' | 'tooling' | 'types';
}

export interface TransitiveUsage {
  parentPackage: string;
  depth: number;
  versionRange: string;
  resolvedVersion: string;
  conflicts: VersionConflict[];
}

export interface VersionConflict {
  requiredBy: string;
  requiredVersion: string;
  actualVersion: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ConfigUsage {
  file: string;
  type: 'package.json' | 'tsconfig.json' | 'webpack.config.js' | 'babel.config.js' | 'jest.config.js' | 'other';
  configurations: string[];
  impact: 'breaking' | 'migration-required' | 'minimal';
}

export interface VersionConstraints {
  package: string;
  currentVersion: string;
  requestedVersion: string;
  semverCompatible: boolean;
  constraintType: 'exact' | 'caret' | 'tilde' | 'range' | 'latest';
  conflictsWith: string[];
}

export interface BreakingChangeRisk {
  overallRisk: 'critical' | 'high' | 'medium' | 'low';
  factors: RiskFactor[];
  mitigationSteps: string[];
}

export interface RiskFactor {
  type: 'major-version' | 'api-changes' | 'peer-dependency' | 'config-changes' | 'ecosystem-impact';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  evidenceSource: 'changelog' | 'github-diff' | 'dependency-analysis' | 'community-reports';
}

export interface UsagePattern {
  pattern: string;
  files: string[];
  frequency: number;
  category: 'import' | 'config' | 'api-call' | 'type-usage';
  riskLevel: 'high' | 'medium' | 'low';
}

export interface RelatedPackage {
  name: string;
  relationship: 'peer' | 'plugin' | 'extension' | 'ecosystem' | 'alternative';
  compatibilityStatus: 'compatible' | 'needs-update' | 'incompatible' | 'unknown';
  recommendedVersion?: string;
  migrationRequired: boolean;
}

export interface UpdateCompatibility {
  canAutoUpdate: boolean;
  requiresManualIntervention: boolean;
  estimatedEffort: 'minimal' | 'low' | 'medium' | 'high' | 'extensive';
  blockers: string[];
  prerequisites: string[];
}

export async function performEnhancedDependencyAnalysis(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<EnhancedDependencyAnalysis> {
  const [
    impactAnalysis,
    versionConstraints,
    breakingChangeRisk,
    usagePatterns,
    relatedPackages,
    updateCompatibility
  ] = await Promise.all([
    analyzeImpact(packageName),
    analyzeVersionConstraints(packageName, fromVersion, toVersion),
    assessBreakingChangeRisk(packageName, fromVersion, toVersion),
    analyzeUsagePatterns(packageName),
    findRelatedPackages(packageName),
    assessUpdateCompatibility(packageName, fromVersion, toVersion)
  ]);

  return {
    packageName,
    impactAnalysis,
    versionConstraints,
    breakingChangeRisk,
    usagePatterns,
    relatedPackages,
    updateCompatibility
  };
}

async function analyzeImpact(packageName: string): Promise<ImpactAnalysis> {
  const directUsages = await findDirectUsages(packageName);
  const transitiveUsages = await findTransitiveUsages(packageName);
  const configurationUsages = await findConfigurationUsages(packageName);

  // Determine impact levels based on usage patterns
  const runtimeImpact = determineRuntimeImpact(directUsages, transitiveUsages);
  const buildTimeImpact = determineBuildTimeImpact(directUsages, configurationUsages);
  const testImpact = determineTestImpact(directUsages, transitiveUsages);

  return {
    directUsages,
    transitiveUsages,
    configurationUsages,
    runtimeImpact,
    buildTimeImpact,
    testImpact
  };
}

async function findDirectUsages(packageName: string): Promise<DirectUsage[]> {
  const usages: DirectUsage[] = [];
  
  try {
    // Analyze package.json files (including workspaces)
    const packageJsonFiles = await findPackageJsonFiles();
    
    for (const packageJsonPath of packageJsonFiles) {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      
      const depTypes: Array<keyof typeof packageJson> = [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies'
      ];
      
      for (const depType of depTypes) {
        if (packageJson[depType] && packageJson[depType][packageName]) {
          const workspacePath = path.dirname(packageJsonPath);
          const purpose = determinePurpose(packageName, depType as any);
          
          usages.push({
            packageName,
            usageType: depType as DirectUsage['usageType'],
            versionRange: packageJson[depType][packageName],
            workspaces: workspacePath === '.' ? undefined : [workspacePath],
            purpose
          });
        }
      }
    }
  } catch (error) {
    console.debug('Failed to analyze direct usages:', error);
  }
  
  return usages;
}

async function findTransitiveUsages(packageName: string): Promise<TransitiveUsage[]> {
  const usages: TransitiveUsage[] = [];
  
  try {
    // Use npm ls to get detailed dependency tree
    const { stdout } = await execa('npm', ['ls', packageName, '--json', '--depth=20'], {
      reject: false
    });
    
    const data = JSON.parse(stdout);
    extractTransitiveUsages(data, packageName, [], usages);
  } catch (error) {
    console.debug('Failed to analyze transitive usages:', error);
  }
  
  return usages;
}

function extractTransitiveUsages(
  node: any,
  targetPackage: string,
  path: string[],
  usages: TransitiveUsage[],
  visited = new Set<string>()
): void {
  if (!node || !node.dependencies) return;
  
  const nodeKey = `${path.join('>')}-${targetPackage}`;
  if (visited.has(nodeKey)) return;
  visited.add(nodeKey);
  
  for (const [depName, depInfo] of Object.entries(node.dependencies)) {
    const currentPath = [...path, depName];
    
    if (depName === targetPackage && path.length > 0) {
      const info = depInfo as any;
      const conflicts = detectVersionConflicts(info, currentPath);
      
      usages.push({
        parentPackage: path[0] || 'root',
        depth: currentPath.length,
        versionRange: info.required || 'unknown',
        resolvedVersion: info.version || 'unknown',
        conflicts
      });
    }
    
    // Recursively analyze nested dependencies
    if (depInfo && typeof depInfo === 'object') {
      extractTransitiveUsages(depInfo, targetPackage, currentPath, usages, visited);
    }
  }
}

async function findConfigurationUsages(packageName: string): Promise<ConfigUsage[]> {
  const usages: ConfigUsage[] = [];
  
  const configFiles = [
    { file: 'package.json', type: 'package.json' as const },
    { file: 'tsconfig.json', type: 'tsconfig.json' as const },
    { file: 'webpack.config.js', type: 'webpack.config.js' as const },
    { file: 'babel.config.js', type: 'babel.config.js' as const },
    { file: 'jest.config.js', type: 'jest.config.js' as const },
    // Add more config files as needed
  ];
  
  for (const { file, type } of configFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const configurations = findPackageReferences(content, packageName);
      
      if (configurations.length > 0) {
        usages.push({
          file,
          type,
          configurations,
          impact: assessConfigImpact(type, configurations)
        });
      }
    } catch (error) {
      // File doesn't exist or can't be read, skip
    }
  }
  
  return usages;
}

async function analyzeVersionConstraints(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<VersionConstraints[]> {
  // Implement version constraint analysis
  // This would check for version conflicts, semver compatibility, etc.
  return [];
}

async function assessBreakingChangeRisk(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<BreakingChangeRisk> {
  const factors: RiskFactor[] = [];
  
  // Check version jump magnitude
  const semver = await import('semver');
  if (semver.major(toVersion) > semver.major(fromVersion)) {
    factors.push({
      type: 'major-version',
      severity: 'high',
      description: `Major version update (${fromVersion} → ${toVersion}) likely contains breaking changes`,
      evidenceSource: 'dependency-analysis'
    });
  }
  
  // Add more risk factor analysis...
  
  const overallRisk = calculateOverallRisk(factors);
  const mitigationSteps = generateMitigationSteps(factors);
  
  return {
    overallRisk,
    factors,
    mitigationSteps
  };
}

async function analyzeUsagePatterns(packageName: string): Promise<UsagePattern[]> {
  // Implement usage pattern analysis
  // This would scan source files for how the package is actually used
  return [];
}

async function findRelatedPackages(packageName: string): Promise<RelatedPackage[]> {
  // Implement related package discovery
  // This would find ecosystem packages, plugins, etc.
  return [];
}

async function assessUpdateCompatibility(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<UpdateCompatibility> {
  // Implement compatibility assessment
  return {
    canAutoUpdate: false,
    requiresManualIntervention: true,
    estimatedEffort: 'medium',
    blockers: [],
    prerequisites: []
  };
}

// Helper functions
async function findPackageJsonFiles(): Promise<string[]> {
  const files = ['package.json'];
  
  try {
    // Look for workspace package.json files
    const { stdout } = await execa('find', ['.', '-name', 'package.json', '-not', '-path', '*/node_modules/*'], {
      reject: false
    });
    
    if (stdout) {
      files.push(...stdout.split('\n').filter(f => f && f !== './package.json'));
    }
  } catch (error) {
    // Fallback to basic search
  }
  
  return files;
}

function determinePurpose(packageName: string, usageType: string): DirectUsage['purpose'] {
  if (usageType === 'devDependencies') {
    if (packageName.includes('test') || packageName.includes('jest') || packageName.includes('mocha')) {
      return 'test';
    }
    if (packageName.includes('webpack') || packageName.includes('babel') || packageName.includes('rollup')) {
      return 'build';
    }
    if (packageName.startsWith('@types/')) {
      return 'types';
    }
    return 'tooling';
  }
  
  return 'runtime';
}

function detectVersionConflicts(depInfo: any, path: string[]): VersionConflict[] {
  // Implement version conflict detection
  return [];
}

function findPackageReferences(content: string, packageName: string): string[] {
  const references: string[] = [];
  
  // Look for various ways the package might be referenced in config
  const patterns = [
    new RegExp(`"${packageName}"`, 'g'),
    new RegExp(`'${packageName}'`, 'g'),
    new RegExp(`require\\(['"]${packageName}['"]\\)`, 'g'),
    new RegExp(`import.*from\\s+['"]${packageName}['"]`, 'g'),
  ];
  
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      references.push(...matches);
    }
  }
  
  return references;
}

function assessConfigImpact(type: string, configurations: string[]): ConfigUsage['impact'] {
  if (type === 'package.json') return 'minimal';
  if (configurations.length > 3) return 'breaking';
  return 'migration-required';
}

function determineRuntimeImpact(
  directUsages: DirectUsage[],
  transitiveUsages: TransitiveUsage[]
): ImpactAnalysis['runtimeImpact'] {
  const productionUsage = directUsages.some(u => u.usageType === 'dependencies');
  if (productionUsage) return 'high';
  
  const criticalTransitive = transitiveUsages.some(u => u.conflicts.length > 0);
  if (criticalTransitive) return 'medium';
  
  return 'low';
}

function determineBuildTimeImpact(
  directUsages: DirectUsage[],
  configUsages: ConfigUsage[]
): ImpactAnalysis['buildTimeImpact'] {
  const buildUsage = directUsages.some(u => u.purpose === 'build');
  const configImpact = configUsages.some(u => u.impact === 'breaking');
  
  if (buildUsage && configImpact) return 'high';
  if (buildUsage || configImpact) return 'medium';
  
  return 'low';
}

function determineTestImpact(
  directUsages: DirectUsage[],
  transitiveUsages: TransitiveUsage[]
): ImpactAnalysis['testImpact'] {
  const testUsage = directUsages.some(u => u.purpose === 'test');
  if (testUsage) return 'medium';
  
  return 'low';
}

function calculateOverallRisk(factors: RiskFactor[]): BreakingChangeRisk['overallRisk'] {
  if (factors.some(f => f.severity === 'critical')) return 'critical';
  if (factors.some(f => f.severity === 'high')) return 'high';
  if (factors.some(f => f.severity === 'medium')) return 'medium';
  return 'low';
}

function generateMitigationSteps(factors: RiskFactor[]): string[] {
  const steps: string[] = [];
  
  for (const factor of factors) {
    switch (factor.type) {
      case 'major-version':
        steps.push('Review official migration guide');
        steps.push('Run comprehensive test suite');
        break;
      case 'api-changes':
        steps.push('Update API usage according to changelog');
        break;
      case 'config-changes':
        steps.push('Update configuration files');
        break;
    }
  }
  
  return [...new Set(steps)]; // Remove duplicates
}