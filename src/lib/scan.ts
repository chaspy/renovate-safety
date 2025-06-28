import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import { glob } from 'glob';
import pLimit from 'p-limit';
import type { APIUsage, BreakingChange } from '../types/index.js';

const CONCURRENT_FILE_LIMIT = 10;

export async function scanAPIUsage(
  packageName: string,
  breakingChanges: BreakingChange[]
): Promise<APIUsage[]> {
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
  const limit = pLimit(CONCURRENT_FILE_LIMIT);
  const usages: APIUsage[] = [];

  await Promise.all(
    sourceFiles.map((sourceFile) =>
      limit(async () => {
        const fileUsages = await scanFile(sourceFile, packageName, apiPatterns);
        usages.push(...fileUsages);
      })
    )
  );

  // Remove duplicates and sort by file
  return deduplicateUsages(usages).sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
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

  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/*.test.{ts,tsx,js,jsx}',
    '**/*.spec.{ts,tsx,js,jsx}',
    '**/*.d.ts',
  ];

  const files: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      ignore: ignorePatterns,
      absolute: true,
    });
    files.push(...matches);
  }

  // Deduplicate
  return [...new Set(files)];
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
    const key = `${usage.file}:${usage.line}:${usage.apiName}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(usage);
    }
  }

  return unique;
}
