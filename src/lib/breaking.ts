import type { BreakingChange } from '../types/index.js';

const BREAKING_PATTERNS = [
  // Explicit breaking change markers
  { pattern: /BREAKING\s*CHANGE/i, severity: 'breaking' as const },
  { pattern: /BREAKING:/i, severity: 'breaking' as const },
  { pattern: /\[BREAKING\]/i, severity: 'breaking' as const },
  { pattern: /💥/, severity: 'breaking' as const }, // Explosion emoji often used for breaking changes

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

export function extractBreakingChanges(changelogContent: string): BreakingChange[] {
  const lines = changelogContent.split('\n');
  const breakingChanges: BreakingChange[] = [];
  const seenLines = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    for (const { pattern, severity } of BREAKING_PATTERNS) {
      if (pattern.test(line)) {
        // Get the full context (current line + next few lines if it's a list item)
        const context = extractContext(lines, i);
        const contextKey = context.toLowerCase().replace(/\s+/g, ' ');

        // Avoid duplicates
        if (!seenLines.has(contextKey)) {
          seenLines.add(contextKey);
          breakingChanges.push({
            line: context,
            severity,
          });
        }
        break; // Don't check other patterns for this line
      }
    }

    // Also check for common breaking change sections
    if (isBreakingChangeSection(line)) {
      // Extract all items in this section
      const sectionItems = extractSectionItems(lines, i);
      for (const item of sectionItems) {
        const itemKey = item.toLowerCase().replace(/\s+/g, ' ');
        if (!seenLines.has(itemKey)) {
          seenLines.add(itemKey);
          breakingChanges.push({
            line: item,
            severity: 'breaking',
          });
        }
      }
    }
  }

  return breakingChanges;
}

function extractContext(lines: string[], index: number): string {
  const line = lines[index].trim();

  // If it's a list item, get the full item (could span multiple lines)
  if (line.match(/^[-*•]\s/)) {
    let context = line;
    let i = index + 1;

    // Continue reading lines that are indented (continuation of the list item)
    while (i < lines.length && lines[i].match(/^\s{2,}/) && !lines[i].match(/^[-*•]\s/)) {
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
    if (line.match(/^#+\s/)) {
      break;
    }

    // Extract list items
    if (line.match(/^[-*•]\s/)) {
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
