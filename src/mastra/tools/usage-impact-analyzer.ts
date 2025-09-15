/**
 * Usage Impact Analyzer
 * Analyzes actual code usage patterns to determine if breaking changes affect the project
 */

import { glob } from 'glob';
import * as fs from 'fs/promises';

export interface UsagePattern {
  pattern: RegExp;
  description: string;
  riskLevel: 'high' | 'medium' | 'low';
}

export interface UsageImpact {
  isAffected: boolean;
  affectedFiles: string[];
  affectedPatterns: string[];
  riskLevel: 'high' | 'medium' | 'low' | 'none';
  confidence: number;
  recommendations: string[];
}

export class UsageImpactAnalyzer {
  
  /**
   * Analyze if breaking changes actually affect the project's usage
   */
  async analyzeImpact(
    packageName: string,
    breakingChanges: Array<{text: string, category: string}>,
    projectRoot: string = process.cwd()
  ): Promise<UsageImpact> {
    
    const usagePatterns = this.getUsagePatternsForPackage(packageName, breakingChanges);
    const codeFiles = await this.findCodeFiles(projectRoot);
    
    const affectedFiles: string[] = [];
    const affectedPatterns: string[] = [];
    let maxRiskLevel: 'high' | 'medium' | 'low' | 'none' = 'none';
    
    for (const file of codeFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        
        // Skip if file doesn't import/use this package
        if (!this.importsPackage(content, packageName)) {
          continue;
        }
        
        for (const {pattern, description, riskLevel} of usagePatterns) {
          if (pattern.test(content)) {
            affectedFiles.push(file);
            affectedPatterns.push(description);
            
            // Update max risk level
            if (this.compareRiskLevel(riskLevel, maxRiskLevel) > 0) {
              maxRiskLevel = riskLevel;
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to analyze file ${file}:`, error);
      }
    }
    
    const isAffected = affectedFiles.length > 0;
    const confidence = this.calculateConfidence(usagePatterns, affectedPatterns);
    const recommendations = this.generateRecommendations(packageName, affectedPatterns, maxRiskLevel);
    
    return {
      isAffected,
      affectedFiles: [...new Set(affectedFiles)], // Remove duplicates
      affectedPatterns: [...new Set(affectedPatterns)], // Remove duplicates
      riskLevel: maxRiskLevel,
      confidence,
      recommendations
    };
  }

  /**
   * Get usage patterns specific to package and its breaking changes
   */
  private getUsagePatternsForPackage(
    packageName: string, 
    breakingChanges: Array<{text: string, category: string}>
  ): UsagePattern[] {
    const patterns: UsagePattern[] = [];
    
    // Package-specific patterns
    if (packageName === 'p-limit') {
      patterns.push({
        pattern: /\.activeCount\b/g,
        description: 'Uses activeCount property',
        riskLevel: 'high'
      });
      
      patterns.push({
        pattern: /\.pendingCount\b/g,
        description: 'Uses pendingCount property',
        riskLevel: 'medium'
      });
      
      patterns.push({
        pattern: /pLimit\s*\(\s*\d+\s*\)/g,
        description: 'Creates limit instance',
        riskLevel: 'low'
      });
    }
    
    // React-specific patterns
    if (packageName.startsWith('react') || packageName === 'react') {
      patterns.push({
        pattern: /componentWillMount|componentWillReceiveProps|componentWillUpdate/g,
        description: 'Uses deprecated lifecycle methods',
        riskLevel: 'high'
      });
      
      patterns.push({
        pattern: /ReactDOM\.render/g,
        description: 'Uses ReactDOM.render (potentially deprecated)',
        riskLevel: 'medium'
      });
    }
    
    // Generic patterns based on breaking change categories
    for (const change of breakingChanges) {
      if (change.category === 'api-change') {
        // Try to extract function names from breaking change text
        // Use limited whitespace matching to prevent ReDoS
        const functionMatch = /function\s{1,3}(\w+)|(\w+)\s{1,3}(?:removed|renamed|changed)/i.exec(change.text);
        if (functionMatch) {
          const functionName = functionMatch[1] || functionMatch[2];
          patterns.push({
            pattern: new RegExp(`\\b${functionName}\\s{0,3}\\(`, 'g'),
            description: `Uses potentially affected function: ${functionName}`,
            riskLevel: 'high'
          });
        }
      }
      
      if (change.category === 'runtime-requirement') {
        // Node.js version checks
        if (change.text.includes('Node.js')) {
          patterns.push({
            pattern: /process\.version|engines\.node/g,
            description: 'Checks Node.js version',
            riskLevel: 'medium'
          });
        }
      }
    }
    
    return patterns;
  }

  /**
   * Find relevant code files in project
   */
  private async findCodeFiles(projectRoot: string): Promise<string[]> {
    const patterns = [
      '**/*.{js,jsx,ts,tsx}',
      '!**/node_modules/**',
      '!**/dist/**',
      '!**/build/**',
      '!**/*.test.*',
      '!**/*.spec.*'
    ];
    
    try {
      const files = await glob(patterns, { 
        cwd: projectRoot,
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
      });
      
      return files.slice(0, 50); // Limit to 50 files for performance
    } catch (error) {
      console.warn('Failed to find code files:', error);
      return [];
    }
  }

  /**
   * Check if file imports/uses the package
   */
  private importsPackage(content: string, packageName: string): boolean {
    const importPatterns = [
      new RegExp(`from\\s+['"\`]${packageName}['"\`]`, 'g'),
      new RegExp(`require\\s*\\(\\s*['"\`]${packageName}['"\`]`, 'g'),
      new RegExp(`import\\s+.+\\s+from\\s+['"\`]${packageName}['"\`]`, 'g')
    ];
    
    return importPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Compare risk levels (higher number = higher risk)
   */
  private compareRiskLevel(level1: string, level2: string): number {
    const levels = { 'none': 0, 'low': 1, 'medium': 2, 'high': 3 };
    return (levels[level1 as keyof typeof levels] || 0) - (levels[level2 as keyof typeof levels] || 0);
  }

  /**
   * Calculate confidence based on pattern coverage
   */
  private calculateConfidence(usagePatterns: UsagePattern[], affectedPatterns: string[]): number {
    if (usagePatterns.length === 0) return 0.5; // Default confidence
    
    const coverage = affectedPatterns.length / usagePatterns.length;
    return Math.min(0.9, 0.3 + (coverage * 0.6)); // Range: 0.3-0.9
  }

  /**
   * Generate specific recommendations based on usage analysis
   */
  private generateRecommendations(
    packageName: string,
    affectedPatterns: string[],
    riskLevel: string
  ): string[] {
    const recommendations: string[] = [];
    
    if (affectedPatterns.length === 0) {
      recommendations.push(`No specific usage patterns detected that would be affected by ${packageName} changes`);
      recommendations.push('Standard testing should be sufficient');
      return recommendations;
    }
    
    // Package-specific recommendations
    if (packageName === 'p-limit') {
      if (affectedPatterns.some(p => p.includes('activeCount'))) {
        recommendations.push('⚠️ Your code uses activeCount - verify behavior change in v7.0.0');
        recommendations.push('Test concurrent operations to ensure activeCount increments correctly');
      }
      
      if (affectedPatterns.some(p => p.includes('pendingCount'))) {
        recommendations.push('Review pendingCount usage for accuracy with new activeCount behavior');
      }
    }
    
    // Risk-based recommendations
    if (riskLevel === 'high') {
      recommendations.push('🔴 High-risk usage detected - thorough testing required');
      recommendations.push('Consider creating specific test cases for affected functionality');
    } else if (riskLevel === 'medium') {
      recommendations.push('🟡 Medium-risk usage - verify behavior in staging environment');
    }
    
    // General recommendations
    recommendations.push(`Review affected files: ${affectedPatterns.join(', ')}`);
    
    return recommendations;
  }
}

// Export singleton instance
export const usageImpactAnalyzer = new UsageImpactAnalyzer();