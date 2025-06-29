import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface DependencyUsage {
  packageName: string;
  dependents: DependentInfo[];
  isDirect: boolean;
  usageType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
}

export interface DependentInfo {
  name: string;
  version: string;
  path: string[];
  type: 'direct' | 'transitive';
}

export interface DependencyImpact {
  usage: DependencyUsage;
  riskLevel: 'high' | 'medium' | 'low';
  reason: string;
}

export async function analyzeDependencyUsage(packageName: string): Promise<DependencyUsage | null> {
  try {
    // Try npm first, then yarn
    const npmResult = await analyzeWithNpm(packageName);
    if (npmResult) return npmResult;

    const yarnResult = await analyzeWithYarn(packageName);
    if (yarnResult) return yarnResult;

    // Fallback to package.json analysis
    return await analyzePackageJson(packageName);
  } catch (error) {
    console.debug('Failed to analyze dependency usage:', error);
    return null;
  }
}

async function analyzeWithNpm(packageName: string): Promise<DependencyUsage | null> {
  try {
    // Run npm ls to get dependency tree
    const { stdout } = await execa('npm', ['ls', packageName, '--json', '--depth=10'], {
      reject: false, // npm ls returns non-zero exit code when packages have issues
    });

    const data = JSON.parse(stdout);
    return parseNpmLsOutput(data, packageName);
  } catch (error) {
    console.debug('npm ls failed:', error);
    return null;
  }
}

async function analyzeWithYarn(packageName: string): Promise<DependencyUsage | null> {
  try {
    // Check if yarn.lock exists
    await fs.access('yarn.lock');

    // Run yarn why
    const { stdout } = await execa('yarn', ['why', packageName, '--json'], {
      reject: false,
    });

    const lines = stdout.split('\n').filter(line => line.trim());
    const jsonData = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return parseYarnWhyOutput(jsonData, packageName);
  } catch (error) {
    console.debug('yarn why failed:', error);
    return null;
  }
}

async function analyzePackageJson(packageName: string): Promise<DependencyUsage | null> {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    const dependents: DependentInfo[] = [];
    let usageType: DependencyUsage['usageType'] = 'dependencies';
    let isDirect = false;

    // Check in different dependency types
    const depTypes = [
      'dependencies',
      'devDependencies', 
      'peerDependencies',
      'optionalDependencies'
    ] as const;

    for (const depType of depTypes) {
      if (packageJson[depType] && packageJson[depType][packageName]) {
        isDirect = true;
        usageType = depType;
        dependents.push({
          name: packageJson.name || 'root',
          version: packageJson[depType][packageName],
          path: [packageJson.name || 'root'],
          type: 'direct',
        });
        break;
      }
    }

    if (!isDirect) {
      // Package is not directly listed, might be a transitive dependency
      return {
        packageName,
        dependents: [],
        isDirect: false,
        usageType: 'dependencies',
      };
    }

    return {
      packageName,
      dependents,
      isDirect,
      usageType,
    };
  } catch (error) {
    console.debug('Failed to analyze package.json:', error);
    return null;
  }
}

function parseNpmLsOutput(data: any, packageName: string): DependencyUsage | null {
  const dependents: DependentInfo[] = [];
  let isDirect = false;
  let usageType: DependencyUsage['usageType'] = 'dependencies';

  function traverse(node: any, path: string[]): void {
    if (!node || !node.dependencies) return;

    for (const [depName, depInfo] of Object.entries(node.dependencies)) {
      if (depName === packageName) {
        const info = depInfo as any;
        dependents.push({
          name: depName,
          version: info.version || 'unknown',
          path: [...path, depName],
          type: path.length === 0 ? 'direct' : 'transitive',
        });
        
        if (path.length === 0) {
          isDirect = true;
        }
      }

      // Recursively check nested dependencies
      if (depInfo && typeof depInfo === 'object') {
        traverse(depInfo, [...path, depName]);
      }
    }
  }

  traverse(data, []);

  if (dependents.length === 0) return null;

  return {
    packageName,
    dependents,
    isDirect,
    usageType,
  };
}

function parseYarnWhyOutput(jsonData: any[], packageName: string): DependencyUsage | null {
  const dependents: DependentInfo[] = [];
  let isDirect = false;
  let usageType: DependencyUsage['usageType'] = 'dependencies';

  for (const item of jsonData) {
    if (item.type === 'info' && item.data) {
      const data = item.data;
      if (typeof data === 'string' && data.includes(packageName)) {
        // Parse yarn why output format
        const lines = data.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.includes('=>')) {
            const parts = line.split('=>').map(s => s.trim());
            if (parts.length >= 2) {
              const dependencyChain = parts[0].split('#');
              dependents.push({
                name: dependencyChain[0] || packageName,
                version: parts[1] || 'unknown',
                path: dependencyChain,
                type: dependencyChain.length <= 2 ? 'direct' : 'transitive',
              });
              
              if (dependencyChain.length <= 2) {
                isDirect = true;
              }
            }
          }
        }
      }
    }
  }

  if (dependents.length === 0) return null;

  return {
    packageName,
    dependents,
    isDirect,
    usageType,
  };
}

export function assessDependencyImpact(usage: DependencyUsage): DependencyImpact {
  let riskLevel: 'high' | 'medium' | 'low' = 'low';
  let reason = 'Transitive dependency with minimal impact';

  if (usage.isDirect) {
    if (usage.usageType === 'dependencies') {
      riskLevel = 'high';
      reason = 'Direct production dependency - high impact on runtime';
    } else if (usage.usageType === 'devDependencies') {
      riskLevel = 'medium';
      reason = 'Direct development dependency - may affect build process';
    } else if (usage.usageType === 'peerDependencies') {
      riskLevel = 'high';
      reason = 'Peer dependency - requires careful version compatibility';
    } else if (usage.usageType === 'optionalDependencies') {
      riskLevel = 'low';
      reason = 'Optional dependency - graceful degradation expected';
    }
  } else {
    // Transitive dependency
    const directDependents = usage.dependents.filter(dep => dep.type === 'direct');
    if (directDependents.length > 0) {
      riskLevel = 'medium';
      reason = `Transitive dependency used by ${directDependents.length} direct dependencies`;
    }
  }

  // Adjust risk based on number of dependents
  const totalDependents = usage.dependents.length;
  if (totalDependents > 5) {
    riskLevel = riskLevel === 'low' ? 'medium' : 'high';
    reason += ` (affects ${totalDependents} packages)`;
  }

  return {
    usage,
    riskLevel,
    reason,
  };
}

export function formatDependencyUsage(usage: DependencyUsage): string {
  const lines: string[] = [];
  
  lines.push(`# Dependency Usage Analysis for ${usage.packageName}`);
  lines.push('');
  lines.push(`**Type**: ${usage.isDirect ? 'Direct' : 'Transitive'} dependency`);
  lines.push(`**Category**: ${usage.usageType}`);
  lines.push(`**Dependents**: ${usage.dependents.length}`);
  lines.push('');

  if (usage.dependents.length > 0) {
    lines.push('## Dependency Chain');
    
    const directDeps = usage.dependents.filter(dep => dep.type === 'direct');
    const transitiveDeps = usage.dependents.filter(dep => dep.type === 'transitive');

    if (directDeps.length > 0) {
      lines.push('### Direct Dependencies');
      for (const dep of directDeps.slice(0, 10)) {
        lines.push(`- **${dep.name}** (${dep.version})`);
        if (dep.path.length > 1) {
          lines.push(`  - Path: ${dep.path.join(' → ')}`);
        }
      }
      if (directDeps.length > 10) {
        lines.push(`- ... and ${directDeps.length - 10} more`);
      }
      lines.push('');
    }

    if (transitiveDeps.length > 0) {
      lines.push('### Transitive Dependencies');
      for (const dep of transitiveDeps.slice(0, 5)) {
        lines.push(`- **${dep.name}** (${dep.version})`);
        lines.push(`  - Path: ${dep.path.join(' → ')}`);
      }
      if (transitiveDeps.length > 5) {
        lines.push(`- ... and ${transitiveDeps.length - 5} more`);
      }
    }
  }

  return lines.join('\n');
}