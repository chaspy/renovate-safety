import type { CodeDiff } from './github-diff.js';
import {
  extractExportedNamesFromLine,
  extractFunctionSignature,
  normalizeSignature,
} from './code-analysis-utils.js';

export type ApiDiffSummary = {
  bullets: string[];
  enginesDiff?: { from: string; to: string };
};

type DiffParseState = {
  inDiff: boolean;
  currentFile: string;
};

type ExportsAndSignatures = {
  addedExports: Set<string>;
  removedExports: Set<string>;
  removedSignatures: Map<string, Set<string>>;
  addedSignatures: Map<string, Set<string>>;
}

interface EngineVersions {
  nodeOld: string | null;
  nodeNew: string | null;
}

export async function summarizeApiDiff(
  codeDiff: CodeDiff,
  language: 'en' | 'ja' = 'en'
): Promise<ApiDiffSummary> {
  const lines = codeDiff.content.split('\n');
  const state: DiffParseState = { inDiff: false, currentFile: '' };
  const data: ExportsAndSignatures = {
    addedExports: new Set<string>(),
    removedExports: new Set<string>(),
    removedSignatures: new Map(),
    addedSignatures: new Map(),
  };
  const engines: EngineVersions = { nodeOld: null, nodeNew: null };

  parseDiffLines(lines, state, data, engines);
  return generateApiDiffSummary(data, engines, language);
}

function parseDiffLines(
  lines: string[],
  state: DiffParseState,
  data: ExportsAndSignatures,
  engines: EngineVersions
): void {
  for (const line of lines) {
    if (updateDiffState(line, state)) continue;
    if (!state.inDiff) continue;
    if (!isDiffLine(line)) continue;

    processPackageJsonLine(line, state.currentFile, engines);
    processExportLine(line, data);
    processSignatureLine(line, data);
  }
}

function updateDiffState(line: string, state: DiffParseState): boolean {
  if (line.startsWith('### ')) {
    state.currentFile = line.replace(/^###\s+/, '').trim();
    return true;
  }
  if (line.startsWith('```diff')) {
    state.inDiff = true;
    return true;
  }
  if (line.startsWith('```') && state.inDiff) {
    state.inDiff = false;
    return true;
  }
  return false;
}

function isDiffLine(line: string): boolean {
  if (!(line.startsWith('+') || line.startsWith('-'))) return false;
  if (line.startsWith('+++') || line.startsWith('---')) return false;
  return true;
}

function processPackageJsonLine(line: string, currentFile: string, engines: EngineVersions): void {
  if (!currentFile.endsWith('package.json')) return;

  const m = /[+-]\s*"node"\s*:\s*"([^"]+)"/.exec(line);
  if (m) {
    const val = m[1];
    if (line.startsWith('-')) {
      engines.nodeOld = val;
    } else {
      engines.nodeNew = val;
    }
  }
}

function processExportLine(line: string, data: ExportsAndSignatures): void {
  const names = extractExportedNamesFromLine(line);
  for (const n of names) {
    if (line.startsWith('+')) {
      data.addedExports.add(n);
    } else if (line.startsWith('-')) {
      data.removedExports.add(n);
    }
  }
}

function processSignatureLine(line: string, data: ExportsAndSignatures): void {
  const sig = extractFunctionSignature(line);
  if (!sig) return;

  const norm = normalizeSignature(sig.params);
  const map = line.startsWith('-') ? data.removedSignatures : data.addedSignatures;

  if (!map.has(sig.name)) {
    map.set(sig.name, new Set());
  }
  const nameSet = map.get(sig.name);
  if (nameSet) {
    nameSet.add(norm);
  }
}

function generateApiDiffSummary(
  data: ExportsAndSignatures,
  engines: EngineVersions,
  language: 'en' | 'ja'
): ApiDiffSummary {
  const bullets: string[] = [];
  let enginesDiff: { from: string; to: string } | undefined;

  // Node engines bullet
  if (engines.nodeOld && engines.nodeNew && engines.nodeOld !== engines.nodeNew) {
    enginesDiff = { from: engines.nodeOld, to: engines.nodeNew };
    bullets.push(
      language === 'ja'
        ? `実行環境要件: Node.js ${engines.nodeOld} → ${engines.nodeNew}`
        : `Runtime requirement: Node.js ${engines.nodeOld} → ${engines.nodeNew}`
    );
  }

  // API removals
  const trueRemoved = findTrueRemovals(data);
  if (trueRemoved.length > 0) {
    const list = summarizeList(trueRemoved, language);
    bullets.push(language === 'ja' ? `公開APIの削除: ${list}` : `Public API removals: ${list}`);
  }

  // API additions
  const trueAdded = findTrueAdditions(data);
  if (trueAdded.length > 0) {
    const list = summarizeList(trueAdded, language);
    bullets.push(language === 'ja' ? `公開APIの追加: ${list}` : `Public API additions: ${list}`);
  }

  // Signature changes
  const sigChanges = findSignatureChanges(data);
  if (sigChanges.length > 0) {
    const list = summarizeList(sigChanges, language);
    bullets.push(
      language === 'ja' ? `関数シグネチャの変更: ${list}` : `Function signature changes: ${list}`
    );
  }

  return { bullets, enginesDiff };
}

function findTrueRemovals(data: ExportsAndSignatures): string[] {
  return Array.from(data.removedExports).filter(
    (n) => !data.addedExports.has(n) && n !== 'default'
  );
}

function findTrueAdditions(data: ExportsAndSignatures): string[] {
  return Array.from(data.addedExports).filter((n) => !data.removedExports.has(n));
}

function findSignatureChanges(data: ExportsAndSignatures): string[] {
  const sigChanges: string[] = [];
  for (const [name, rem] of data.removedSignatures.entries()) {
    const add = data.addedSignatures.get(name);
    if (!add || add.size === 0) continue;
    const changed = Array.from(rem).some((s) => !add.has(s));
    if (changed) sigChanges.push(name);
  }
  return sigChanges;
}

// These functions are now imported from code-analysis-utils.ts

function summarizeList(items: string[], language: 'en' | 'ja'): string {
  const max = 4;
  if (items.length <= max) return items.join(', ');
  const head = items.slice(0, max).join(', ');
  const more = items.length - max;
  return language === 'ja' ? `${head}、他 ${more} 件` : `${head}, and ${more} more`;
}
