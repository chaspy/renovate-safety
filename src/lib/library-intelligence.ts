import { secureNpmExec } from './secure-exec.js';
import { getPackageRawData } from './npm-registry.js';
import { validatePackageName } from './validation.js';
import { safeJsonParse } from './safe-json.js';
import { loggers } from './logger.js';
import {
  FALLBACK_VALUES,
  RELEASE_FREQUENCIES,
  MAINTAINER_RESPONSES,
  COMMUNITY_HEALTH_LEVELS,
  AUDIT_STATUSES,
  COMPLEXITY_LEVELS,
  MIGRATION_COMPLEXITY,
} from './constants.js';
import {
  createSafeExtractor,
  extractAuthorInfo,
  extractMaintainers,
  extractPublishedDate,
  extractSizeInfo,
  isRecord,
} from './utils/safe-property-access.js';
import {
  categorizePackage,
  detectFramework,
  detectRuntime,
  findAlternatives,
  findComplementaryPackages,
  hasESModules,
  hasTypeDefinitions,
  parseNodeSupport,
  parseBrowserSupport,
} from './utils/package-helpers.js';

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
  loggers.info(`🔍 Gathering comprehensive intelligence for ${packageName}...`);

  const [
    packageInfo,
    ecosystemInfo,
    maintenanceInfo,
    securityInfo,
    popularityMetrics,
    technicalDetails,
    migrationIntelligence,
  ] = await Promise.allSettled([
    gatherPackageInfo(packageName),
    gatherEcosystemInfo(packageName),
    gatherMaintenanceInfo(packageName),
    gatherSecurityInfo(packageName),
    gatherPopularityMetrics(packageName),
    gatherTechnicalDetails(packageName, toVersion),
    gatherMigrationIntelligence(packageName, fromVersion, toVersion),
  ]);

  return {
    packageName,
    packageInfo: packageInfo.status === 'fulfilled' ? packageInfo.value : getDefaultPackageInfo(),
    ecosystemInfo:
      ecosystemInfo.status === 'fulfilled' ? ecosystemInfo.value : getDefaultEcosystemInfo(),
    maintenanceInfo:
      maintenanceInfo.status === 'fulfilled' ? maintenanceInfo.value : getDefaultMaintenanceInfo(),
    securityInfo:
      securityInfo.status === 'fulfilled' ? securityInfo.value : getDefaultSecurityInfo(),
    popularityMetrics:
      popularityMetrics.status === 'fulfilled'
        ? popularityMetrics.value
        : getDefaultPopularityMetrics(),
    technicalDetails:
      technicalDetails.status === 'fulfilled'
        ? technicalDetails.value
        : getDefaultTechnicalDetails(),
    migrationIntelligence:
      migrationIntelligence.status === 'fulfilled'
        ? migrationIntelligence.value
        : getDefaultMigrationIntelligence(fromVersion, toVersion),
  };
}

async function gatherPackageInfo(packageName: string): Promise<PackageInfo> {
  try {
    const safeName = validatePackageName(packageName);
    const data = await getPackageRawData(safeName);

    if (!data) {
      return getDefaultPackageInfo();
    }

    return buildPackageInfo(data);
  } catch (error) {
    console.debug('Failed to gather package info:', error);
    return getDefaultPackageInfo();
  }
}

/**
 * Build PackageInfo from npm metadata
 */
function buildPackageInfo(data: Record<string, unknown>): PackageInfo {
  const extractor = createSafeExtractor(data);
  const author = extractAuthorInfo(data);
  const maintainers = extractMaintainers(data);
  const publishedAt = extractPublishedDate(data, extractor.getString('version'));
  const sizeInfo = extractSizeInfo(data);

  return {
    description: extractor.getString('description', FALLBACK_VALUES.DESCRIPTION),
    keywords: extractor.getArray('keywords'),
    license: extractor.getString('license', FALLBACK_VALUES.LICENSE),
    homepage: extractor.getOptionalString('homepage'),
    repository: extractRepositoryUrl(extractor.getObject('repository')),
    author,
    maintainers,
    latestVersion: extractor.getString('version', FALLBACK_VALUES.VERSION),
    publishedAt,
    size: {
      unpacked: sizeInfo.unpacked,
      gzipped: sizeInfo.gzipped,
    },
  };
}

/**
 * Extract repository URL from repository field
 */
function extractRepositoryUrl(repository: unknown): string | undefined {
  if (typeof repository === 'string') {
    return repository;
  }

  if (isRecord(repository) && 'url' in repository) {
    return typeof repository.url === 'string' ? repository.url : undefined;
  }

  return undefined;
}

async function gatherEcosystemInfo(packageName: string): Promise<EcosystemInfo> {
  try {
    const safeName = validatePackageName(packageName);
    const result = await secureNpmExec(
      'view',
      [safeName, 'keywords', 'peerDependencies', '--json'],
      { timeout: FALLBACK_VALUES.TIMEOUT_DEFAULT }
    );

    if (!result.success) {
      console.debug('Failed to get ecosystem info:', result.error);
      return getDefaultEcosystemInfo();
    }

    return await buildEcosystemInfo(packageName, result.stdout);
  } catch (error) {
    console.debug('Failed to gather ecosystem info:', error);
    return getDefaultEcosystemInfo();
  }
}

/**
 * Build EcosystemInfo from npm data
 */
async function buildEcosystemInfo(packageName: string, stdout: string): Promise<EcosystemInfo> {
  const data = safeJsonParse(stdout, {}) as { keywords?: string[] };
  const keywords = data.keywords || [];

  const category = categorizePackage(packageName, keywords);
  const framework = detectFramework(packageName, keywords);
  const runtime = detectRuntime(packageName, keywords);

  return {
    packageManager: 'npm',
    runtime,
    framework,
    category,
    alternatives: await findAlternatives(packageName, category),
    complementaryPackages: findComplementaryPackages(packageName),
  };
}

async function gatherMaintenanceInfo(packageName: string): Promise<MaintenanceInfo> {
  try {
    const repoInfo = await getGitHubRepoInfo(packageName);

    if (repoInfo) {
      return buildMaintenanceInfo(repoInfo);
    }

    return getDefaultMaintenanceInfo();
  } catch (error) {
    console.debug('Failed to gather maintenance info:', error);
    return getDefaultMaintenanceInfo();
  }
}

/**
 * Build MaintenanceInfo from GitHub repository data
 */
function buildMaintenanceInfo(repoInfo: unknown): MaintenanceInfo {
  const extractor = createSafeExtractor(repoInfo);

  return {
    lastUpdated: extractor.getString('updated_at', FALLBACK_VALUES.EMPTY_STRING),
    releaseFrequency: analyzeReleaseFrequency(repoInfo),
    maintainerResponse: MAINTAINER_RESPONSES.UNKNOWN,
    openIssues: extractor.getNumber('open_issues_count', 0),
    closedIssues: 0, // Would need additional API call
    openPullRequests: 0, // Would need additional API call
    communityHealth: COMMUNITY_HEALTH_LEVELS.AVERAGE,
    funding: extractor.getBoolean('has_funding', false),
    sponsors: [],
  };
}

async function gatherSecurityInfo(packageName: string): Promise<SecurityInfo> {
  try {
    // Run npm audit using secure execution
    const result = await secureNpmExec('audit', ['--json'], {
      timeout: 15000,
    });

    // npm audit returns non-zero exit code when vulnerabilities found, but that's ok
    const auditData = result.stdout ? safeJsonParse(result.stdout, {}) : {};
    const vulnerabilities = extractVulnerabilities(auditData, packageName);

    return {
      vulnerabilities,
      securityScore: calculateSecurityScore(vulnerabilities),
      auditStatus: vulnerabilities.length > 0 ? 'vulnerabilities' : 'clean',
      lastAudit: new Date().toISOString(),
      securityPolicy: await hasSecurityPolicy(packageName),
      codeOfConduct: await hasCodeOfConduct(packageName),
    };
  } catch (error) {
    console.debug('Failed to gather security info:', error);
    return getDefaultSecurityInfo();
  }
}

async function gatherPopularityMetrics(packageName: string): Promise<PopularityMetrics> {
  try {
    // Validate package name first
    const safeName = validatePackageName(packageName);

    // Get package data using centralized utility
    const packageData = await getPackageRawData(safeName);

    if (!packageData) {
      return getDefaultPopularityMetrics();
    }

    // Get GitHub stats if repository is available
    const githubStats = await getGitHubStats(packageName);

    let githubStars = 0;
    let githubForks = 0;

    if (githubStats && typeof githubStats === 'object') {
      const stats = githubStats as Record<string, unknown>;
      githubStars = typeof stats.stargazers_count === 'number' ? stats.stargazers_count : 0;
      githubForks = typeof stats.forks_count === 'number' ? stats.forks_count : 0;
    }

    return {
      downloads: {
        daily: 0, // Would need downloads API
        weekly: 0,
        monthly: 0,
      },
      githubStars,
      githubForks,
      dependentRepos: 0, // Would need dependents API
      dependentPackages: 0,
      trendingScore: 0,
    };
  } catch (error) {
    console.debug('Failed to gather popularity metrics:', error);
    return getDefaultPopularityMetrics();
  }
}

async function gatherTechnicalDetails(
  packageName: string,
  version: string
): Promise<TechnicalDetails> {
  try {
    // Validate inputs first
    const safeName = validatePackageName(packageName);
    const safeVersion = version; // Version is already validated in the package string

    // Get package.json to analyze technical details
    const data = await getPackageRawData(`${safeName}@${safeVersion}`);

    if (!data) {
      return getDefaultTechnicalDetails();
    }

    const extendedData = data;

    // Safe extraction of dist information
    const distData =
      extendedData.dist && typeof extendedData.dist === 'object'
        ? (extendedData.dist as Record<string, unknown>)
        : {};
    const unpackedSize =
      typeof distData.unpackedSize === 'number' ? distData.unpackedSize : undefined;

    // Safe extraction of engines information
    const enginesData =
      extendedData.engines && typeof extendedData.engines === 'object'
        ? (extendedData.engines as Record<string, unknown>)
        : {};
    const nodeVersion = typeof enginesData.node === 'string' ? enginesData.node : undefined;

    // Safe extraction of browserslist
    const browserslistData = Array.isArray(extendedData.browserslist)
      ? (extendedData.browserslist as string[])
      : undefined;

    // Safe extraction of optional dependencies
    const optionalDeps =
      extendedData.optionalDependencies && typeof extendedData.optionalDependencies === 'object'
        ? (extendedData.optionalDependencies as Record<string, unknown>)
        : {};

    return {
      bundleSize: {
        minified: unpackedSize,
        gzipped: undefined, // Would need bundlephobia API
      },
      treeshakeable: hasESModules(extendedData),
      hasTypes: hasTypeDefinitions(packageName, extendedData),
      nodeSupport: parseNodeSupport(nodeVersion),
      browserSupport: parseBrowserSupport(browserslistData),
      dependencies: {
        production: Object.keys(data.dependencies || {}).length,
        development: Object.keys(data.devDependencies || {}).length,
        peer: Object.keys(data.peerDependencies || {}).length,
        optional: Object.keys(optionalDeps).length,
      },
      exports: [], // Would need static analysis
      apiSurface: {
        publicMethods: 0,
        publicClasses: 0,
        publicConstants: 0,
        complexity: 'moderate',
      },
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
      estimatedEffort: estimateMigrationEffort(breakingChanges, codemods),
    };
  } catch (error) {
    console.debug('Failed to gather migration intelligence:', error);
    return getDefaultMigrationIntelligence(fromVersion, toVersion);
  }
}

// Helper functions are now imported from utils/package-helpers.ts

// Default value functions
function getDefaultPackageInfo(): PackageInfo {
  return {
    description: FALLBACK_VALUES.DESCRIPTION,
    keywords: [],
    license: FALLBACK_VALUES.LICENSE,
    maintainers: [],
    latestVersion: FALLBACK_VALUES.VERSION,
    publishedAt: FALLBACK_VALUES.EMPTY_STRING,
    size: { unpacked: FALLBACK_VALUES.UNPACKED_SIZE },
  };
}

function getDefaultEcosystemInfo(): EcosystemInfo {
  return {
    packageManager: 'npm',
    runtime: [],
    framework: [],
    category: ['unknown'],
    alternatives: [],
    complementaryPackages: [],
  };
}

function getDefaultMaintenanceInfo(): MaintenanceInfo {
  return {
    lastUpdated: FALLBACK_VALUES.EMPTY_STRING,
    releaseFrequency: RELEASE_FREQUENCIES.INACTIVE,
    maintainerResponse: MAINTAINER_RESPONSES.UNKNOWN,
    openIssues: 0,
    closedIssues: 0,
    openPullRequests: 0,
    communityHealth: COMMUNITY_HEALTH_LEVELS.AVERAGE,
    funding: false,
    sponsors: [],
  };
}

function getDefaultSecurityInfo(): SecurityInfo {
  return {
    vulnerabilities: [],
    securityScore: 0,
    auditStatus: AUDIT_STATUSES.UNKNOWN,
    lastAudit: FALLBACK_VALUES.EMPTY_STRING,
    securityPolicy: false,
    codeOfConduct: false,
  };
}

function getDefaultPopularityMetrics(): PopularityMetrics {
  return {
    downloads: { daily: 0, weekly: 0, monthly: 0 },
    dependentRepos: 0,
    dependentPackages: 0,
    trendingScore: 0,
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
    apiSurface: {
      publicMethods: 0,
      publicClasses: 0,
      publicConstants: 0,
      complexity: COMPLEXITY_LEVELS.MODERATE,
    },
  };
}

function getDefaultMigrationIntelligence(
  fromVersion: string,
  toVersion: string
): MigrationIntelligence {
  return {
    fromVersion,
    toVersion,
    codemods: [],
    breakingChanges: [],
    apiChanges: [],
    configChanges: [],
    estimatedEffort: {
      timeInHours: 0,
      complexity: MIGRATION_COMPLEXITY.SIMPLE,
      automatable: 0,
    },
  };
}

// Placeholder implementations for helper functions
async function getGitHubRepoInfo(_packageName: string): Promise<unknown> {
  // Would implement GitHub API calls
  return null;
}

function analyzeReleaseFrequency(_repoInfo: unknown): MaintenanceInfo['releaseFrequency'] {
  return RELEASE_FREQUENCIES.MODERATE;
}

function extractVulnerabilities(
  _auditData: unknown,
  _packageName: string
): SecurityVulnerability[] {
  return [];
}

function calculateSecurityScore(vulnerabilities: SecurityVulnerability[]): number {
  return 100 - vulnerabilities.length * 10;
}

async function hasSecurityPolicy(_packageName: string): Promise<boolean> {
  return false;
}

async function hasCodeOfConduct(_packageName: string): Promise<boolean> {
  return false;
}

async function getGitHubStats(_packageName: string): Promise<unknown> {
  return null;
}

// Helper functions are now imported from package-helpers.ts

async function findMigrationGuide(
  _packageName: string,
  _fromVersion: string,
  _toVersion: string
): Promise<string | undefined> {
  // Would search for migration guides in documentation
  return undefined;
}

async function findCodemods(
  _packageName: string,
  _fromVersion: string,
  _toVersion: string
): Promise<Codemod[]> {
  return [];
}

async function analyzeBreakingChanges(
  _packageName: string,
  _fromVersion: string,
  _toVersion: string
): Promise<DetailedBreakingChange[]> {
  return [];
}

function estimateMigrationEffort(
  breakingChanges: DetailedBreakingChange[],
  codemods: Codemod[]
): MigrationIntelligence['estimatedEffort'] {
  const changeCount = breakingChanges.length;
  const automationCoverage =
    codemods.reduce((acc, mod) => acc + mod.coverage, 0) / codemods.length || 0;

  let timeInHours = 0;
  let complexity: MigrationIntelligence['estimatedEffort']['complexity'] = 'trivial';

  if (changeCount === 0) {
    timeInHours = 0.5;
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
    automatable: automationCoverage,
  };
}
