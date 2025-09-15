import type { CodeDiff } from './github-diff.js';

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

function extractExportedNamesFromLine(line: string): string[] {
  const names: string[] = [];
  const content = line.substring(1);
  const esmDecl =
    /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(content);
  if (esmDecl) names.push(esmDecl[1]);
  if (/export\s+default\s+/.test(content)) names.push('default');
  const listMatch = /export\s*\{([^}]+)\}/.exec(content);
  if (listMatch) {
    const parts = listMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\s{1,10}as\s{1,10}[^,}]{1,100}$/, ''));
    names.push(...parts);
  }
  const cjsProp = /exports\.([A-Za-z_$][\w$]*)\s*=/.exec(content);
  if (cjsProp) names.push(cjsProp[1]);
  const cjsObj = /module\.exports\s*=\s*\{([^}]+)\}/.exec(content);
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

function extractFunctionSignature(line: string): { name: string; params: string } | null {
  const content = line.substring(1);
  let m = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(content);
  if (m) return { name: m[1], params: m[2] };
  m = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/.exec(content);
  if (m) return { name: m[1], params: m[2] };
  m = /export\s+declare\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(content);
  if (m) return { name: m[1], params: m[2] };
  m = /declare\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(content);
  if (m) return { name: m[1], params: m[2] };
  return null;
}

function normalizeSignature(params: string): string {
  let p = params;
  p = p.replace(/[?]/g, '');
  p = p.replace(/\b(public|private|protected|readonly)\s{1,10}/g, '');
  p = p.replace(/:\s{0,10}([^,)]{1,100})/g, '');
  p = p.replace(/=\s{0,10}([^,)]{1,100})/g, '');
  p = p.replace(/\s+/g, '');
  return p.trim();
}

function summarizeList(items: string[], language: 'en' | 'ja'): string {
  const max = 4;
  if (items.length <= max) return items.join(', ');
  const head = items.slice(0, max).join(', ');
  const more = items.length - max;
  return language === 'ja' ? `${head}、他 ${more} 件` : `${head}, and ${more} more`;
}
