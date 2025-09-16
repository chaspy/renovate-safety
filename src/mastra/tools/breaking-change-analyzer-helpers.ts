// Helper functions for breaking change analyzer to reduce complexity

export interface ExportTracking {
  removedExportNames: Set<string>;
  addedExportNames: Set<string>;
  removedSignatures: Map<string, Set<string>>;
  addedSignatures: Map<string, Set<string>>;
}

export function processAddedLine(
  line: string,
  file: string,
  tracking: ExportTracking,
  extractExportedNamesFromLine: (line: string, file: string) => string[],
  extractFunctionSignature: (line: string) => any,
  normalizeSignature: (params: string) => string
): void {
  const names = extractExportedNamesFromLine(line, file);
  for (const n of names) {
    tracking.addedExportNames.add(n);
  }

  const sig = extractFunctionSignature(line);
  if (sig) {
    const norm = normalizeSignature(sig.params);
    if (!tracking.addedSignatures.has(sig.name)) {
      tracking.addedSignatures.set(sig.name, new Set());
    }
    tracking.addedSignatures.get(sig.name)!.add(norm);
  }
}

export function processRemovedLine(
  line: string,
  file: string,
  tracking: ExportTracking,
  extractExportedNamesFromLine: (line: string, file: string) => string[],
  extractFunctionSignature: (line: string) => any,
  normalizeSignature: (params: string) => string
): void {
  const names = extractExportedNamesFromLine(line, file);
  for (const n of names) {
    tracking.removedExportNames.add(n);
  }

  const sig = extractFunctionSignature(line);
  if (sig) {
    const norm = normalizeSignature(sig.params);
    if (!tracking.removedSignatures.has(sig.name)) {
      tracking.removedSignatures.set(sig.name, new Set());
    }
    tracking.removedSignatures.get(sig.name)!.add(norm);
  }
}

export function detectApiRemovals(
  removedExportNames: Set<string>,
  addedExportNames: Set<string>,
  breakingChanges: any[],
  detectedChanges: Set<string>
): void {
  const trueRemoved = Array.from(removedExportNames).filter(
    (n) => !addedExportNames.has(n)
  );

  if (trueRemoved.length > 0) {
    const changeKey = 'api-removal';
    if (!detectedChanges.has(changeKey)) {
      breakingChanges.push({
        text: 'API functions or classes removed',
        severity: 'breaking',
        source: 'npm-diff',
        category: 'api-change',
        confidence: 0.85,
      });
      detectedChanges.add(changeKey);
    }
  }
}

export function detectSignatureChanges(
  removedSignatures: Map<string, Set<string>>,
  addedSignatures: Map<string, Set<string>>,
  breakingChanges: any[],
  detectedChanges: Set<string>
): void {
  const signatureChanges: string[] = [];

  for (const [name, removedSet] of removedSignatures.entries()) {
    const addedSet = addedSignatures.get(name);
    if (!addedSet || addedSet.size === 0) continue;

    const diffExists = Array.from(removedSet).some((sig) => !addedSet.has(sig));
    if (diffExists) {
      signatureChanges.push(name);
    }
  }

  if (signatureChanges.length > 0) {
    const changeKey = 'signature-change';
    if (!detectedChanges.has(changeKey)) {
      breakingChanges.push({
        text: `Function signatures changed: ${signatureChanges.join(', ')}`,
        severity: 'breaking',
        source: 'npm-diff',
        category: 'api-change',
        confidence: 0.8,
      });
      detectedChanges.add(changeKey);
    }
  }
}

export function shouldSkipFile(
  file: string,
  isIgnoredFile: (file: string) => boolean,
  publicEntryHints: string[],
  isPublicPath: (file: string) => boolean
): boolean {
  if (isIgnoredFile(file)) return true;

  if (publicEntryHints.length > 0 && !isPublicPath(file)) {
    return true;
  }

  return false;
}

export function processChangeContent(
  change: any,
  tracking: ExportTracking,
  extractExportedNamesFromLine: (line: string, file: string) => string[],
  extractFunctionSignature: (line: string) => any,
  normalizeSignature: (params: string) => string
): void {
  if (!change.content || typeof change.content !== 'string') return;

  const lines = change.content.split('\n');
  const file = String(change.file || '');

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      processAddedLine(
        line,
        file,
        tracking,
        extractExportedNamesFromLine,
        extractFunctionSignature,
        normalizeSignature
      );
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      processRemovedLine(
        line,
        file,
        tracking,
        extractExportedNamesFromLine,
        extractFunctionSignature,
        normalizeSignature
      );
    }
  }
}