/**
 * Enhanced Breaking Change Analyzer
 * Provides more accurate detection with categorization and deduplication
 */

// Note: Using local AnalyzedAnalyzedBreakingChange type for internal analysis
import { extractExportedNamesFromLine as extractExportedNamesBase, extractFunctionSignature, normalizeSignature } from '../../lib/code-analysis-utils.js';
import {
  ExportTracking,
  processChangeContent,
  detectApiRemovals,
  detectSignatureChanges,
  shouldSkipFile,
} from './breaking-change-analyzer-helpers.js';

export type AnalyzedAnalyzedBreakingChange = {
  text: string;
  severity: 'critical' | 'breaking' | 'warning';
  source: string;
  category: 'runtime-requirement' | 'api-change' | 'removal' | 'deprecation' | 'documented-change';
  confidence: number; // 0.0 to 1.0
};

export class AnalyzedBreakingChangeAnalyzer {
  private readonly detectedChanges = new Set<string>();
  private breakingChanges: AnalyzedBreakingChange[] = [];
  private publicEntryHints: string[] = [];

  /**
   * Analyze diff and return categorized breaking changes
   */
  analyze(
    diff: any[],
    packageName: string,
    fromVersion: string,
    toVersion: string,
    context?: { publicEntryHints?: string[] }
  ): AnalyzedBreakingChange[] {
    this.reset();
    if (context?.publicEntryHints && context.publicEntryHints.length > 0) {
      this.publicEntryHints = this.normalizeHints(context.publicEntryHints);
    }
    
    // Priority order: package.json > code changes > documentation
    this.analyzePackageJson(diff, packageName, fromVersion, toVersion);
    this.analyzeCodeChanges(diff);
    this.analyzeDocumentationChanges(diff);
    
    return this.deduplicateAndFilter();
  }

  private reset() {
    this.detectedChanges.clear();
    this.breakingChanges = [];
  }

  /**
   * Analyze package.json changes (highest priority)
   */
  private analyzePackageJson(diff: any[], packageName: string, fromVersion: string, toVersion: string) {
    for (const change of diff) {
      if (change.file === 'package.json' && change.content) {
        this.detectNodeRequirementChange(change.content);
        this.detectEngineChanges(change.content);
        this.detectPeerDependencyChanges(change.content);
        this.extractPublicEntryHints(change.content);
      }
    }
    
    // Add version change analysis
    this.analyzeVersionJump(packageName, fromVersion, toVersion);
  }

  /**
   * Detect Node.js requirement changes
   */
  private detectNodeRequirementChange(content: string) {
    // Limit character matching to prevent ReDoS
    const nodeChangePattern = /[+-][^"\n]{0,100}"node":\s{0,5}"([^"]{1,50})"/g;
    const matches: { type: string; version: string }[] = [];
    
    let match;
    while ((match = nodeChangePattern.exec(content)) !== null) {
      const line = match[0];
      const version = match[1];
      const type = line.startsWith('-') ? 'old' : 'new';
      matches.push({ type, version });
    }
    
    if (matches.length >= 2) {
      const oldVersion = matches.find(m => m.type === 'old')?.version;
      const newVersion = matches.find(m => m.type === 'new')?.version;
      
      if (oldVersion && newVersion && oldVersion !== newVersion) {
        const changeKey = 'node-requirement';
        if (!this.detectedChanges.has(changeKey)) {
          this.breakingChanges.push({
            text: `Node.js requirement raised from ${oldVersion} to ${newVersion}`,
            severity: 'critical',
            source: 'npm-diff',
            category: 'runtime-requirement',
            confidence: 0.95
          });
          this.detectedChanges.add(changeKey);
        }
      }
    }
  }

  /**
   * Analyze version jump significance
   */
  private analyzeVersionJump(_packageName: string, fromVersion: string, toVersion: string) {
    const fromParts = fromVersion.replace(/[^\d.]/g, '').split('.').map(Number);
    const toParts = toVersion.replace(/[^\d.]/g, '').split('.').map(Number);
    
    const majorChange = (toParts[0] || 0) - (fromParts[0] || 0);
    
    if (majorChange > 0) {
      // Only add major version change if no specific breaking changes detected
      const hasSpecificChanges = this.breakingChanges.some(c => 
        c.category === 'runtime-requirement' || c.category === 'api-change'
      );
      
      if (!hasSpecificChanges) {
        this.breakingChanges.push({
          text: `Major version update (${fromVersion} → ${toVersion}) - potential breaking changes`,
          severity: 'breaking',
          source: 'version-analysis',
          category: 'documented-change',
          confidence: 0.7
        });
      }
    }
  }

  /**
   * Analyze code changes (API changes, exports, etc.)
   */
  private analyzeCodeChanges(diff: any[]) {
    const tracking: ExportTracking = {
      removedExportNames: new Set<string>(),
      addedExportNames: new Set<string>(),
      removedSignatures: new Map<string, Set<string>>(),
      addedSignatures: new Map<string, Set<string>>(),
    };

    for (const change of diff) {
      const file = String(change.file || '');

      if (shouldSkipFile(file,
        (f) => this.isIgnoredFile(f),
        this.publicEntryHints,
        (f) => this.isPublicPath(f)
      )) {
        continue;
      }

      processChangeContent(
        change,
        tracking,
        (line, f) => this.extractExportedNamesFromLine(line, f),
        extractFunctionSignature,
        normalizeSignature
      );

      // Other export structure changes
      this.detectExportChanges(change);
      this.detectFunctionChanges(change);
    }

    // Detect API removals
    detectApiRemovals(
      tracking.removedExportNames,
      tracking.addedExportNames,
      this.breakingChanges,
      this.detectedChanges
    );

    // Detect signature changes
    detectSignatureChanges(
      tracking.removedSignatures,
      tracking.addedSignatures,
      this.breakingChanges,
      this.detectedChanges
    );
  }


  /**
   * Analyze documentation for explicit breaking change mentions
   */
  private analyzeDocumentationChanges(diff: any[]) {
    for (const change of diff) {
      if (this.isDocumentationFile(change.file) && change.content) {
        this.detectDocumentedAnalyzedBreakingChanges(change);
      }
    }
  }

  /**
   * Detect documented breaking changes
   */
  private detectDocumentedAnalyzedBreakingChanges(change: any) {
    const content = change.content;
    
    const patterns = [
      {
        // Limit line length to prevent ReDoS with external input
        pattern: /BREAKING CHANGE[:\s]([^\n]{1,500})(?:\n|$)/gi, 
        severity: 'breaking' as const,
        category: 'documented-change' as const,
        confidence: 0.9
      },
      {
        // Limit line length to prevent ReDoS with external input
        pattern: /\[BREAKING\][:\s]([^\n]{1,500})(?:\n|$)/gi, 
        severity: 'breaking' as const,
        category: 'documented-change' as const,
        confidence: 0.9
      },
      {
        // Limit line length to prevent ReDoS with external input
        pattern: /💥[:\s]([^\n]{1,500})(?:\n|$)/gi, 
        severity: 'breaking' as const,
        category: 'documented-change' as const,
        confidence: 0.85
      },
      {
        // Limit characters to prevent ReDoS with external input
        pattern: /activeCount[^\n]{0,100}(?:increment|behavior|change)/gi,
        severity: 'breaking' as const,
        category: 'api-change' as const,
        confidence: 0.8
      }
    ];
    
    for (const { pattern, severity, category, confidence } of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const text = match[1]?.trim() || match[0].trim();
        const changeKey = `doc-${text.substring(0, 20)}`;
        
        if (!this.detectedChanges.has(changeKey)) {
          this.breakingChanges.push({
            text,
            severity,
            source: 'documentation',
            category,
            confidence
          });
          this.detectedChanges.add(changeKey);
        }
      }
    }
  }

  /**
   * Remove duplicates and filter non-breaking changes
   */
  private deduplicateAndFilter(): AnalyzedBreakingChange[] {
    return this.breakingChanges
      .filter(change => {
        // Filter out non-breaking additions
        // Limit character matching to prevent ReDoS
        if (/(?:added|new)[^\n]{1,100}(?:method|function|feature)/i.test(change.text) &&
            !/removed|changed|renamed|replace/i.test(change.text)) {
          return false;
        }
        
        // Filter out generic version bump if we have specific changes
        if (change.text.includes('potential breaking changes') && 
            this.breakingChanges.some(c => c.category === 'runtime-requirement' || c.category === 'api-change')) {
          return false;
        }
        
        return true;
      })
      .sort((a, b) => {
        // Sort by severity, then confidence
        const severityOrder = { 'critical': 0, 'breaking': 1, 'warning': 2 };
        const severityDiff = (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
        if (severityDiff !== 0) return severityDiff;
        
        return b.confidence - a.confidence; // Higher confidence first
      });
  }

  /**
   * Check if file is documentation
   */
  private isDocumentationFile(filename: string): boolean {
    return /\.(md|rst|txt)$|readme|changelog|license|authors/i.test(filename);
  }

  /**
   * Extended ignore rules for non-public or noisy files
   */
  private isIgnoredFile(filename: string): boolean {
    if (!filename) return true;
    const f = filename.toLowerCase();
    if (this.isDocumentationFile(f)) return true;
    // If we have explicit public entry hints, only consider files that match them
    if (this.publicEntryHints.length > 0 && !this.isPublicPath(f)) {
      // Do not treat as ignored if it's clearly exporting symbols
      // PublicEntryHints filter is strong; other noisy filters still apply below
    }
    const ignorePatterns = [
      /(^|\/)__tests__(\/|$)/i,
      /(^|\/)tests?(\/|$)/i,
      /(^|\/)test\b/i,
      /\.test\./i,
      /\.spec\./i,
      /(^|\/)examples?(\/|$)/i,
      /(^|\/)bench(marks)?(\/|$)/i,
      /(^|\/)fixtures?(\/|$)/i,
      /(^|\/)coverage(\/|$)/i,
      /(^|\/)dist(\/|$)/i,
      /(^|\/)build(\/|$)/i,
      /\.map$/i,
    ];
    return ignorePatterns.some((p) => p.test(f));
  }

  /**
   * Extract public entry hints from package.json diff (exports/main/module/types)
   */
  private extractPublicEntryHints(content: string) {
    const hints = new Set<string>();
    const lines = content.split('\n').map((l: string) => l.substring(1));
    const keyPatterns = [
      /"main"\s*:\s*"([^"]+)"/,
      /"module"\s*:\s*"([^"]+)"/,
      /"types"\s*:\s*"([^"]+)"/,
    ];

    for (const line of lines) {
      for (const p of keyPatterns) {
        const m = p.exec(line);
        if (m) hints.add(m[1]);
      }

      // crude exports field extraction: "exports": { "/feature": { "import": "./src/feature.js" } }
      const match = /"(?:import|require|default)"\s*:\s*"([^"]+)"/.exec(line);
      if (match) hints.add(match[1]);
    }
    if (hints.size > 0) this.publicEntryHints = this.normalizeHints(Array.from(hints));
  }

  private isPublicPath(file: string): boolean {
    if (!file) return false;
    if (this.publicEntryHints.length === 0) return false;
    const f = file.replace(/^\.\//, '');
    return this.publicEntryHints.some((h) => {
      const hh = h.replace(/^\.\//, '');
      return f.endsWith(hh) || f.includes(hh.replace(/^\//, ''));
    });
  }

  private normalizeHints(hints: string[]): string[] {
    return hints
      .map((h) => h.replace(/^\./, '').replace(/^\//, '')) // remove leading ./ or /
      .filter(Boolean);
  }

  /**
   * Extract exported names from a diff line (best-effort)
   */
  private extractExportedNamesFromLine(line: string, file: string): string[] {
    const content = line.substring(1);

    // Only consider likely public modules (heuristic): index files, src/, lib/, explicit export/module.exports
    const pathOk = /(\/(src|lib)\/|^index\.|\/(index|main)\.)/i.test(file) || /export\s+/.test(content) || /module\.exports/.test(content);
    if (!pathOk) return [];

    // Use the shared utility function
    return extractExportedNamesBase(line);
  }

  // These methods are now imported from code-analysis-utils.ts
  // extractFunctionSignature and normalizeSignature are used directly from the import

  // Additional helper methods for specific change detection
  private detectExportChanges(_change: any) {
    // Implementation handled in analyzeCodeChanges
  }

  private detectFunctionChanges(_change: any) {
    // Implementation handled in analyzeCodeChanges
  }

  private detectEngineChanges(_content: string) {
    // Implementation handled in detectNodeRequirementChange
  }

  private detectPeerDependencyChanges(_content: string) {
    // Peer dependency changes are less critical but tracked
  }
}

// Export singleton instance
export const breakingChangeAnalyzer = new AnalyzedBreakingChangeAnalyzer();
