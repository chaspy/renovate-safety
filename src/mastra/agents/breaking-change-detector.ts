export const BREAKING_CHANGE_PATTERNS = [
  /BREAKING CHANGE:/i,
  /BREAKING:/i,
  /\[BREAKING\]/i,
  /💥/,
  /\* Removed/i,
  /\* Deleted/i,
  /DEPRECATED:/i,
  /\[DEPRECATED\]/i,
  /MIGRATION REQUIRED/i,
  /INCOMPATIBLE/i,
  /NOT BACKWARD COMPATIBLE/i,
  /API CHANGE/i,
  /REQUIRES MIGRATION/i,
  /\* Renamed/i,
  /\* Moved/i,
  /\[RENAMED\]/i,
  /\[MOVED\]/i,
];

export interface BreakingChangeInfo {
  text: string;
  pattern: RegExp;
  lineNumber?: number;
  severity: 'breaking' | 'warning' | 'removal';
}

export function detectBreakingChangesFromText(text: string): BreakingChangeInfo[] {
  const lines = text.split('\n');
  const breakingChanges: BreakingChangeInfo[] = [];
  const seenChanges = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    for (const pattern of BREAKING_CHANGE_PATTERNS) {
      if (pattern.test(line)) {
        const changeKey = line.toLowerCase().replace(/\s+/g, ' ');
        if (!seenChanges.has(changeKey)) {
          seenChanges.add(changeKey);
          
          let severity: 'breaking' | 'warning' | 'removal' = 'breaking';
          if (/DEPRECATED/i.test(line) || /Renamed/i.test(line) || /Moved/i.test(line)) {
            severity = 'warning';
          } else if (/Removed/i.test(line) || /Deleted/i.test(line)) {
            severity = 'removal';
          }

          breakingChanges.push({
            text: line,
            pattern,
            lineNumber: i + 1,
            severity,
          });
        }
        break;
      }
    }

    // Check for breaking change sections
    if (isBreakingChangeSection(line)) {
      const sectionItems = extractSectionItems(lines, i);
      for (const item of sectionItems) {
        const itemKey = item.toLowerCase().replace(/\s+/g, ' ');
        if (!seenChanges.has(itemKey)) {
          seenChanges.add(itemKey);
          breakingChanges.push({
            text: item,
            pattern: /Breaking Changes?/i,
            severity: 'breaking',
          });
        }
      }
    }
  }

  return breakingChanges;
}

function isBreakingChangeSection(line: string): boolean {
  const sectionPatterns = [
    /^#+\s*Breaking\s*Changes?/i,
    /^Breaking\s*Changes?:/i,
    /^#+\s*\[Breaking\s*Changes?\]/i,
    /^#+\s*💥\s*Breaking/i,
    /^#+\s*Incompatible\s*Changes?/i,
    /^#+\s*API\s*Breaking\s*Changes?/i,
  ];

  return sectionPatterns.some((pattern) => pattern.test(line));
}

function extractSectionItems(lines: string[], sectionIndex: number): string[] {
  const items: string[] = [];
  let i = sectionIndex + 1;

  // Skip empty lines
  while (i < lines.length && !lines[i].trim()) {
    i++;
  }

  // Extract list items until we hit another section or end
  while (i < lines.length) {
    const line = lines[i].trim();

    // Stop if we hit another section header
    if (/^#+\s/.test(line)) {
      break;
    }

    // Extract list items
    if (/^[-*•]\s/.test(line)) {
      items.push(line);
    }

    i++;
  }

  return items;
}

export function extractMigrationSteps(text: string): string[] {
  const migrationSections = [
    /migration guide/i,
    /migration steps/i,
    /how to migrate/i,
    /upgrading from/i,
    /upgrade guide/i,
    /how to upgrade/i,
  ];

  const steps: string[] = [];
  const lines = text.split('\n');
  let inMigrationSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (migrationSections.some(p => p.test(line))) {
      inMigrationSection = true;
      continue;
    }

    if (inMigrationSection && line.trim()) {
      // Capture numbered lists, bullet points, or code blocks
      if (/^[\d\-*•]/.test(line.trim()) || /^\s{2,}/.test(line)) {
        steps.push(line.trim());
      }
      
      // Also capture code blocks
      if (line.trim().startsWith('```')) {
        const codeBlock: string[] = [line];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeBlock.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          codeBlock.push(lines[i]);
        }
        steps.push(codeBlock.join('\n'));
      }
    }

    // Section ends when we hit another header
    if (inMigrationSection && /^#/.test(line)) {
      break;
    }
  }

  return steps;
}

export function assessRiskLevel(breakingChanges: BreakingChangeInfo[], packageName: string): 'safe' | 'low' | 'medium' | 'high' {
  // Special handling for @types packages
  if (packageName.startsWith('@types/')) {
    // Type definition packages in patch versions are usually safe
    if (breakingChanges.length === 0) {
      return 'safe';
    }
    // Even with changes, @types packages are lower risk
    return breakingChanges.some(c => c.severity === 'breaking') ? 'medium' : 'low';
  }

  // No breaking changes detected
  if (breakingChanges.length === 0) {
    return 'safe';
  }

  // Count by severity
  const breakingCount = breakingChanges.filter(c => c.severity === 'breaking').length;
  const removalCount = breakingChanges.filter(c => c.severity === 'removal').length;
  const warningCount = breakingChanges.filter(c => c.severity === 'warning').length;

  // High risk: multiple breaking changes or removals
  if (breakingCount >= 3 || removalCount >= 2) {
    return 'high';
  }

  // Medium risk: any breaking changes or removals
  if (breakingCount > 0 || removalCount > 0) {
    return 'medium';
  }

  // Low risk: only warnings/deprecations
  if (warningCount > 0) {
    return 'low';
  }

  return 'safe';
}