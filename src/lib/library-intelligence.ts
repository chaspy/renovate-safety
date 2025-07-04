import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface LibraryIntelligence {
  packageName: string;
  packageInfo: PackageInfo;
  ecosystemInfo: EcosystemInfo;
  maintenanceInfo: MaintenanceInfo;
  securityInfo: SecurityInfo;
  popularityMetrics: PopularityMetrics;
  technicalDetails: TechnicalDetails;
  migrationIntelligence: MigrationIntelligence;
}

export interface PackageInfo {
  description: string;
  keywords: string[];
  license: string;
  homepage?: string;
  repository?: string;
  author?: string;
  maintainers: string[];
  latestVersion: string;
  publishedAt: string;
  size: {
    unpacked: number;
    gzipped?: number;
  };
}

export interface EcosystemInfo {
  packageManager: 'npm' | 'pypi' | 'gem' | 'cargo' | 'go' | 'other';
  runtime: string[];
  framework: string[];
  category: string[];
  alternatives: AlternativePackage[];
  complementaryPackages: string[];
}

export interface AlternativePackage {
  name: string;
  reason: string;
  pros: string[];
  cons: string[];
  migrationEffort: 'low' | 'medium' | 'high';
}

export interface MaintenanceInfo {
  lastUpdated: string;
  releaseFrequency: 'very-active' | 'active' | 'moderate' | 'slow' | 'inactive';
  maintainerResponse: 'excellent' | 'good' | 'average' | 'poor' | 'unknown';
  openIssues: number;
  closedIssues: number;
  openPullRequests: number;
  communityHealth: 'excellent' | 'good' | 'average' | 'poor';
  funding: boolean;
  sponsors: string[];
}

export interface SecurityInfo {
  vulnerabilities: SecurityVulnerability[];
  securityScore: number; // 0-100
  auditStatus: 'clean' | 'warnings' | 'vulnerabilities' | 'unknown';
  lastAudit: string;
  securityPolicy: boolean;
  codeOfConduct: boolean;
}

export interface SecurityVulnerability {
  id: string;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  title: string;
  description: string;
  affectedVersions: string;
  patchedIn?: string;
  cwe?: string[];
}

export interface PopularityMetrics {
  downloads: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  githubStars?: number;
  githubForks?: number;
  dependentRepos: number;
  dependentPackages: number;
  trendingScore: number; // -100 to 100
}

export interface TechnicalDetails {
  bundleSize: {
    minified?: number;
    gzipped?: number;
  };
  treeshakeable: boolean;
  hasTypes: boolean;
  nodeSupport: string[];
  browserSupport: string[];
  dependencies: {
    production: number;
    development: number;
    peer: number;
    optional: number;
  };
  exports: ModuleExport[];
  apiSurface: ApiSurface;
}

export interface ModuleExport {
  name: string;
  type: 'function' | 'class' | 'constant' | 'type' | 'namespace';
  stability: 'stable' | 'experimental' | 'deprecated';
}

export interface ApiSurface {
  publicMethods: number;
  publicClasses: number;
  publicConstants: number;
  complexity: 'simple' | 'moderate' | 'complex' | 'very-complex';
}

export interface MigrationIntelligence {
  fromVersion: string;
  toVersion: string;
  migrationGuide?: string;
  codemods: Codemod[];
  breakingChanges: DetailedBreakingChange[];
  apiChanges: ApiChange[];
  configChanges: ConfigChange[];
  estimatedEffort: {
    timeInHours: number;
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'major';
    automatable: number; // percentage
  };
}

export interface Codemod {
  name: string;
  description: string;
  command: string;
  coverage: number; // percentage of changes it can handle
}

export interface DetailedBreakingChange {
  type: 'api-removal' | 'api-change' | 'behavior-change' | 'config-change' | 'dependency-change';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedApis: string[];
  migrationPath: string;
  codeExample?: {
    before: string;
    after: string;
  };
  automationAvailable: boolean;
}

export interface ApiChange {
  api: string;
  changeType: 'removed' | 'renamed' | 'signature-changed' | 'deprecated';
  oldSignature?: string;
  newSignature?: string;
  deprecationDate?: string;
  removalDate?: string;
}

export interface ConfigChange {
  configFile: string;
  property: string;
  changeType: 'removed' | 'renamed' | 'default-changed' | 'validation-changed';
  oldValue?: string;
  newValue?: string;
  migrationInstructions: string;
}

export async function gatherLibraryIntelligence(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<LibraryIntelligence> {
  console.log(`🔍 Gathering comprehensive intelligence for ${packageName}...`);
  
  const [
    packageInfo,
    ecosystemInfo,
    maintenanceInfo,
    securityInfo,
    popularityMetrics,
    technicalDetails,
    migrationIntelligence
  ] = await Promise.allSettled([
    gatherPackageInfo(packageName),
    gatherEcosystemInfo(packageName),
    gatherMaintenanceInfo(packageName),
    gatherSecurityInfo(packageName),
    gatherPopularityMetrics(packageName),
    gatherTechnicalDetails(packageName, toVersion),
    gatherMigrationIntelligence(packageName, fromVersion, toVersion)
  ]);

  return {
    packageName,
    packageInfo: packageInfo.status === 'fulfilled' ? packageInfo.value : getDefaultPackageInfo(),
    ecosystemInfo: ecosystemInfo.status === 'fulfilled' ? ecosystemInfo.value : getDefaultEcosystemInfo(),
    maintenanceInfo: maintenanceInfo.status === 'fulfilled' ? maintenanceInfo.value : getDefaultMaintenanceInfo(),
    securityInfo: securityInfo.status === 'fulfilled' ? securityInfo.value : getDefaultSecurityInfo(),
    popularityMetrics: popularityMetrics.status === 'fulfilled' ? popularityMetrics.value : getDefaultPopularityMetrics(),
    technicalDetails: technicalDetails.status === 'fulfilled' ? technicalDetails.value : getDefaultTechnicalDetails(),
    migrationIntelligence: migrationIntelligence.status === 'fulfilled' ? migrationIntelligence.value : getDefaultMigrationIntelligence(fromVersion, toVersion)
  };
}

async function gatherPackageInfo(packageName: string): Promise<PackageInfo> {
  try {
    // Get package info from npm registry
    const { stdout } = await execa('npm', ['view', packageName, '--json'], {
      timeout: 10000
    });
    
    const data = JSON.parse(stdout);
    
    return {
      description: data.description || 'No description available',
      keywords: data.keywords || [],
      license: data.license || 'Unknown',
      homepage: data.homepage,
      repository: typeof data.repository === 'object' ? data.repository.url : data.repository,
      author: typeof data.author === 'object' ? data.author.name : data.author,
      maintainers: data.maintainers?.map((m: any) => typeof m === 'object' ? m.name : m) || [],
      latestVersion: data.version,
      publishedAt: data.time?.[data.version] || data.time?.created,
      size: {
        unpacked: data.dist?.unpackedSize || 0,
        gzipped: data.dist?.['npm-signature'] ? undefined : 0
      }
    };
  } catch (error) {
    console.debug('Failed to gather package info:', error);
    return getDefaultPackageInfo();
  }
}

async function gatherEcosystemInfo(packageName: string): Promise<EcosystemInfo> {
  try {
    // Analyze package ecosystem
    const { stdout } = await execa('npm', ['view', packageName, 'keywords', 'peerDependencies', '--json'], {
      timeout: 10000
    });
    
    const data = JSON.parse(stdout);
    const keywords = data.keywords || [];
    
    // Determine category based on keywords and package name
    const category = categorizePackage(packageName, keywords);
    const framework = detectFramework(packageName, keywords);
    const runtime = detectRuntime(packageName, keywords);
    
    return {
      packageManager: 'npm',
      runtime,
      framework,
      category,
      alternatives: await findAlternatives(packageName, category),
      complementaryPackages: findComplementaryPackages(packageName)
    };
  } catch (error) {
    console.debug('Failed to gather ecosystem info:', error);
    return getDefaultEcosystemInfo();
  }
}

async function gatherMaintenanceInfo(packageName: string): Promise<MaintenanceInfo> {
  try {
    // Get maintenance metrics from GitHub API if available
    const repoInfo = await getGitHubRepoInfo(packageName);
    
    if (repoInfo) {
      return {
        lastUpdated: repoInfo.updated_at,
        releaseFrequency: analyzeReleaseFrequency(repoInfo),
        maintainerResponse: 'unknown', // Would need GitHub API analysis
        openIssues: repoInfo.open_issues_count,
        closedIssues: 0, // Would need additional API call
        openPullRequests: 0, // Would need additional API call
        communityHealth: 'unknown',
        funding: !!repoInfo.has_funding,
        sponsors: []
      };
    }
    
    return getDefaultMaintenanceInfo();
  } catch (error) {
    console.debug('Failed to gather maintenance info:', error);
    return getDefaultMaintenanceInfo();
  }
}

async function gatherSecurityInfo(packageName: string): Promise<SecurityInfo> {
  try {
    // Run npm audit for the specific package
    const { stdout } = await execa('npm', ['audit', '--json'], {
      timeout: 15000,
      reject: false
    });
    
    const auditData = JSON.parse(stdout);
    const vulnerabilities = extractVulnerabilities(auditData, packageName);
    
    return {
      vulnerabilities,
      securityScore: calculateSecurityScore(vulnerabilities),
      auditStatus: vulnerabilities.length > 0 ? 'vulnerabilities' : 'clean',
      lastAudit: new Date().toISOString(),
      securityPolicy: await hasSecurityPolicy(packageName),
      codeOfConduct: await hasCodeOfConduct(packageName)
    };
  } catch (error) {
    console.debug('Failed to gather security info:', error);
    return getDefaultSecurityInfo();
  }
}

async function gatherPopularityMetrics(packageName: string): Promise<PopularityMetrics> {
  try {
    // Get download stats from npm
    const { stdout: downloadsData } = await execa('npm', ['view', packageName, '--json'], {
      timeout: 10000
    });
    
    const packageData = JSON.parse(downloadsData);
    
    // Get GitHub stats if repository is available
    const githubStats = await getGitHubStats(packageName);
    
    return {
      downloads: {
        daily: 0, // Would need downloads API
        weekly: 0,
        monthly: 0
      },
      githubStars: githubStats?.stargazers_count,
      githubForks: githubStats?.forks_count,
      dependentRepos: 0, // Would need dependents API
      dependentPackages: 0,
      trendingScore: 0
    };
  } catch (error) {
    console.debug('Failed to gather popularity metrics:', error);
    return getDefaultPopularityMetrics();
  }
}

async function gatherTechnicalDetails(packageName: string, version: string): Promise<TechnicalDetails> {
  try {
    // Get package.json to analyze technical details
    const { stdout } = await execa('npm', ['view', `${packageName}@${version}`, '--json'], {
      timeout: 10000
    });
    
    const data = JSON.parse(stdout);
    
    return {
      bundleSize: {
        minified: data.dist?.unpackedSize,
        gzipped: undefined // Would need bundlephobia API
      },
      treeshakeable: hasESModules(data),
      hasTypes: hasTypeDefinitions(packageName, data),
      nodeSupport: parseNodeSupport(data.engines?.node),
      browserSupport: parseBrowserSupport(data.browserslist),
      dependencies: {
        production: Object.keys(data.dependencies || {}).length,
        development: Object.keys(data.devDependencies || {}).length,
        peer: Object.keys(data.peerDependencies || {}).length,
        optional: Object.keys(data.optionalDependencies || {}).length
      },
      exports: [], // Would need static analysis
      apiSurface: {
        publicMethods: 0,
        publicClasses: 0,
        publicConstants: 0,
        complexity: 'moderate'
      }
    };
  } catch (error) {
    console.debug('Failed to gather technical details:', error);
    return getDefaultTechnicalDetails();
  }
}

async function gatherMigrationIntelligence(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<MigrationIntelligence> {
  try {
    // Look for migration guides and codemods
    const migrationGuide = await findMigrationGuide(packageName, fromVersion, toVersion);
    const codemods = await findCodemods(packageName, fromVersion, toVersion);
    const breakingChanges = await analyzeBreakingChanges(packageName, fromVersion, toVersion);
    
    return {
      fromVersion,
      toVersion,
      migrationGuide,
      codemods,
      breakingChanges,
      apiChanges: [], // Would need detailed changelog analysis
      configChanges: [], // Would need config schema comparison
      estimatedEffort: estimateMigrationEffort(breakingChanges, codemods)
    };
  } catch (error) {
    console.debug('Failed to gather migration intelligence:', error);
    return getDefaultMigrationIntelligence(fromVersion, toVersion);
  }
}

// Helper functions for data processing
function categorizePackage(packageName: string, keywords: string[]): string[] {
  const categories: string[] = [];
  
  // UI/Frontend
  if (keywords.some(k => ['ui', 'component', 'react', 'vue', 'angular'].includes(k.toLowerCase()))) {
    categories.push('frontend');
  }
  
  // Build tools
  if (keywords.some(k => ['build', 'bundler', 'webpack', 'rollup'].includes(k.toLowerCase()))) {
    categories.push('build-tool');
  }
  
  // Testing
  if (keywords.some(k => ['test', 'testing', 'jest', 'mocha'].includes(k.toLowerCase())) || 
      packageName.includes('test')) {
    categories.push('testing');
  }
  
  // Utility
  if (keywords.some(k => ['utility', 'util', 'helper', 'lodash'].includes(k.toLowerCase()))) {
    categories.push('utility');
  }
  
  return categories.length > 0 ? categories : ['unknown'];
}

function detectFramework(packageName: string, keywords: string[]): string[] {
  const frameworks: string[] = [];
  
  if (packageName.includes('react') || keywords.includes('react')) frameworks.push('React');
  if (packageName.includes('vue') || keywords.includes('vue')) frameworks.push('Vue');
  if (packageName.includes('angular') || keywords.includes('angular')) frameworks.push('Angular');
  if (packageName.includes('svelte') || keywords.includes('svelte')) frameworks.push('Svelte');
  if (packageName.includes('next') || keywords.includes('nextjs')) frameworks.push('Next.js');
  
  return frameworks;
}

function detectRuntime(packageName: string, keywords: string[]): string[] {
  const runtimes: string[] = [];
  
  if (keywords.includes('node') || keywords.includes('nodejs')) runtimes.push('Node.js');
  if (keywords.includes('browser') || keywords.includes('client')) runtimes.push('Browser');
  if (keywords.includes('deno')) runtimes.push('Deno');
  if (keywords.includes('bun')) runtimes.push('Bun');
  
  return runtimes.length > 0 ? runtimes : ['Node.js']; // Default assumption
}

async function findAlternatives(packageName: string, categories: string[]): Promise<AlternativePackage[]> {
  // This would be a curated database of package alternatives
  const alternatives: Record<string, AlternativePackage[]> = {
    'lodash': [
      {
        name: 'ramda',
        reason: 'Functional programming approach',
        pros: ['Immutable', 'Curried functions', 'Better tree-shaking'],
        cons: ['Steeper learning curve', 'Different API'],
        migrationEffort: 'high'
      }
    ],
    'moment': [
      {
        name: 'date-fns',
        reason: 'Modern, modular date library',
        pros: ['Tree-shakeable', 'Immutable', 'Smaller bundle size'],
        cons: ['Different API', 'No global state'],
        migrationEffort: 'medium'
      }
    ]
  };
  
  return alternatives[packageName] || [];
}

function findComplementaryPackages(packageName: string): string[] {
  // This would be a curated database of commonly used packages together
  const complements: Record<string, string[]> = {
    'react': ['react-dom', 'react-router', 'styled-components'],
    'jest': ['@testing-library/jest-dom', '@testing-library/react'],
    'webpack': ['webpack-cli', 'webpack-dev-server']
  };
  
  return complements[packageName] || [];
}

// Default value functions
function getDefaultPackageInfo(): PackageInfo {
  return {
    description: 'Information not available',
    keywords: [],
    license: 'Unknown',
    maintainers: [],
    latestVersion: 'Unknown',
    publishedAt: '',
    size: { unpacked: 0 }
  };
}

function getDefaultEcosystemInfo(): EcosystemInfo {
  return {
    packageManager: 'npm',
    runtime: [],
    framework: [],
    category: ['unknown'],
    alternatives: [],
    complementaryPackages: []
  };
}

function getDefaultMaintenanceInfo(): MaintenanceInfo {
  return {
    lastUpdated: '',
    releaseFrequency: 'unknown' as any,
    maintainerResponse: 'unknown',
    openIssues: 0,
    closedIssues: 0,
    openPullRequests: 0,
    communityHealth: 'unknown',
    funding: false,
    sponsors: []
  };
}

function getDefaultSecurityInfo(): SecurityInfo {
  return {
    vulnerabilities: [],
    securityScore: 0,
    auditStatus: 'unknown',
    lastAudit: '',
    securityPolicy: false,
    codeOfConduct: false
  };
}

function getDefaultPopularityMetrics(): PopularityMetrics {
  return {
    downloads: { daily: 0, weekly: 0, monthly: 0 },
    dependentRepos: 0,
    dependentPackages: 0,
    trendingScore: 0
  };
}

function getDefaultTechnicalDetails(): TechnicalDetails {
  return {
    bundleSize: {},
    treeshakeable: false,
    hasTypes: false,
    nodeSupport: [],
    browserSupport: [],
    dependencies: { production: 0, development: 0, peer: 0, optional: 0 },
    exports: [],
    apiSurface: { publicMethods: 0, publicClasses: 0, publicConstants: 0, complexity: 'moderate' }
  };
}

function getDefaultMigrationIntelligence(fromVersion: string, toVersion: string): MigrationIntelligence {
  return {
    fromVersion,
    toVersion,
    codemods: [],
    breakingChanges: [],
    apiChanges: [],
    configChanges: [],
    estimatedEffort: { timeInHours: 0, complexity: 'simple', automatable: 0 }
  };
}

// Placeholder implementations for helper functions
async function getGitHubRepoInfo(packageName: string): Promise<any> {
  // Would implement GitHub API calls
  return null;
}

function analyzeReleaseFrequency(repoInfo: any): MaintenanceInfo['releaseFrequency'] {
  return 'unknown' as any;
}

function extractVulnerabilities(auditData: any, packageName: string): SecurityVulnerability[] {
  return [];
}

function calculateSecurityScore(vulnerabilities: SecurityVulnerability[]): number {
  return 100 - (vulnerabilities.length * 10);
}

async function hasSecurityPolicy(packageName: string): Promise<boolean> {
  return false;
}

async function hasCodeOfConduct(packageName: string): Promise<boolean> {
  return false;
}

async function getGitHubStats(packageName: string): Promise<any> {
  return null;
}

function hasESModules(packageData: any): boolean {
  return !!packageData.module || !!packageData.exports;
}

function hasTypeDefinitions(packageName: string, packageData: any): boolean {
  return !!packageData.types || !!packageData.typings || packageName.startsWith('@types/');
}

function parseNodeSupport(nodeVersion?: string): string[] {
  if (!nodeVersion) return [];
  return [nodeVersion];
}

function parseBrowserSupport(browserslist?: string[]): string[] {
  return browserslist || [];
}

async function findMigrationGuide(packageName: string, fromVersion: string, toVersion: string): Promise<string | undefined> {
  // Would search for migration guides in documentation
  return undefined;
}

async function findCodemods(packageName: string, fromVersion: string, toVersion: string): Promise<Codemod[]> {
  return [];
}

async function analyzeBreakingChanges(packageName: string, fromVersion: string, toVersion: string): Promise<DetailedBreakingChange[]> {
  return [];
}

function estimateMigrationEffort(breakingChanges: DetailedBreakingChange[], codemods: Codemod[]): MigrationIntelligence['estimatedEffort'] {
  const changeCount = breakingChanges.length;
  const automationCoverage = codemods.reduce((acc, mod) => acc + mod.coverage, 0) / codemods.length || 0;
  
  let timeInHours = 0;
  let complexity: MigrationIntelligence['estimatedEffort']['complexity'] = 'trivial';
  
  if (changeCount === 0) {
    timeInHours = 0.5;
    complexity = 'trivial';
  } else if (changeCount <= 2) {
    timeInHours = 2;
    complexity = 'simple';
  } else if (changeCount <= 5) {
    timeInHours = 8;
    complexity = 'moderate';
  } else if (changeCount <= 10) {
    timeInHours = 24;
    complexity = 'complex';
  } else {
    timeInHours = 40;
    complexity = 'major';
  }
  
  return {
    timeInHours,
    complexity,
    automatable: automationCoverage
  };
}