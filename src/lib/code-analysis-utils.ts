/**
 * Shared utilities for code analysis
 * Extracted to reduce code duplication between api-diff-summary.ts and breaking-change-analyzer.ts
 */

/**
 * Extract exported names from a code line
 */
export function extractExportedNamesFromLine(line: string): string[] {
  const content = line.substring(1);
  const names: string[] = [];

  // export function/const/let/var name
  let m = /export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(content);
  if (m) {
    names.push(m[1]);
  }

  // export class/interface/type/enum
  m = /export\s+(?:abstract\s+)?(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(content);
  if (m) {
    names.push(m[1]);
  }

  // Check for export list: export { name1, name2 }
  const expBrace = /export\s*\{([^}]+)\}/.exec(content);
  if (expBrace) {
    const parts = expBrace[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    names.push(...parts);
  }

  // module.exports = { name1, name2 }
  const cjsObj = /module\.exports\s*=\s*\{([^}]+)\}/.exec(content);
  if (cjsObj) {
    const parts = cjsObj[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/:\s*[^,}]{0,100}/, ''));
    names.push(...parts);
  }

  return Array.from(new Set(names.filter(Boolean)));
}

/**
 * Extract function signature name and param list from a diff line
 */
export function extractFunctionSignature(line: string): { name: string; params: string } | null {
  const content = line.substring(1);

  // export function name(params)
  let m = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(content);
  if (m) return { name: m[1], params: m[2] };

  // export const name = (params) =>
  m = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/.exec(content);
  if (m) return { name: m[1], params: m[2] };

  // export declare function name(params)
  m = /export\s+declare\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(content);
  if (m) return { name: m[1], params: m[2] };

  // declare function name(params)
  m = /declare\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(content);
  if (m) return { name: m[1], params: m[2] };

  return null;
}

/**
 * Normalize parameter list for signature comparison
 */
export function normalizeSignature(params: string): string {
  let p = params;
  p = p.replace(/[?]/g, '');
  p = p.replace(/\b(public|private|protected|readonly)\s+/g, '');
  p = p.replace(/:\s*([^,)]{1,100})/g, ''); // remove type annotations
  p = p.replace(/=\s*([^,)]{1,100})/g, ''); // remove defaults
  p = p.replace(/\s+/g, '');
  return p.trim();
}
