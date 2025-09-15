import type { CodeDiff } from './github-diff.js';
import {
  extractExportedNamesFromLine,
  extractFunctionSignature,
  normalizeSignature,
} from './code-analysis-utils.js';

export interface ApiDiffSummary {
  bullets: string[];
  enginesDiff?: { from: string; to: string };
}

export async function summarizeApiDiff(
  codeDiff: CodeDiff,
  language: 'en' | 'ja' = 'en'
): Promise<ApiDiffSummary> {
  const lines = codeDiff.content.split('\n');

  const addedExports = new Set<string>();
  const removedExports = new Set<string>();

  const removedSignatures: Map<string, Set<string>> = new Map();
  const addedSignatures: Map<string, Set<string>> = new Map();

  let inDiff = false;
  let currentFile = '';
  let nodeOld: string | null = null;
  let nodeNew: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('### ')) {
      currentFile = line.replace(/^###\s+/, '').trim();
      continue;
    }
    if (line.startsWith('```diff')) {
      inDiff = true;
      continue;
    }
    if (line.startsWith('```') && inDiff) {
      inDiff = false;
      continue;
    }
    if (!inDiff) continue;

    // Only process diff additions/removals
    if (!(line.startsWith('+') || line.startsWith('-'))) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;

    // engines.node detection (package.json)
    if (currentFile.endsWith('package.json')) {
      const m = /[+-]\s*"node"\s*:\s*"([^"]+)"/.exec(line);
      if (m) {
        const val = m[1];
        if (line.startsWith('-')) nodeOld = val;
        else nodeNew = val;
      }
    }

    // Exported names
    const names = extractExportedNamesFromLine(line);
    for (const n of names) {
      if (line.startsWith('+')) addedExports.add(n);
      if (line.startsWith('-')) removedExports.add(n);
    }

    // Function signatures
    const sig = extractFunctionSignature(line);
    if (sig) {
      const norm = normalizeSignature(sig.params);
      const map = line.startsWith('-') ? removedSignatures : addedSignatures;
      if (!map.has(sig.name)) map.set(sig.name, new Set());
      map.get(sig.name)!.add(norm);
    }
  }

  const bullets: string[] = [];

  // Node engines bullet
  let enginesDiff: { from: string; to: string } | undefined;
  if (nodeOld && nodeNew && nodeOld !== nodeNew) {
    enginesDiff = { from: nodeOld, to: nodeNew };
    bullets.push(
      language === 'ja'
        ? `実行環境要件: Node.js ${nodeOld} → ${nodeNew}`
        : `Runtime requirement: Node.js ${nodeOld} → ${nodeNew}`
    );
  }

  // API removals (true removals)
  const trueRemoved = Array.from(removedExports).filter(
    (n) => !addedExports.has(n) && n !== 'default'
  );
  if (trueRemoved.length > 0) {
    const list = summarizeList(trueRemoved, language);
    bullets.push(language === 'ja' ? `公開APIの削除: ${list}` : `Public API removals: ${list}`);
  }

  // API additions (true additions)
  const trueAdded = Array.from(addedExports).filter((n) => !removedExports.has(n));
  if (trueAdded.length > 0) {
    const list = summarizeList(trueAdded, language);
    bullets.push(language === 'ja' ? `公開APIの追加: ${list}` : `Public API additions: ${list}`);
  }

  // Signature changes
  const sigChanges: string[] = [];
  for (const [name, rem] of removedSignatures.entries()) {
    const add = addedSignatures.get(name);
    if (!add || add.size === 0) continue;
    const changed = Array.from(rem).some((s) => !add.has(s));
    if (changed) sigChanges.push(name);
  }
  if (sigChanges.length > 0) {
    const list = summarizeList(sigChanges, language);
    bullets.push(
      language === 'ja' ? `関数シグネチャの変更: ${list}` : `Function signature changes: ${list}`
    );
  }

  return { bullets, enginesDiff };
}

// These functions are now imported from code-analysis-utils.ts

function summarizeList(items: string[], language: 'en' | 'ja'): string {
  const max = 4;
  if (items.length <= max) return items.join(', ');
  const head = items.slice(0, max).join(', ');
  const more = items.length - max;
  return language === 'ja' ? `${head}、他 ${more} 件` : `${head}, and ${more} more`;
}
