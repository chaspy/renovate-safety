import type { BreakingChange } from '../types/index.js';

const BREAKING_PATTERNS = [
  // Explicit breaking change markers
  { pattern: /BREAKING\s*CHANGE/i, severity: 'breaking' as const },
  { pattern: /BREAKING:/i, severity: 'breaking' as const },
  { pattern: /\[BREAKING\]/i, severity: 'breaking' as const },
  { pattern: /💥/, severity: 'breaking' as const }, // Explosion emoji often used for breaking changes

  // Node.js version requirements
  { pattern: /Require\s+Node\.?js\s+\d+/i, severity: 'breaking' as const },
  {
    pattern: /Drop(?:ped)?\s+(?:support\s+for\s+)?Node\.?js\s+\d+/i,
    severity: 'breaking' as const,
  },
  { pattern: /Minimum\s+Node\.?js\s+version/i, severity: 'breaking' as const },
  { pattern: /engines?\.node\s*[:=]\s*["']?(?:>=?|\^|~)[\d.]+/i, severity: 'breaking' as const },
  {
    pattern: /Node\.?js\s+>=?\s*\d+\s+(?:is\s+)?(?:now\s+)?required/i,
    severity: 'breaking' as const,
  },

  // Warning indicators
  { pattern: /⚠️/, severity: 'warning' as const },
  { pattern: /\[WARNING\]/i, severity: 'warning' as const },
  { pattern: /\[DEPRECATED\]/i, severity: 'warning' as const },
  { pattern: /DEPRECATED:/i, severity: 'warning' as const },

  // Removal indicators
  { pattern: /\*\s*Removed/i, severity: 'removal' as const },
  { pattern: /\*\s*Deleted/i, severity: 'removal' as const },
  { pattern: /\[REMOVED\]/i, severity: 'removal' as const },
  { pattern: /\[DELETED\]/i, severity: 'removal' as const },

  // API changes
  { pattern: /API\s*CHANGE/i, severity: 'warning' as const },
  { pattern: /INCOMPATIBLE/i, severity: 'breaking' as const },
  { pattern: /NOT\s*BACKWARD\s*COMPATIBLE/i, severity: 'breaking' as const },

  // Migration required
  { pattern: /MIGRATION\s*REQUIRED/i, severity: 'breaking' as const },
  { pattern: /REQUIRES\s*MIGRATION/i, severity: 'breaking' as const },

  // Renamed/moved
  { pattern: /\*\s*Renamed/i, severity: 'warning' as const },
  { pattern: /\*\s*Moved/i, severity: 'warning' as const },
  { pattern: /\[RENAMED\]/i, severity: 'warning' as const },
  { pattern: /\[MOVED\]/i, severity: 'warning' as const },
];

export function extractBreakingChanges(
  changelogContent: string,
  enginesDiff?: { from: string; to: string }
): BreakingChange[] {
  const lines = changelogContent.split('\n');
  const breakingChanges: BreakingChange[] = [];
  const seenLines = new Set<string>();

  // Process engines diff
  processEnginesDiff(enginesDiff, breakingChanges, seenLines);

  // Process each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for pattern matches
    const patternChange = checkLineForPattern(lines, i, seenLines);
    if (patternChange) {
      breakingChanges.push(patternChange);
      continue;
    }

    // Check for breaking change sections
    if (isBreakingChangeSection(line)) {
      const sectionChanges = processSectionForBreaking(lines, i, seenLines);
      breakingChanges.push(...sectionChanges);
    }
  }

  return breakingChanges;
}

function processEnginesDiff(
  enginesDiff: { from: string; to: string } | undefined,
  breakingChanges: BreakingChange[],
  seenLines: Set<string>
): void {
  if (!enginesDiff || enginesDiff.from === enginesDiff.to) {
    return;
  }

  const fromMajor = parseInt(/\d+/.exec(enginesDiff.from)?.[0] || '0');
  const toMajor = parseInt(/\d+/.exec(enginesDiff.to)?.[0] || '0');

  if (toMajor > fromMajor) {
    const engineChange = `Minimum Node.js version changed from ${enginesDiff.from} to ${enginesDiff.to}`;
    const key = normalizeKey(engineChange);

    if (!seenLines.has(key)) {
      seenLines.add(key);
      breakingChanges.push({
        line: engineChange,
        severity: 'breaking',
      });
    }
  }
}

function checkLineForPattern(
  lines: string[],
  index: number,
  seenLines: Set<string>
): BreakingChange | null {
  const line = lines[index].trim();

  for (const { pattern, severity } of BREAKING_PATTERNS) {
    if (pattern.test(line)) {
      const context = extractContext(lines, index);
      const contextKey = normalizeKey(context);

      if (!seenLines.has(contextKey)) {
        seenLines.add(contextKey);
        return {
          line: context,
          severity,
        };
      }
      break;
    }
  }

  return null;
}

function processSectionForBreaking(
  lines: string[],
  sectionIndex: number,
  seenLines: Set<string>
): BreakingChange[] {
  const sectionItems = extractSectionItems(lines, sectionIndex);
  const changes: BreakingChange[] = [];

  for (const item of sectionItems) {
    const itemKey = normalizeKey(item);
    if (!seenLines.has(itemKey)) {
      seenLines.add(itemKey);
      changes.push({
        line: item,
        severity: 'breaking',
      });
    }
  }

  return changes;
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function extractContext(lines: string[], index: number): string {
  const line = lines[index].trim();

  // If it's a list item, get the full item (could span multiple lines)
  if (/^[-*•]\s/.test(line)) {
    let context = line;
    let i = index + 1;

    // Continue reading lines that are indented (continuation of the list item)
    while (i < lines.length && /^\s{2,}/.test(lines[i]) && !/^[-*•]\s/.test(lines[i])) {
      context += ' ' + lines[i].trim();
      i++;
    }

    return context;
  }

  // For non-list items, just return the line
  return line;
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
      const context = extractContext(lines, i);
      items.push(context);
    }

    i++;
  }

  return items;
}

export function filterByTokenLimit(
  breakingChanges: BreakingChange[],
  maxTokens: number = 4000
): BreakingChange[] {
  // Rough estimate: 1 token ≈ 4 characters
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  const filtered: BreakingChange[] = [];
  let totalTokens = 0;

  // Prioritize by severity: breaking > removal > warning
  const sorted = [...breakingChanges].sort((a, b) => {
    const severityOrder = { breaking: 0, removal: 1, warning: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  for (const change of sorted) {
    const tokens = estimateTokens(change.line);
    if (totalTokens + tokens <= maxTokens) {
      filtered.push(change);
      totalTokens += tokens;
    }
  }

  return filtered;
}
