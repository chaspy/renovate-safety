import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import { getSourceFiles, getConfigFiles } from './glob-helpers.js';
import * as fs from 'fs/promises';
import { processInParallel } from './parallel-helpers.js';
import type {
  PackageUpdate,
  PackageUsageDetail,
  APIUsageDetail,
  FileClassification,
  ConfigFileUsage,
  DeepAnalysisResult,
} from '../types/index.js';
import { safeJsonParse } from './safe-json.js';

const CONCURRENT_FILE_LIMIT = 10;

export async function performDeepAnalysis(
  packageUpdate: PackageUpdate,
  breakingAPIs?: string[]
): Promise<DeepAnalysisResult> {
  const { name: packageName } = packageUpdate;

  // Find all source files
  const allFiles = await findAllProjectFiles();

  // Create TypeScript project
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

  // Add source files to project
  const sourceFiles = allFiles.sourceFiles.map((file) => project.addSourceFileAtPath(file));

  // Analyze imports and usage
  const imports: PackageUsageDetail[] = [];
  const apiUsages: APIUsageDetail[] = [];

  const results = await processInParallel(
    sourceFiles,
    async (sourceFile) => {
      const fileImports = await analyzeFileImports(sourceFile, packageName);

      let fileApiUsages: APIUsageDetail[] = [];
      if (fileImports.length > 0) {
        fileApiUsages = await analyzeFileAPIUsage(sourceFile, packageName, breakingAPIs);
      }

      return { fileImports, fileApiUsages };
    },
    { concurrency: CONCURRENT_FILE_LIMIT }
  );

  // Collect all results
  for (const result of results) {
    if (!(result instanceof Error)) {
      imports.push(...result.fileImports);
      apiUsages.push(...result.fileApiUsages);
    }
  }

  // Classify files
  const fileClassifications = await classifyFiles([
    ...new Set([...imports, ...apiUsages].map((u) => u.file)),
  ]);

  // Analyze config files
  const configUsages = await analyzeConfigFiles(allFiles.configFiles, packageName);

  // Generate summary
  const usageSummary = generateUsageSummary(imports, apiUsages, fileClassifications);

  // Generate recommendations
  const recommendations = await generateRecommendations(
    packageUpdate,
    imports,
    apiUsages,
    fileClassifications,
    configUsages,
    breakingAPIs
  );

  return {
    packageName,
    totalFiles: allFiles.sourceFiles.length,
    filesUsingPackage: new Set(imports.map((i) => i.file)).size,
    imports,
    apiUsages,
    fileClassifications,
    configUsages,
    usageSummary,
    recommendations,
  };
}

async function findAllProjectFiles(): Promise<{ sourceFiles: string[]; configFiles: string[] }> {
  // Use getSourceFiles from glob-helpers for JavaScript/TypeScript files
  const sourceFiles = await getSourceFiles(process.cwd(), 'node');

  // Use getConfigFiles from glob-helpers for configuration files
  const configFiles = await getConfigFiles(process.cwd());

  return {
    sourceFiles,
    configFiles,
  };
}

async function analyzeFileImports(
  sourceFile: SourceFile,
  packageName: string
): Promise<PackageUsageDetail[]> {
  const imports: PackageUsageDetail[] = [];
  const filePath = path.relative(process.cwd(), sourceFile.getFilePath());

  // Analyze import declarations
  const importDeclarations = sourceFile.getImportDeclarations();
  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    if (isPackageImport(moduleSpecifier, packageName)) {
      const importDetail: PackageUsageDetail = {
        file: filePath,
        line: importDecl.getStartLineNumber(),
        type: 'import',
        importSpecifier: moduleSpecifier,
        isTypeOnly: importDecl.isTypeOnly(),
      };

      // Get named imports
      const namedImports = importDecl.getNamedImports();
      if (namedImports.length > 0) {
        importDetail.namedImports = namedImports.map((ni) => ni.getName());
      }

      // Get default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        importDetail.defaultImport = defaultImport.getText();
      }

      // Get namespace import
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        importDetail.namespaceImport = namespaceImport.getText();
      }

      imports.push(importDetail);
    }
  }

  // Analyze require calls
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();
    if (Node.isIdentifier(expression) && expression.getText() === 'require') {
      const args = callExpr.getArguments();
      if (args.length > 0 && Node.isStringLiteral(args[0])) {
        const moduleSpecifier = args[0].getLiteralValue();

        if (isPackageImport(moduleSpecifier, packageName)) {
          imports.push({
            file: filePath,
            line: callExpr.getStartLineNumber(),
            type: 'require',
            importSpecifier: moduleSpecifier,
          });
        }
      }
    }

    // Check for dynamic imports
    if (expression.getText() === 'import') {
      const args = callExpr.getArguments();
      if (args.length > 0 && Node.isStringLiteral(args[0])) {
        const moduleSpecifier = args[0].getLiteralValue();

        if (isPackageImport(moduleSpecifier, packageName)) {
          imports.push({
            file: filePath,
            line: callExpr.getStartLineNumber(),
            type: 'dynamic-import',
            importSpecifier: moduleSpecifier,
          });
        }
      }
    }
  }

  return imports;
}

async function analyzeFileAPIUsage(
  sourceFile: SourceFile,
  packageName: string,
  breakingAPIs?: string[]
): Promise<APIUsageDetail[]> {
  const usages: APIUsageDetail[] = [];
  const filePath = path.relative(process.cwd(), sourceFile.getFilePath());

  // Track imported symbols from the package
  const importedSymbols = getImportedSymbols(sourceFile, packageName);

  // Find all identifiers and analyze their usage
  sourceFile.forEachDescendant((node) => {
    if (Node.isIdentifier(node)) {
      const identifierName = node.getText();

      // Check if this identifier is from our package
      if (importedSymbols.has(identifierName) || breakingAPIs?.includes(identifierName)) {
        const usage = analyzeIdentifierUsage(node, filePath);
        if (usage) {
          usages.push(usage);
        }
      }
    }
  });

  return usages;
}

function getImportedSymbols(sourceFile: SourceFile, packageName: string): Set<string> {
  const symbols = new Set<string>();

  // From import declarations
  const importDeclarations = sourceFile.getImportDeclarations();
  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    if (isPackageImport(moduleSpecifier, packageName)) {
      // Named imports
      importDecl.getNamedImports().forEach((ni) => symbols.add(ni.getName()));

      // Default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        symbols.add(defaultImport.getText());
      }

      // Namespace import
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        symbols.add(namespaceImport.getText());
      }
    }
  }

  return symbols;
}

function analyzeIdentifierUsage(identifier: Node, filePath: string): APIUsageDetail | null {
  const parent = identifier.getParent();
  if (!parent) return null;

  const line = identifier.getStartLineNumber();
  const apiName = identifier.getText();

  // Try different usage patterns
  return (
    analyzeFunctionCall(identifier, parent, filePath, line, apiName) ||
    analyzeConstructorCall(identifier, parent, filePath, line, apiName) ||
    analyzePropertyAccess(identifier, parent, filePath, line, apiName) ||
    analyzeTypeReference(identifier, parent, filePath, line, apiName) ||
    analyzeDecorator(identifier, parent, filePath, line, apiName) ||
    analyzeJSXComponent(identifier, parent, filePath, line, apiName) ||
    null
  );
}

function analyzeFunctionCall(
  identifier: Node,
  parent: Node,
  filePath: string,
  line: number,
  apiName: string
): APIUsageDetail | null {
  // Check if the parent is a call expression where this identifier is the function being called
  if (Node.isCallExpression(parent) && parent.getExpression() === identifier) {
    const args = parent.getArguments().map((arg) => arg.getText().substring(0, 50));
    return {
      file: filePath,
      line,
      apiName,
      usageType: 'function-call',
      context: getContextSnippet(parent),
      arguments: args,
    };
  }
  return null;
}

function analyzeConstructorCall(
  identifier: Node,
  parent: Node,
  filePath: string,
  line: number,
  apiName: string
): APIUsageDetail | null {
  // Check if it's a 'new' expression
  if (Node.isNewExpression(parent) && parent.getExpression() === identifier) {
    const args = parent.getArguments().map((arg) => arg.getText().substring(0, 50));
    return {
      file: filePath,
      line,
      apiName,
      usageType: 'constructor',
      context: getContextSnippet(parent),
      arguments: args,
    };
  }
  return null;
}

function analyzePropertyAccess(
  _identifier: Node,
  parent: Node,
  filePath: string,
  line: number,
  apiName: string
): APIUsageDetail | null {
  // Check if it's a property access expression
  if (Node.isPropertyAccessExpression(parent)) {
    // Could be either the left side (object) or right side (property)
    const chainedCalls: string[] = [];
    let current: Node = parent;

    // Build chained calls
    while (Node.isPropertyAccessExpression(current) || Node.isCallExpression(current)) {
      if (Node.isPropertyAccessExpression(current)) {
        const propertyName = current.getName();
        chainedCalls.unshift(propertyName);
        current = current.getExpression();
      } else if (Node.isCallExpression(current)) {
        chainedCalls.unshift('()');
        current = current.getExpression();
      } else {
        break;
      }
    }

    return {
      file: filePath,
      line,
      apiName,
      usageType: 'property-access',
      context: getContextSnippet(parent),
      chainedCalls: chainedCalls.slice(0, 10), // Limit to prevent excessive memory usage
    };
  }
  return null;
}

function analyzeTypeReference(
  identifier: Node,
  parent: Node,
  filePath: string,
  line: number,
  apiName: string
): APIUsageDetail | null {
  // Check if it's used as a type reference
  if (Node.isTypeReference(parent) && parent.getTypeName() === identifier) {
    return {
      file: filePath,
      line,
      apiName,
      usageType: 'type-reference',
      context: getContextSnippet(parent),
    };
  }

  // Check for other type-related contexts
  if (
    Node.isVariableDeclaration(parent.getParent()) ||
    Node.isParameterDeclaration(parent.getParent()) ||
    Node.isFunctionDeclaration(parent.getParent()?.getParent())
  ) {
    return {
      file: filePath,
      line,
      apiName,
      usageType: 'type-reference',
      context: getContextSnippet(parent),
    };
  }

  return null;
}

function analyzeDecorator(
  identifier: Node,
  parent: Node,
  filePath: string,
  line: number,
  apiName: string
): APIUsageDetail | null {
  // Check if it's used as a decorator
  if (Node.isDecorator(parent) && parent.getCallExpression()?.getExpression() === identifier) {
    const callExpr = parent.getCallExpression();
    const args = callExpr
      ? callExpr.getArguments().map((arg) => arg.getText().substring(0, 50))
      : [];

    return {
      file: filePath,
      line,
      apiName,
      usageType: 'decorator',
      context: getContextSnippet(parent),
      arguments: args,
    };
  }
  return null;
}

function analyzeJSXComponent(
  identifier: Node,
  parent: Node,
  filePath: string,
  line: number,
  apiName: string
): APIUsageDetail | null {
  // Check if it's used as a JSX element
  if (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent)) {
    const tagName = parent.getTagNameNode();
    if (tagName === identifier) {
      return {
        file: filePath,
        line,
        apiName,
        usageType: 'jsx-component',
        context: getContextSnippet(parent),
      };
    }
  }
  return null;
}

async function classifyFiles(files: string[]): Promise<FileClassification[]> {
  const classifications: FileClassification[] = [];

  for (const file of files) {
    const classification = await classifyFile(file);
    classifications.push(classification);
  }

  return classifications;
}

async function classifyFile(filePath: string): Promise<FileClassification> {
  const indicators: string[] = [];
  let category: FileClassification['category'] = 'production';
  let confidence = 0.5;

  const normalizedPath = filePath.toLowerCase();

  // Test files
  if (
    normalizedPath.includes('test') ||
    normalizedPath.includes('spec') ||
    normalizedPath.includes('__tests__') ||
    normalizedPath.includes('__mocks__') ||
    normalizedPath.endsWith('.test.js') ||
    normalizedPath.endsWith('.test.ts') ||
    normalizedPath.endsWith('.spec.js') ||
    normalizedPath.endsWith('.spec.ts')
  ) {
    category = 'test';
    confidence = 0.9;
    indicators.push('test/spec in filename or path');
  }

  // Config files
  else if (
    normalizedPath.includes('config') ||
    normalizedPath.endsWith('.config.js') ||
    normalizedPath.endsWith('.config.ts') ||
    path.basename(normalizedPath).startsWith('.')
  ) {
    category = 'config';
    confidence = 0.8;
    indicators.push('config in filename or dotfile');
  }

  // Build files
  else if (
    normalizedPath.includes('webpack') ||
    normalizedPath.includes('rollup') ||
    normalizedPath.includes('vite') ||
    normalizedPath.includes('esbuild') ||
    normalizedPath.includes('gulpfile') ||
    normalizedPath.includes('build')
  ) {
    category = 'build';
    confidence = 0.8;
    indicators.push('build tool reference in filename');
  }

  // Documentation files
  else if (
    normalizedPath.includes('docs') ||
    normalizedPath.includes('examples') ||
    normalizedPath.includes('demo')
  ) {
    category = 'documentation';
    confidence = 0.7;
    indicators.push('docs/examples/demo in path');
  }

  // Additional heuristics based on file content (if needed)
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 50); // Check first 50 lines

    // Check for test frameworks
    if (category !== 'test') {
      const testPatterns = [
        /import.*from\s+['"](?:jest|mocha|chai|vitest|@testing-library)/,
        /require\s*\(\s*['"](?:jest|mocha|chai|vitest|@testing-library)/,
        /(?:describe|it|test|expect)\s*\(/,
      ];

      for (const line of lines) {
        for (const pattern of testPatterns) {
          if (pattern.test(line)) {
            category = 'test';
            confidence = Math.max(confidence, 0.8);
            indicators.push('test framework usage detected');
            break;
          }
        }
      }
    }
  } catch {
    // File read error, use path-based classification only
  }

  return {
    file: filePath,
    category,
    confidence,
    indicators,
  };
}

async function analyzeConfigFiles(
  configFiles: string[],
  packageName: string
): Promise<ConfigFileUsage[]> {
  const usages: ConfigFileUsage[] = [];

  for (const configFile of configFiles) {
    try {
      const content = await fs.readFile(configFile, 'utf-8');
      const filename = path.basename(configFile);

      // Determine config type
      let configType: ConfigFileUsage['configType'] = 'other';
      if (filename === 'package.json') configType = 'package.json';
      else if (filename.startsWith('tsconfig')) configType = 'tsconfig.json';
      else if (filename.includes('webpack')) configType = 'webpack';
      else if (filename.includes('rollup')) configType = 'rollup';
      else if (filename.includes('vite')) configType = 'vite';
      else if (filename.includes('babel') || filename === '.babelrc') configType = 'babel';
      else if (filename.includes('eslint') || filename === '.eslintrc') configType = 'eslint';
      else if (filename.includes('prettier') || filename === '.prettierrc') configType = 'prettier';

      // Check if package is referenced
      if (content.includes(packageName)) {
        let parsedContent: unknown = null;

        if (
          filename.endsWith('.json') ||
          filename === '.babelrc' ||
          filename === '.eslintrc' ||
          filename === '.prettierrc'
        ) {
          parsedContent = safeJsonParse(content, null);
        }

        // Extract usage context
        let usage = 'Package referenced in configuration';

        if (configType === 'package.json' && parsedContent) {
          const sections = [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
          ];
          const jsonContent = parsedContent as Record<string, Record<string, unknown>>;
          for (const section of sections) {
            const versionValue = jsonContent[section]?.[packageName];
            if (versionValue) {
              let versionString: string;
              if (typeof versionValue === 'string') {
                versionString = versionValue;
              } else if (typeof versionValue === 'number') {
                versionString = String(versionValue);
              } else {
                versionString = JSON.stringify(versionValue);
              }
              usage = `Version ${versionString} in ${section}`;
              break;
            }
          }
        }

        usages.push({
          file: path.relative(process.cwd(), configFile),
          configType,
          usage,
          content: parsedContent || content.substring(0, 500), // Limit content size
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return usages;
}

function generateUsageSummary(
  _imports: PackageUsageDetail[],
  apiUsages: APIUsageDetail[],
  fileClassifications: FileClassification[]
): DeepAnalysisResult['usageSummary'] {
  // Count by file type
  const byFileType: Record<string, number> = {};
  for (const classification of fileClassifications) {
    byFileType[classification.category] = (byFileType[classification.category] || 0) + 1;
  }

  // Count by API usage type
  const byAPIType: Record<string, number> = {};
  for (const usage of apiUsages) {
    byAPIType[usage.usageType] = (byAPIType[usage.usageType] || 0) + 1;
  }

  // Count API frequency
  const apiCounts: Record<string, number> = {};
  for (const usage of apiUsages) {
    apiCounts[usage.apiName] = (apiCounts[usage.apiName] || 0) + 1;
  }

  // Most used APIs
  const mostUsedAPIs = Object.entries(apiCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([api, count]) => ({ api, count }));

  // Test vs Production
  const testFiles = fileClassifications.filter((f) => f.category === 'test').length;
  const productionFiles = fileClassifications.filter((f) => f.category === 'production').length;

  return {
    byFileType,
    byAPIType,
    mostUsedAPIs,
    testVsProduction: {
      test: testFiles,
      production: productionFiles,
    },
  };
}

async function generateRecommendations(
  packageUpdate: PackageUpdate,
  imports: PackageUsageDetail[],
  apiUsages: APIUsageDetail[],
  fileClassifications: FileClassification[],
  configUsages: ConfigFileUsage[],
  breakingAPIs?: string[]
): Promise<string[]> {
  const recommendations: string[] = [];

  // Check if package is heavily used
  if (imports.length > 20) {
    recommendations.push(
      `Package is heavily used across ${imports.length} files. Consider gradual migration.`
    );
  }

  // Check test coverage
  const testFiles = fileClassifications.filter((f) => f.category === 'test');
  const productionFiles = fileClassifications.filter((f) => f.category === 'production');

  if (testFiles.length === 0 && productionFiles.length > 0) {
    recommendations.push('No test files found using this package. Add tests before updating.');
  } else if (testFiles.length < productionFiles.length * 0.5) {
    recommendations.push('Limited test coverage. Consider adding more tests for affected APIs.');
  }

  // Check for breaking API usage
  if (breakingAPIs && breakingAPIs.length > 0) {
    const affectedAPIs = apiUsages.filter((u) => breakingAPIs.includes(u.apiName));
    if (affectedAPIs.length > 0) {
      const uniqueAPIs = [...new Set(affectedAPIs.map((a) => a.apiName))];
      recommendations.push(
        `Found ${affectedAPIs.length} usages of ${uniqueAPIs.length} breaking APIs. Manual review required.`
      );
    }
  }

  // Check for type-only imports
  const typeOnlyImports = imports.filter((i) => i.isTypeOnly);
  if (typeOnlyImports.length > 0) {
    recommendations.push(
      `${typeOnlyImports.length} type-only imports found. These are generally safe to update.`
    );
  }

  // Check for dynamic imports
  const dynamicImports = imports.filter((i) => i.type === 'dynamic-import');
  if (dynamicImports.length > 0) {
    recommendations.push(
      `${dynamicImports.length} dynamic imports found. Ensure runtime compatibility.`
    );
  }

  // Check for config file usage
  if (configUsages.length > 0) {
    const configTypes = [...new Set(configUsages.map((c) => c.configType))];
    recommendations.push(
      `Package referenced in ${configTypes.join(', ')} configs. Update configurations if needed.`
    );
  }

  // Version-specific recommendations
  try {
    const semver = await import('semver');
    const fromMajor = semver.major(packageUpdate.fromVersion);
    const toMajor = semver.major(packageUpdate.toVersion);

    if (toMajor > fromMajor) {
      recommendations.push('Major version update. Review migration guide and test thoroughly.');
    }
  } catch {
    // Ignore semver parsing errors
  }

  return recommendations;
}

function isPackageImport(moduleSpecifier: string, packageName: string): boolean {
  return (
    moduleSpecifier === packageName ||
    moduleSpecifier.startsWith(`${packageName}/`) ||
    moduleSpecifier.startsWith(`@types/${packageName}`)
  );
}

function getContextSnippet(node: Node): string {
  let contextNode: Node | undefined = node;

  // Find the containing statement
  while (contextNode && !isStatement(contextNode)) {
    contextNode = contextNode.getParent();
  }

  if (!contextNode) {
    contextNode = node;
  }

  let text = contextNode.getText();

  // Limit length
  if (text.length > 120) {
    const nodeText = node.getText();
    const nodeStart = text.indexOf(nodeText);

    if (nodeStart >= 0) {
      const start = Math.max(0, nodeStart - 40);
      const end = Math.min(text.length, nodeStart + nodeText.length + 40);
      const startEllipsis = start > 0 ? '...' : '';
      const endEllipsis = end < text.length ? '...' : '';
      text = startEllipsis + text.substring(start, end) + endEllipsis;
    } else {
      text = text.substring(0, 117) + '...';
    }
  }

  // Clean up whitespace
  return text.replace(/\s+/g, ' ').trim();
}

function isStatement(node: Node): boolean {
  const kind = node.getKind();
  return (
    kind === SyntaxKind.ExpressionStatement ||
    kind === SyntaxKind.VariableStatement ||
    kind === SyntaxKind.ReturnStatement ||
    kind === SyntaxKind.IfStatement ||
    kind === SyntaxKind.ForStatement ||
    kind === SyntaxKind.WhileStatement ||
    kind === SyntaxKind.DoStatement ||
    kind === SyntaxKind.SwitchStatement ||
    kind === SyntaxKind.ThrowStatement ||
    kind === SyntaxKind.TryStatement ||
    kind === SyntaxKind.Block
  );
}
