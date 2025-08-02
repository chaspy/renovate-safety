import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import { getFiles } from './glob-helpers.js';
import { processInParallel } from './parallel-helpers.js';
import type { APIUsage, BreakingChange } from '../types/index.js';

const CONCURRENT_FILE_LIMIT = 10;

interface APIPattern {
  name: string;
  regex: RegExp;
}

export async function scanAPIUsage(
  packageName: string,
  breakingChanges: BreakingChange[]
): Promise<APIUsage[]> {
  // Detect package type
  const packageType = detectPackageType(packageName);

  if (packageType === 'python') {
    return await scanPythonAPIUsage(packageName, breakingChanges);
  }

  // Find TypeScript/JavaScript files in the project
  const files = await findSourceFiles();
  if (files.length === 0) {
    return [];
  }

  // Extract API names from breaking changes
  const apiPatterns = extractAPIPatterns(packageName, breakingChanges);
  if (apiPatterns.length === 0) {
    return [];
  }

  // Create ts-morph project
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      moduleResolution: 2, // NodeJs
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  // Add files to project
  const sourceFiles = files.map((file) => project.addSourceFileAtPath(file));

  // Scan files concurrently
  const usages: APIUsage[] = [];

  const results = await processInParallel(
    sourceFiles,
    async (sourceFile) => {
      return await scanFile(sourceFile, packageName, apiPatterns);
    },
    { concurrency: CONCURRENT_FILE_LIMIT }
  );

  // Collect all usages from successful results
  for (const result of results) {
    if (!(result instanceof Error)) {
      usages.push(...result);
    }
  }

  // Remove duplicates and sort by file
  return deduplicateUsages(usages).sort((a, b) => {
    const aFile = a.file || a.filePath || '';
    const bFile = b.file || b.filePath || '';
    const fileCompare = aFile.localeCompare(bFile);
    return fileCompare !== 0 ? fileCompare : a.line - b.line;
  });
}

async function findSourceFiles(): Promise<string[]> {
  const patterns = [
    'src/**/*.{ts,tsx,js,jsx}',
    'lib/**/*.{ts,tsx,js,jsx}',
    'app/**/*.{ts,tsx,js,jsx}',
    'pages/**/*.{ts,tsx,js,jsx}',
    'components/**/*.{ts,tsx,js,jsx}',
    '*.{ts,tsx,js,jsx}',
  ];

  // Ignore patterns are handled by getFiles function

  // Use getFiles from glob-helpers to avoid duplication
  return await getFiles(patterns, {
    ecosystem: 'node',
    includeTests: false,
    absolute: true,
  });
}

function extractAPIPatterns(_packageName: string, breakingChanges: BreakingChange[]): string[] {
  const patterns = new Set<string>();

  for (const change of breakingChanges) {
    // Extract method/function names
    const methodMatches = change.line.matchAll(/`([a-zA-Z_$][a-zA-Z0-9_$]*)`/g);
    for (const match of methodMatches) {
      patterns.add(match[1]);
    }

    // Extract from common patterns
    const commonPatterns = [
      /removed\s+(?:method|function|property|class|interface|type|export)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/i,
      /renamed\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+to\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/i,
      /deprecated\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/i,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s+is\s+(?:removed|deprecated|renamed)/i,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s+has\s+been\s+(?:removed|deprecated|renamed)/i,
    ];

    for (const pattern of commonPatterns) {
      const matches = change.line.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) patterns.add(match[1]);
        if (match[2]) patterns.add(match[2]); // For rename patterns
      }
    }
  }

  return Array.from(patterns);
}

async function scanFile(
  sourceFile: SourceFile,
  packageName: string,
  apiPatterns: string[]
): Promise<APIUsage[]> {
  const usages: APIUsage[] = [];
  const filePath = path.relative(process.cwd(), sourceFile.getFilePath());

  // Check if file imports the package
  const importsPackage = checkImportsPackage(sourceFile, packageName);
  if (!importsPackage) {
    return usages;
  }

  // Find all identifiers that match our API patterns
  sourceFile.forEachDescendant((node) => {
    if (Node.isIdentifier(node)) {
      const name = node.getText();
      if (apiPatterns.includes(name)) {
        // Check if this identifier is from our package
        if (isFromPackage(node, packageName)) {
          const line = node.getStartLineNumber();
          const snippet = getContextSnippet(node);

          usages.push({
            file: filePath,
            line,
            snippet,
            apiName: name,
          });
        }
      }
    }
  });

  return usages;
}

function checkImportsPackage(sourceFile: SourceFile, packageName: string): boolean {
  // Check import declarations
  const importDeclarations = sourceFile.getImportDeclarations();
  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    if (moduleSpecifier === packageName || moduleSpecifier.startsWith(`${packageName}/`)) {
      return true;
    }
  }

  // Check require calls
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();
    if (Node.isIdentifier(expression) && expression.getText() === 'require') {
      const args = callExpr.getArguments();
      if (args.length > 0 && Node.isStringLiteral(args[0])) {
        const moduleSpecifier = args[0].getLiteralValue();
        if (moduleSpecifier === packageName || moduleSpecifier.startsWith(`${packageName}/`)) {
          return true;
        }
      }
    }
  }

  return false;
}

function isFromPackage(identifier: Node, packageName: string): boolean {
  // This is a simplified check - in a real implementation, we'd need to:
  // 1. Track import bindings
  // 2. Follow variable assignments
  // 3. Handle namespace imports
  // 4. Handle re-exports

  // For now, we'll use a heuristic approach
  const parent = identifier.getParent();
  if (!parent) return false;

  // Check if it's a property access on an imported namespace
  if (Node.isPropertyAccessExpression(parent)) {
    const expression = parent.getExpression();
    if (Node.isIdentifier(expression)) {
      // Check if this identifier was imported from our package
      const sourceFile = identifier.getSourceFile();
      const importDecl = sourceFile.getImportDeclaration((decl) => {
        const moduleSpecifier = decl.getModuleSpecifierValue();
        if (moduleSpecifier !== packageName && !moduleSpecifier.startsWith(`${packageName}/`)) {
          return false;
        }

        // Check if this import includes our identifier
        const namedImports = decl.getNamedImports();
        for (const namedImport of namedImports) {
          if (namedImport.getName() === expression.getText()) {
            return true;
          }
        }

        // Check namespace import
        const namespaceImport = decl.getNamespaceImport();
        if (namespaceImport && namespaceImport.getText() === expression.getText()) {
          return true;
        }

        return false;
      });

      return !!importDecl;
    }
  }

  // For direct usage, check if it was imported
  const sourceFile = identifier.getSourceFile();
  const importDecl = sourceFile.getImportDeclaration((decl) => {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    if (moduleSpecifier !== packageName && !moduleSpecifier.startsWith(`${packageName}/`)) {
      return false;
    }

    const namedImports = decl.getNamedImports();
    for (const namedImport of namedImports) {
      if (namedImport.getName() === identifier.getText()) {
        return true;
      }
    }

    return false;
  });

  return !!importDecl;
}

function getContextSnippet(node: Node): string {
  // Get the containing statement or expression
  let contextNode: Node | undefined = node;

  while (contextNode && !isStatementOrExpression(contextNode)) {
    contextNode = contextNode.getParent();
  }

  if (!contextNode) {
    contextNode = node;
  }

  // Get text and limit length
  let text = contextNode.getText();
  if (text.length > 80) {
    // Find the identifier position and show context around it
    const nodeText = node.getText();
    const nodeStart = contextNode.getText().indexOf(nodeText);

    if (nodeStart >= 0) {
      const start = Math.max(0, nodeStart - 30);
      const end = Math.min(text.length, nodeStart + nodeText.length + 30);
      text =
        (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
    } else {
      text = text.substring(0, 77) + '...';
    }
  }

  // Clean up whitespace
  return text.replace(/\s+/g, ' ').trim();
}

function isStatementOrExpression(node: Node): boolean {
  const kind = node.getKind();
  return (
    kind === SyntaxKind.ExpressionStatement ||
    kind === SyntaxKind.VariableStatement ||
    kind === SyntaxKind.ReturnStatement ||
    kind === SyntaxKind.IfStatement ||
    kind === SyntaxKind.CallExpression ||
    kind === SyntaxKind.PropertyAccessExpression ||
    kind === SyntaxKind.BinaryExpression
  );
}

function deduplicateUsages(usages: APIUsage[]): APIUsage[] {
  const seen = new Set<string>();
  const unique: APIUsage[] = [];

  for (const usage of usages) {
    const file = usage.file || usage.filePath || 'unknown';
    const key = `${file}:${usage.line}:${usage.apiName}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(usage);
    }
  }

  return unique;
}

function detectPackageType(packageName: string): 'javascript' | 'python' | 'unknown' {
  // Common Python package patterns
  const pythonPatterns = [
    /^(django|flask|numpy|pandas|scipy|matplotlib|requests|pytest|pylint|black|mypy|flake8|poetry|setuptools|pip|wheel)/i,
    /^(tensorflow|torch|keras|scikit-learn|jupyter|ipython|beautifulsoup|selenium|sqlalchemy|celery|redis|pymongo)/i,
    /^(lxml|pillow|cryptography|pyyaml|boto3|aiohttp|fastapi|pydantic|uvicorn|gunicorn)/i,
  ];

  // Check if it matches Python patterns
  for (const pattern of pythonPatterns) {
    if (pattern.test(packageName)) {
      return 'python';
    }
  }

  // Check for Python-style naming (underscore instead of hyphen)
  if (packageName.includes('_') && !packageName.includes('-')) {
    return 'python';
  }

  // Default to JavaScript for now
  return 'javascript';
}

async function scanPythonAPIUsage(
  packageName: string,
  breakingChanges: BreakingChange[]
): Promise<APIUsage[]> {
  // Find Python files in the project
  const files = await findPythonSourceFiles();
  if (files.length === 0) {
    return [];
  }

  // Extract API names from breaking changes
  const apiNames = extractAPIPatterns(packageName, breakingChanges);
  if (apiNames.length === 0) {
    return [];
  }

  // Convert to APIPattern objects for Python scanning
  const apiPatterns: APIPattern[] = apiNames.map((name) => ({
    name,
    regex: new RegExp(`\\b${escapeRegex(name)}\\b`),
  }));

  const usages: APIUsage[] = [];

  // Use simple regex-based scanning for Python files
  const results = await processInParallel(
    files,
    async (file) => {
      return await scanPythonFile(file, packageName, apiPatterns);
    },
    { concurrency: CONCURRENT_FILE_LIMIT }
  );

  // Collect all usages from successful results
  for (const result of results) {
    if (!(result instanceof Error)) {
      usages.push(...result);
    }
  }

  return deduplicateUsages(usages);
}

async function findPythonSourceFiles(): Promise<string[]> {
  // Pattern and ignore rules are handled by getFiles function
  // Use getFiles from glob-helpers for Python files
  const files = await getFiles('**/*.py', {
    ecosystem: 'python',
    includeTests: false,
    absolute: true,
  });

  return files;
}

async function scanPythonFile(
  filePath: string,
  packageName: string,
  apiPatterns: APIPattern[]
): Promise<APIUsage[]> {
  const fs = await import('fs/promises');
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const usages: APIUsage[] = [];

  // Check if file imports the package
  const importRegex = new RegExp(
    `^\\s*(from\\s+${escapeRegex(packageName)}(?:\\.[\\w.]+)?\\s+import|import\\s+${escapeRegex(packageName)})`,
    'gm'
  );

  if (!importRegex.test(content)) {
    return [];
  }

  // Look for API usage patterns
  for (const pattern of apiPatterns) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // Check if line contains the API pattern
      if (pattern.regex.test(line)) {
        // Get context (3 lines before and after)
        const startLine = Math.max(0, i - 3);
        const endLine = Math.min(lines.length - 1, i + 3);
        const context = lines.slice(startLine, endLine + 1).join('\n');

        usages.push({
          file: path.relative(process.cwd(), filePath),
          filePath: path.relative(process.cwd(), filePath),
          line: lineNumber,
          column: 1,
          snippet: context,
          context,
          apiName: pattern.name,
          usageType: detectPythonUsageType(line, pattern.name),
        });
      }
    }
  }

  return usages;
}

function detectPythonUsageType(line: string, apiName: string): 'import' | 'call' | 'reference' {
  if (/^\s*(from|import)/.test(line)) {
    return 'import';
  }
  if (new RegExp(`${escapeRegex(apiName)}\\s*\\(`).test(line)) {
    return 'call';
  }
  return 'reference';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
