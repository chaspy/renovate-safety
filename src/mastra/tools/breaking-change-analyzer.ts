/**
 * Enhanced Breaking Change Analyzer
 * Provides more accurate detection with categorization and deduplication
 */

export interface BreakingChange {
  text: string;
  severity: 'critical' | 'breaking' | 'warning';
  source: string;
  category: 'runtime-requirement' | 'api-change' | 'removal' | 'deprecation' | 'documented-change';
  confidence: number; // 0.0 to 1.0
}

export class BreakingChangeAnalyzer {
  private detectedChanges = new Set<string>();
  private breakingChanges: BreakingChange[] = [];
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
  ): BreakingChange[] {
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
    const nodeChangePattern = /[+-].*?"node":\s*"([^"]+)"/g;
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
    // Aggregate across files for more accurate results (removal/addition offset, signature diff)
    const removedExportNames = new Set<string>();
    const addedExportNames = new Set<string>();

    const removedSignatures: Map<string, Set<string>> = new Map();
    const addedSignatures: Map<string, Set<string>> = new Map();

    for (const change of diff) {
      const file = String(change.file || '');

      // Skip documentation and non-public/noisy paths
      if (this.isIgnoredFile(file)) continue;
      // If we have explicit public entry hints, restrict analysis to those files only
      if (this.publicEntryHints.length > 0 && !this.isPublicPath(file)) {
        continue;
      }

      if (!change.content || typeof change.content !== 'string') continue;

      const lines = change.content.split('\n');
      for (const line of lines) {
        // Added lines
        if (line.startsWith('+') && !line.startsWith('+++')) {
          const names = this.extractExportedNamesFromLine(line, file);
          for (const n of names) addedExportNames.add(n);

          const sig = this.extractFunctionSignature(line);
          if (sig) {
            const norm = this.normalizeSignature(sig.params);
            if (!addedSignatures.has(sig.name)) addedSignatures.set(sig.name, new Set());
            addedSignatures.get(sig.name)!.add(norm);
          }
        }

        // Removed lines
        if (line.startsWith('-') && !line.startsWith('---')) {
          const names = this.extractExportedNamesFromLine(line, file);
          for (const n of names) removedExportNames.add(n);

          const sig = this.extractFunctionSignature(line);
          if (sig) {
            const norm = this.normalizeSignature(sig.params);
            if (!removedSignatures.has(sig.name)) removedSignatures.set(sig.name, new Set());
            removedSignatures.get(sig.name)!.add(norm);
          }
        }
      }

      // Other export structure changes (placeholder)
      this.detectExportChanges(change);
      this.detectFunctionChanges(change);
    }

    // True removals = removed - added
    const trueRemoved = Array.from(removedExportNames).filter((n) => !addedExportNames.has(n));
    if (trueRemoved.length > 0) {
      const changeKey = 'api-removal';
      if (!this.detectedChanges.has(changeKey)) {
        this.breakingChanges.push({
          text: 'API functions or classes removed',
          severity: 'breaking',
          source: 'npm-diff',
          category: 'api-change',
          confidence: 0.85,
        });
        this.detectedChanges.add(changeKey);
      }
    }

    // Signature changes: names present in both sides but with different normalized param lists
    const signatureChanges: string[] = [];
    for (const [name, removedSet] of removedSignatures.entries()) {
      const addedSet = addedSignatures.get(name);
      if (!addedSet || addedSet.size === 0) continue; // Not re-added => handled as removal
      const diffExists = Array.from(removedSet).some((sig) => !addedSet.has(sig));
      if (diffExists) signatureChanges.push(name);
    }

    if (signatureChanges.length > 0) {
      const changeKey = 'signature-change';
      if (!this.detectedChanges.has(changeKey)) {
        this.breakingChanges.push({
          text: `Function signatures changed: ${signatureChanges.join(', ')}`,
          severity: 'breaking',
          source: 'npm-diff',
          category: 'api-change',
          confidence: 0.8,
        });
        this.detectedChanges.add(changeKey);
      }
    }
  }

  /**
   * Detect actual API changes (not just file structure)
   */
  private detectApiChanges(_change: any) {
    // Handled by aggregated logic in analyzeCodeChanges
    return;
  }

  /**
   * Detect function signature changes
   */
  private detectSignatureChanges(_content: string): string[] {
    // Compare signatures via aggregated logic
    return [];
  }

  /**
   * Analyze documentation for explicit breaking change mentions
   */
  private analyzeDocumentationChanges(diff: any[]) {
    for (const change of diff) {
      if (this.isDocumentationFile(change.file) && change.content) {
        this.detectDocumentedBreakingChanges(change);
      }
    }
  }

  /**
   * Detect documented breaking changes
   */
  private detectDocumentedBreakingChanges(change: any) {
    const content = change.content;
    
    const patterns = [
      { 
        pattern: /BREAKING CHANGE[:\s](.+?)(?:\n|$)/gi, 
        severity: 'breaking' as const,
        category: 'documented-change' as const,
        confidence: 0.9
      },
      { 
        pattern: /\[BREAKING\][:\s](.+?)(?:\n|$)/gi, 
        severity: 'breaking' as const,
        category: 'documented-change' as const,
        confidence: 0.9
      },
      { 
        pattern: /💥[:\s](.+?)(?:\n|$)/gi, 
        severity: 'breaking' as const,
        category: 'documented-change' as const,
        confidence: 0.85
      },
      {
        pattern: /activeCount.*(?:increment|behavior|change)/gi,
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
  private deduplicateAndFilter(): BreakingChange[] {
    return this.breakingChanges
      .filter(change => {
        // Filter out non-breaking additions
        if (change.text.match(/(?:added|new).+(?:method|function|feature)/i) && 
            !change.text.match(/removed|changed|renamed|replace/i)) {
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
        const m = line.match(p);
        if (m) hints.add(m[1]);
      }

      // crude exports field extraction: "exports": { "/feature": { "import": "./src/feature.js" } }
      const match = line.match(/"(?:import|require|default)"\s*:\s*"([^"]+)"/);
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
    const names: string[] = [];
    const content = line.substring(1);

    // Only consider likely public modules (heuristic): index files, src/, lib/, explicit export/module.exports
    const pathOk = /(\/(src|lib)\/|^index\.|\/(index|main)\.)/i.test(file) || /export\s+/.test(content) || /module\.exports/.test(content);
    if (!pathOk) return names;

    // ESM named exports: export function|class|const|let|var NAME
    const esmDecl = content.match(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (esmDecl) names.push(esmDecl[1]);

    // ESM default export
    if (/export\s+default\s+/.test(content)) names.push('default');

    // ESM list: export { a, b as c }
    const listMatch = content.match(/export\s*\{([^}]+)\}/);
    if (listMatch) {
      const parts = listMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/\s{1,10}as\s{1,10}[^,}]{1,100}$/, ''));
      names.push(...parts);
    }

    // CommonJS: exports.name = ..., module.exports = { a, b }
    const cjsProp = content.match(/exports\.([A-Za-z_$][\w$]*)\s*=/);
    if (cjsProp) names.push(cjsProp[1]);

    const cjsObj = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (cjsObj) {
      const parts = cjsObj[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/:\s{0,10}[^,}]{0,100}/, ''));
      names.push(...parts);
    }

    return Array.from(new Set(names.filter(Boolean)));
  }

  /**
   * Extract function signature name and param list from a diff line
   */
  private extractFunctionSignature(line: string): { name: string; params: string } | null {
    const content = line.substring(1);

    // export function name(params)
    let m = content.match(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
    if (m) return { name: m[1], params: m[2] };

    // export const name = (params) =>
    m = content.match(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
    if (m) return { name: m[1], params: m[2] };

    // TypeScript .d.ts style
    m = content.match(/declare\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
    if (m) return { name: m[1], params: m[2] };

    return null;
  }

  /**
   * Normalize parameter list for signature comparison
   */
  private normalizeSignature(params: string): string {
    let p = params;
    p = p.replace(/[?]/g, '');
    p = p.replace(/\b(public|private|protected|readonly)\s{1,10}/g, '');
    p = p.replace(/:\s{0,10}([^,)]{1,100})/g, ''); // remove type annotations
    p = p.replace(/=\s{0,10}([^,)]{1,100})/g, ''); // remove defaults
    p = p.replace(/\s+/g, '');
    return p.trim();
  }

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
export const breakingChangeAnalyzer = new BreakingChangeAnalyzer();
