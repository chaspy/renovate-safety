import { AnalysisStrategy, StrategyAnalysisResult } from './base.js';
import type { PackageUpdate } from '../../types/index.js';
import { packageExists, getNpmDiff } from '../../lib/npm-registry.js';

export class NpmDiffStrategy extends AnalysisStrategy {
  name = 'NPM Diff Analysis';

  async isApplicable(pkg: PackageUpdate): Promise<boolean> {
    // Check if package exists in npm registry
    return packageExists(pkg.name);
  }

  async tryAnalyze(pkg: PackageUpdate): Promise<StrategyAnalysisResult | null> {
    try {
      // Use centralized npm diff utility
      const diffOutput = await getNpmDiff(
        `${pkg.name}@${pkg.fromVersion}`,
        `${pkg.name}@${pkg.toVersion}`
      );

      if (!diffOutput) {
        return null;
      }

      // Analyze the diff for breaking changes
      const analysis = this.analyzeDiff(diffOutput, pkg);

      return {
        content: analysis.summary,
        breakingChanges: analysis.breakingChanges,
        confidence: 0.8, // High confidence for actual code diff
        source: this.name,
        metadata: {
          filesChanged: analysis.filesChanged,
          additions: analysis.additions,
          deletions: analysis.deletions,
          hasApiChanges: analysis.hasApiChanges
        }
      };
    } catch (error) {
      console.warn(`Failed to get npm diff:`, error);
      return null;
    }
  }

  private analyzeDiff(diffOutput: string, pkg: PackageUpdate): {
    summary: string;
    breakingChanges: string[];
    filesChanged: number;
    additions: number;
    deletions: number;
    hasApiChanges: boolean;
  } {
    const lines = diffOutput.split('\n');
    const breakingChanges: string[] = [];
    const changedFiles = new Set<string>();
    let additions = 0;
    let deletions = 0;
    let hasApiChanges = false;

    // Patterns that indicate breaking changes
    const breakingPatterns = [
      { pattern: /^-\s*export\s+(?:function|class|const|let|var)\s+(\w+)/, type: 'Removed export' },
      { pattern: /^-\s*module\.exports\.(\w+)/, type: 'Removed module export' },
      { pattern: /^-\s*exports\.(\w+)/, type: 'Removed export' },
      { pattern: /^-\s*(\w+):\s*function/, type: 'Removed method' },
      { pattern: /function\s+(\w+)\s*\([^)]*\)\s*{[\s\S]*?}\s*$/, multiline: true, type: 'Changed function signature' }
    ];

    let currentFile = '';
    
    lines.forEach((line, _index) => {
      // Track current file
      if (line.startsWith('diff --git')) {
        const match = /b\/(.+)$/.exec(line);
        if (match) {
          currentFile = match[1];
          changedFiles.add(currentFile);
        }
      }

      // Count additions/deletions
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }

      // Check for breaking changes
      for (const { pattern, type } of breakingPatterns) {
        if (pattern.test(line)) {
          const match = pattern.exec(line);
          if (match) {
            breakingChanges.push(`${type}: ${match[1]} in ${currentFile}`);
            hasApiChanges = true;
          }
        }
      }

      // Check for API-related files
      if (currentFile && this.isApiFile(currentFile)) {
        hasApiChanges = true;
      }
    });

    // Look for specific patterns in the entire diff
    if (diffOutput.includes('BREAKING') || diffOutput.includes('DEPRECATED')) {
      hasApiChanges = true;
    }

    // Generate summary
    let summary = `# NPM Diff Analysis: ${pkg.name} ${pkg.fromVersion} → ${pkg.toVersion}\n\n`;
    summary += `## Statistics\n`;
    summary += `- Files changed: ${changedFiles.size}\n`;
    summary += `- Lines added: ${additions}\n`;
    summary += `- Lines removed: ${deletions}\n`;
    summary += `- API changes detected: ${hasApiChanges ? 'Yes' : 'No'}\n\n`;

    if (breakingChanges.length > 0) {
      summary += `## Detected Breaking Changes\n`;
      breakingChanges.forEach(change => {
        summary += `- ${change}\n`;
      });
      summary += '\n';
    }

    if (changedFiles.size > 0) {
      summary += `## Changed Files\n`;
      const fileList = Array.from(changedFiles).slice(0, 20);
      fileList.forEach(file => {
        summary += `- ${file}\n`;
      });
      if (changedFiles.size > 20) {
        summary += `- ... and ${changedFiles.size - 20} more files\n`;
      }
    }

    return {
      summary,
      breakingChanges,
      filesChanged: changedFiles.size,
      additions,
      deletions,
      hasApiChanges
    };
  }

  private isApiFile(filePath: string): boolean {
    const apiIndicators = [
      'index.js', 'index.ts', 'index.mjs',
      'main.js', 'main.ts',
      '/api/', '/lib/', '/src/',
      'export', 'public'
    ];

    return apiIndicators.some(indicator => filePath.includes(indicator));
  }
}