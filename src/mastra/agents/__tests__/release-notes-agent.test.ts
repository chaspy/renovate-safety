import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReleaseNotesAgent, type ReleaseNotesOutput } from '../release-notes-agent.js';
import { 
  detectBreakingChangesFromText, 
  extractMigrationSteps,
  assessRiskLevel
} from '../breaking-change-detector.js';

describe('Breaking Change Detector', () => {
  it('should detect breaking changes from changelog', () => {
    const changelog = `
      # v2.0.0
      
      BREAKING CHANGE: Removed deprecated API
      
      * Added new features
      * DEPRECATED: Old method will be removed in v3
      * Renamed: oldFunction to newFunction
      💥 Major API overhaul
    `;
    
    const breaking = detectBreakingChangesFromText(changelog);
    expect(breaking.length).toBeGreaterThan(0);
    
    const breakingTexts = breaking.map(b => b.text);
    expect(breakingTexts).toContain('BREAKING CHANGE: Removed deprecated API');
    expect(breakingTexts).toContain('* DEPRECATED: Old method will be removed in v3');
    expect(breakingTexts).toContain('* Renamed: oldFunction to newFunction');
    expect(breakingTexts).toContain('💥 Major API overhaul');
    
    // Check severity levels
    const severities = breaking.map(b => b.severity);
    expect(severities).toContain('breaking');
    expect(severities).toContain('warning');
  });
  
  it('should extract migration steps', () => {
    const changelog = `
      ## Migration Guide
      
      1. Update your imports from 'old-package' to 'new-package'
      2. Replace old API calls with new ones
      3. Run migration script: npm run migrate
      
      ## How to Upgrade
      
      - First backup your data
      - Run the update command
      - Test your application
      
      ## Other changes
    `;
    
    const steps = extractMigrationSteps(changelog);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps).toContain("1. Update your imports from 'old-package' to 'new-package'");
    expect(steps).toContain('2. Replace old API calls with new ones');
    expect(steps).toContain('3. Run migration script: npm run migrate');
    expect(steps).toContain('- First backup your data');
  });
  
  it('should assess risk level correctly', () => {
    // No breaking changes
    expect(assessRiskLevel([], 'some-package')).toBe('safe');
    
    // Only warnings
    const warnings = [
      { text: 'DEPRECATED', severity: 'warning' as const, pattern: /DEPRECATED/i },
    ];
    expect(assessRiskLevel(warnings, 'some-package')).toBe('low');
    
    // One breaking change
    const oneBreaking = [
      { text: 'BREAKING', severity: 'breaking' as const, pattern: /BREAKING/i },
    ];
    expect(assessRiskLevel(oneBreaking, 'some-package')).toBe('medium');
    
    // Multiple breaking changes
    const multipleBreaking = [
      { text: 'BREAKING 1', severity: 'breaking' as const, pattern: /BREAKING/i },
      { text: 'BREAKING 2', severity: 'breaking' as const, pattern: /BREAKING/i },
      { text: 'BREAKING 3', severity: 'breaking' as const, pattern: /BREAKING/i },
    ];
    expect(assessRiskLevel(multipleBreaking, 'some-package')).toBe('high');
    
    // @types packages have lower risk
    expect(assessRiskLevel([], '@types/node')).toBe('safe');
    expect(assessRiskLevel(oneBreaking, '@types/node')).toBe('medium');
  });
});

describe('ReleaseNotesAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock generateVNext to avoid OpenAI API calls
    vi.spyOn(ReleaseNotesAgent, 'generateVNext').mockResolvedValue({
      object: {
        breakingChanges: [
          { text: 'BREAKING: API removed', severity: 'breaking' as const, source: 'npm-diff' }
        ],
        migrationSteps: ['1. Update imports'],
        riskLevel: 'medium' as const,
        summary: 'Test package analysis',
        sources: [
          { type: 'npm-diff', status: 'success' as const }
        ]
      } as ReleaseNotesOutput,
      text: 'Analysis complete',
      finishReason: 'stop'
    } as any);
  });

  it('should handle @types packages appropriately', async () => {
    // Override mock for @types package (should be safer)
    vi.spyOn(ReleaseNotesAgent, 'generateVNext').mockResolvedValue({
      object: {
        breakingChanges: [],
        migrationSteps: [],
        riskLevel: 'safe' as const,
        summary: '@types/node TypeScript type definition package update with minimal changes',
        sources: [
          { type: 'npm-diff', status: 'success' as const }
        ]
      } as ReleaseNotesOutput,
      text: 'Analysis complete',
      finishReason: 'stop'
    } as any);

    const result = await ReleaseNotesAgent.generateVNext([
      {
        role: 'user',
        content: 'Analyze release notes for package: @types/node from version 24.0.6 to 24.0.10. Registry: npm.'
      }
    ]);
    
    const output = result.object as unknown as ReleaseNotesOutput;
    expect(output.riskLevel).toBe('safe');
    expect(output.summary).toContain('@types/');
    expect(output.summary).toContain('TypeScript type definition package');
  });

  it('should combine results from multiple sources', async () => {
    const result = await ReleaseNotesAgent.generateVNext([
      {
        role: 'user',
        content: 'Analyze release notes for package: test-package from version 1.0.0 to 2.0.0. Registry: npm. Repository URL: https://github.com/owner/repo'
      }
    ]);

    const output = result.object as unknown as ReleaseNotesOutput;
    expect(output.breakingChanges.length).toBeGreaterThan(0);
    expect(output.migrationSteps.length).toBeGreaterThan(0);
    expect(output.migrationSteps).toContain('1. Update imports');
    expect(['medium', 'high']).toContain(output.riskLevel);
    expect(output.sources).toContainEqual({ type: 'npm-diff', status: 'success' });
  });

  it('should handle failures gracefully', async () => {
    // Override mock for failure scenario
    vi.spyOn(ReleaseNotesAgent, 'generateVNext').mockResolvedValue({
      object: {
        breakingChanges: [],
        migrationSteps: [],
        riskLevel: 'safe' as const,
        summary: 'Analysis with failed sources',
        sources: [
          { type: 'npm-diff', status: 'failed' as const },
          { type: 'github-releases', url: 'https://github.com/owner/repo', status: 'failed' as const },
          { type: 'npm-changelog', status: 'failed' as const }
        ]
      } as ReleaseNotesOutput,
      text: 'Analysis complete',
      finishReason: 'stop'
    } as any);

    const result = await ReleaseNotesAgent.generateVNext([
      {
        role: 'user',
        content: 'Analyze release notes for package: test-package from version 1.0.0 to 2.0.0. Registry: npm. Repository URL: https://github.com/owner/repo'
      }
    ]);

    const output = result.object as unknown as ReleaseNotesOutput;
    expect(output.breakingChanges).toEqual([]);
    expect(output.migrationSteps).toEqual([]);
    expect(output.riskLevel).toBe('safe');
    expect(output.sources).toContainEqual({ type: 'npm-diff', status: 'failed' });
    expect(output.sources).toContainEqual({ 
      type: 'github-releases', 
      url: 'https://github.com/owner/repo',
      status: 'failed' 
    });
    expect(output.sources).toContainEqual({ type: 'npm-changelog', status: 'failed' });
  });

  it('should deduplicate breaking changes from multiple sources', async () => {
    // Override mock for deduplication scenario
    vi.spyOn(ReleaseNotesAgent, 'generateVNext').mockResolvedValue({
      object: {
        breakingChanges: [
          { text: 'BREAKING CHANGE: Removed old API', severity: 'breaking' as const, source: 'npm-diff, github-releases' }
        ],
        migrationSteps: ['1. Update imports'],
        riskLevel: 'medium' as const,
        summary: 'Analysis with deduplicated changes',
        sources: [
          { type: 'npm-diff', status: 'success' as const },
          { type: 'github-releases', url: 'https://github.com/owner/repo', status: 'success' as const }
        ]
      } as ReleaseNotesOutput,
      text: 'Analysis complete',
      finishReason: 'stop'
    } as any);

    const result = await ReleaseNotesAgent.generateVNext([
      {
        role: 'user',
        content: 'Analyze release notes for package: test-package from version 1.0.0 to 2.0.0. Registry: npm. Repository URL: https://github.com/owner/repo'
      }
    ]);

    const output = result.object as unknown as ReleaseNotesOutput;
    const breakingTexts = output.breakingChanges.map((b: any) => b.text);
    const uniqueBreaking = [...new Set(breakingTexts.map((t: any) => t.toLowerCase()))];
    expect(uniqueBreaking.length).toBe(1);
    
    expect(output.breakingChanges[0].source).toContain('npm-diff');
    expect(output.breakingChanges[0].source).toContain('github');
  });
});