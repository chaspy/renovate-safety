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

    // Check for pattern matches
    const patternMatch = checkLineForBreakingPattern(line, i + 1);
    if (patternMatch) {
      addUniqueBreakingChange(breakingChanges, seenChanges, patternMatch);
      continue;
    }

    // Check for breaking change sections
    if (isBreakingChangeSection(line)) {
      const sectionChanges = processSectionItems(lines, i);
      sectionChanges.forEach(change =>
        addUniqueBreakingChange(breakingChanges, seenChanges, change)
      );
    }
  }

  return breakingChanges;
}

function checkLineForBreakingPattern(
  line: string,
  lineNumber: number
): BreakingChangeInfo | null {
  for (const pattern of BREAKING_CHANGE_PATTERNS) {
    if (pattern.test(line)) {
      return {
        text: line,
        pattern,
        lineNumber,
        severity: determineSeverity(line),
      };
    }
  }
  return null;
}

function determineSeverity(line: string): 'breaking' | 'warning' | 'removal' {
  if (/DEPRECATED/i.test(line) || /Renamed/i.test(line) || /Moved/i.test(line)) {
    return 'warning';
  }
  if (/Removed/i.test(line) || /Deleted/i.test(line)) {
    return 'removal';
  }
  return 'breaking';
}

function addUniqueBreakingChange(
  breakingChanges: BreakingChangeInfo[],
  seenChanges: Set<string>,
  change: BreakingChangeInfo
): void {
  const changeKey = change.text.toLowerCase().replace(/\s+/g, ' ');
  if (!seenChanges.has(changeKey)) {
    seenChanges.add(changeKey);
    breakingChanges.push(change);
  }
}

function processSectionItems(lines: string[], sectionIndex: number): BreakingChangeInfo[] {
  const sectionItems = extractSectionItems(lines, sectionIndex);
  return sectionItems.map(item => ({
    text: item,
    pattern: /Breaking Changes?/i,
    severity: 'breaking' as const,
  }));
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
  const lines = text.split('\n');
  const steps: string[] = [];
  const sectionRange = findMigrationSectionRange(lines);

  if (!sectionRange) {
    return steps;
  }

  for (let i = sectionRange.start; i <= sectionRange.end; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!trimmedLine) continue;

    // Process code blocks
    if (trimmedLine.startsWith('```')) {
      const codeBlock = extractCodeBlock(lines, i);
      steps.push(codeBlock.content);
      i = codeBlock.endIndex;
      continue;
    }

    // Process list items and indented content
    if (isMigrationStep(trimmedLine)) {
      steps.push(trimmedLine);
    }
  }

  return steps;
}

function findMigrationSectionRange(
  lines: string[]
): { start: number; end: number } | null {
  const migrationSections = [
    /migration guide/i,
    /migration steps/i,
    /how to migrate/i,
    /upgrading from/i,
    /upgrade guide/i,
    /how to upgrade/i,
  ];

  let sectionStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Find start of migration section
    if (sectionStart === -1 && migrationSections.some(p => p.test(line))) {
      sectionStart = i + 1;
      continue;
    }

    // Find end of migration section (next header)
    if (sectionStart !== -1 && line.startsWith('#')) {
      return { start: sectionStart, end: i - 1 };
    }
  }

  // If we found a start but no end, go to the end of the document
  if (sectionStart !== -1) {
    return { start: sectionStart, end: lines.length - 1 };
  }

  return null;
}

function extractCodeBlock(
  lines: string[],
  startIndex: number
): { content: string; endIndex: number } {
  const codeBlock: string[] = [lines[startIndex]];
  let i = startIndex + 1;

  while (i < lines.length && !lines[i].trim().startsWith('```')) {
    codeBlock.push(lines[i]);
    i++;
  }

  if (i < lines.length) {
    codeBlock.push(lines[i]);
  }

  return {
    content: codeBlock.join('\n'),
    endIndex: i,
  };
}

function isMigrationStep(line: string): boolean {
  // Capture numbered lists, bullet points, or indented content
  return /^[\d\-*•]/.test(line) || /^\s{2,}/.test(line);
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