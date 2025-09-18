import type { TsUsage } from '../tools/ts-usage-scanner.js';
import type { ConfigUsage } from '../tools/config-scanner.js';

export type ImpactAnalysis = {
  level: 'minimal' | 'low' | 'medium' | 'high';
  score: number;
  criticalPaths: CriticalPath[];
  recommendations: string[];
  totalCount: number;
  byType: Record<string, number>;
  files: string[];
};

export type CriticalPath = {
  file: string;
  line: number;
  reason: string;
};

export type AnalyzeImpactInput = {
  codeUsage: TsUsage[];
  configUsage: ConfigUsage[];
  breakingChanges: string[];
};

export function analyzeImpact(
  usages: Array<TsUsage | ConfigUsage>,
  breakingChanges: string[]
): ImpactAnalysis {
  const impactScore = calculateImpactScore(usages, breakingChanges);
  const criticalPaths = findCriticalPaths(usages);
  const byType = calculateUsageByType(usages);
  const files = extractUniqueFiles(usages);
  
  return {
    level: getImpactLevel(impactScore),
    score: impactScore,
    criticalPaths,
    recommendations: generateRecommendations(usages, impactScore, breakingChanges),
    totalCount: usages.length,
    byType,
    files,
  };
}

export function analyzeUsage(input: AnalyzeImpactInput): ImpactAnalysis {
  const allUsages = [...input.codeUsage, ...input.configUsage];
  return analyzeImpact(allUsages, input.breakingChanges);
}

function calculateImpactScore(
  usages: Array<TsUsage | ConfigUsage>,
  breakingChanges: string[]
): number {
  let score = 0;
  
  // Base score from usage count (max 20 points)
  score += Math.min(usages.length * 0.5, 20);
  
  // Additional score for critical usage types
  const criticalTypes = ['function-call', 'constructor', 'extends'];
  for (const usage of usages) {
    if (criticalTypes.includes(usage.type)) {
      score += 2;
    }
  }
  
  // Score for breaking changes affecting actual usage
  for (const breaking of breakingChanges) {
    const affected = usages.filter(u => {
      if ('code' in u && u.code?.includes(breaking)) {
        return true;
      }
      if ('specifiers' in u && u.specifiers?.includes(breaking)) {
        return true;
      }
      if ('content' in u && u.content.includes(breaking)) {
        return true;
      }
      return false;
    });
    score += affected.length * 3;
  }
  
  // Extra points for config file changes (they affect the whole project)
  const configUsages = usages.filter(u => u.type === 'config');
  if (configUsages.length > 0) {
    score += 10;
  }
  
  // Extra points for main/index file usage
  const mainFileUsages = usages.filter(u => 
    u.file.includes('index') || 
    u.file.includes('main') || 
    u.file.includes('app')
  );
  if (mainFileUsages.length > 0) {
    score += 5;
  }
  
  return Math.min(score, 100);
}

function getImpactLevel(score: number): ImpactAnalysis['level'] {
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  if (score >= 5) return 'low';
  return 'minimal';
}

function findCriticalPaths(usages: Array<TsUsage | ConfigUsage>): CriticalPath[] {
  const critical: CriticalPath[] = [];

  for (const usage of usages) {
    const reason = determineCriticalReason(usage);
    if (reason) {
      critical.push({
        file: usage.file,
        line: usage.line,
        reason,
      });
    }
  }

  return removeDuplicatePaths(critical).slice(0, 10);
}

function determineCriticalReason(usage: TsUsage | ConfigUsage): string | null {
  const fileReason = getCriticalFileReason(usage.file);
  const typeReason = getCriticalUsageTypeReason(usage.type);

  if (fileReason && typeReason) {
    return `${fileReason} (${typeReason})`;
  }
  return fileReason || typeReason;
}

function getCriticalFileReason(file: string): string | null {
  const criticalFilePatterns: Array<[string, string]> = [
    ['index', 'Entry point file'],
    ['main', 'Main application file'],
    ['app', 'Application root file'],
    ['config', 'Configuration file'],
  ];

  // Special case for exact match
  if (file === 'package.json') {
    return 'Project configuration file';
  }

  for (const [pattern, reason] of criticalFilePatterns) {
    if (file.includes(pattern)) {
      return reason;
    }
  }

  return null;
}

function getCriticalUsageTypeReason(type: string): string | null {
  const criticalTypes: Record<string, string> = {
    'constructor': 'Constructor usage',
    'extends': 'Class inheritance',
    'config': 'Configuration dependency',
  };

  return criticalTypes[type] || null;
}

function removeDuplicatePaths(paths: CriticalPath[]): CriticalPath[] {
  const uniquePaths: CriticalPath[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    const key = `${path.file}:${path.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePaths.push(path);
    }
  }

  return uniquePaths;
}

function generateRecommendations(
  usages: Array<TsUsage | ConfigUsage>,
  score: number,
  breakingChanges: string[]
): string[] {
  const recommendations: string[] = [];
  
  // High impact recommendations
  if (score >= 50) {
    recommendations.push('⚠️ High impact detected - thorough testing required before merging');
    recommendations.push('📋 Review all usage locations for compatibility with the new version');
    recommendations.push('🔍 Consider a phased rollout or feature flag approach');
  }
  
  // Medium impact recommendations
  if (score >= 20 && score < 50) {
    recommendations.push('⚠️ Medium impact - review changes carefully');
    recommendations.push('🧪 Run comprehensive test suite before merging');
  }
  
  // Type-related recommendations
  const typeUsages = usages.filter(u => u.type === 'type-reference');
  if (typeUsages.length > 0) {
    recommendations.push('📝 Check TypeScript compilation after update');
    recommendations.push('🔧 Review type definitions for breaking changes');
  }
  
  // Test-related recommendations
  const testFiles = usages.filter(u => 
    u.file.includes('test') || 
    u.file.includes('spec') ||
    u.file.includes('__tests__')
  );
  if (testFiles.length > 0) {
    recommendations.push('✅ Update affected tests to match new API');
  }
  
  // Constructor/Class usage
  const constructorUsages = usages.filter(u => 
    u.type === 'constructor' || u.type === 'extends'
  );
  if (constructorUsages.length > 0) {
    recommendations.push('🏗️ Check constructor signatures and class inheritance');
  }
  
  // Config file changes
  const configUsages = usages.filter(u => u.type === 'config');
  if (configUsages.length > 0) {
    recommendations.push('⚙️ Review configuration file changes');
    recommendations.push('📦 Consider impact on build and deployment processes');
  }
  
  // Breaking changes specific
  if (breakingChanges.length > 0) {
    recommendations.push(`⚡ ${breakingChanges.length} breaking change(s) detected - migration may be required`);
    
    // Check if any breaking changes affect actual usage
    const affectedByBreaking = usages.filter(u => {
      for (const breaking of breakingChanges) {
        if ('code' in u && u.code?.includes(breaking)) return true;
        if ('content' in u && u.content.includes(breaking)) return true;
        if ('specifiers' in u && u.specifiers?.includes(breaking)) return true;
      }
      return false;
    });
    
    if (affectedByBreaking.length > 0) {
      recommendations.push(`🎯 ${affectedByBreaking.length} usage(s) directly affected by breaking changes`);
    }
  }
  
  // Low impact
  if (score < 5) {
    recommendations.push('✅ Low impact - consider auto-merge if tests pass');
    recommendations.push('🚀 Safe to proceed with standard review process');
  }
  
  // Always recommend
  if (usages.length > 0) {
    recommendations.push(`📊 Found ${usages.length} total usage(s) across ${extractUniqueFiles(usages).length} file(s)`);
  }
  
  return recommendations;
}

function calculateUsageByType(usages: Array<TsUsage | ConfigUsage>): Record<string, number> {
  const byType: Record<string, number> = Object.create(null);
  
  for (const usage of usages) {
    const type = usage.type;
    byType[type] = (byType[type] || 0) + 1;
  }
  
  return byType;
}

function extractUniqueFiles(usages: Array<TsUsage | ConfigUsage>): string[] {
  const files = new Set<string>();
  
  for (const usage of usages) {
    files.add(usage.file);
  }
  
  return Array.from(files).sort((a, b) => a.localeCompare(b));
}

// Utility function for determining criticality reason
export function determineCriticality(usage: TsUsage | ConfigUsage): string {
  const reasons: string[] = [];
  
  // File-based criticality
  if (usage.file.includes('index')) {
    reasons.push('Entry point');
  }
  if (usage.file.includes('main')) {
    reasons.push('Main file');
  }
  if (usage.file.includes('app')) {
    reasons.push('Application file');
  }
  if (usage.file.endsWith('.config.js') || usage.file.endsWith('.config.ts')) {
    reasons.push('Configuration');
  }
  
  // Usage type criticality
  if (usage.type === 'constructor') {
    reasons.push('Constructor');
  }
  if (usage.type === 'extends') {
    reasons.push('Inheritance');
  }
  if (usage.type === 'config') {
    reasons.push('Config dependency');
  }
  
  return reasons.join(', ') || 'Standard usage';
}