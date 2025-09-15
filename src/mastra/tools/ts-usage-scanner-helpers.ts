// Helper functions for ts-usage-scanner to reduce complexity
import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs/promises';
import { z } from 'zod';

const usageItemSchema = z.object({
  file: z.string(),
  line: z.number(),
  type: z.enum(['import', 'function-call', 'property-access', 'constructor', 'extends', 'type-reference', 'other']),
  specifiers: z.array(z.string()).optional(),
  code: z.string().optional(),
  context: z.string().optional(),
});

export type UsageItem = z.infer<typeof usageItemSchema>;

export async function setupProject(projectPath: string): Promise<{ project: Project, hasTsConfig: boolean }> {
  const tsconfigPath = path.join(projectPath, 'tsconfig.json');
  const hasTsConfig = await fs.access(tsconfigPath).then(() => true).catch(() => false);

  const project = new Project({
    tsConfigFilePath: hasTsConfig ? tsconfigPath : undefined,
    skipAddingFilesFromTsConfig: !hasTsConfig,
    compilerOptions: hasTsConfig ? undefined : {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      moduleResolution: 2, // NodeJs
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  });

  // If no tsconfig, manually add source files
  if (!hasTsConfig) {
    const patterns = [
      `${projectPath}/src/**/*.{ts,tsx,js,jsx}`,
      `${projectPath}/lib/**/*.{ts,tsx,js,jsx}`,
      `${projectPath}/*.{ts,tsx,js,jsx}`,
    ];

    for (const pattern of patterns) {
      try {
        await project.addSourceFilesAtPaths(pattern);
      } catch (error) {
        // Pattern might not match any files
        continue;
      }
    }
  }

  return { project, hasTsConfig };
}

export function processImport(
  imp: any,
  filePath: string,
  packageName: string,
  sourceFile: SourceFile
): UsageItem[] {
  const usages: UsageItem[] = [];
  const namedImports = imp.getNamedImports();
  const defaultImport = imp.getDefaultImport();
  const namespaceImport = imp.getNamespaceImport();

  // Track what's imported
  const specifiers: string[] = [];

  for (const named of namedImports) {
    specifiers.push(named.getName());
  }

  if (defaultImport) {
    specifiers.push('default');
  }

  if (namespaceImport) {
    specifiers.push(`* as ${namespaceImport.getText()}`);
  }

  // Record the import
  usages.push({
    file: filePath,
    line: imp.getStartLineNumber(),
    type: 'import',
    specifiers: specifiers.length > 0 ? specifiers : undefined,
    code: imp.getText(),
  });

  // Find usage of imported items
  for (const specifier of specifiers) {
    const identifier = specifier.replace('* as ', '').replace('default', defaultImport?.getText() || '');
    if (!identifier) continue;

    const references = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
      .filter(id => id.getText() === identifier);

    for (const ref of references) {
      // Skip the import declaration itself
      if (ref.getParent() === imp || ref.getAncestors().includes(imp)) {
        continue;
      }

      const parent = ref.getParent();
      const usageType = determineUsageType(ref, parent);

      usages.push({
        file: filePath,
        line: ref.getStartLineNumber(),
        type: usageType,
        code: parent?.getText()?.substring(0, 100),
        context: getContext(ref, 2),
      });
    }
  }

  return usages;
}

export function processTypeReferences(
  sourceFile: SourceFile,
  filePath: string,
  patterns: string[]
): UsageItem[] {
  if (patterns.length === 0) return [];

  const usages: UsageItem[] = [];
  const typeRefs = sourceFile.getDescendantsOfKind(SyntaxKind.TypeReference);

  for (const typeRef of typeRefs) {
    const typeName = typeRef.getTypeName().getText();
    if (patterns.some(p => typeName.includes(p))) {
      usages.push({
        file: filePath,
        line: typeRef.getStartLineNumber(),
        type: 'type-reference',
        code: typeRef.getText(),
        context: getContext(typeRef, 2),
      });
    }
  }

  return usages;
}

export function processSourceFile(
  sourceFile: SourceFile,
  packageName: string,
  patterns: string[]
): UsageItem[] {
  const filePath = sourceFile.getFilePath();

  // Skip node_modules
  if (filePath.includes('node_modules')) {
    return [];
  }

  const usages: UsageItem[] = [];

  // Find imports from the package
  const allImports = sourceFile.getImportDeclarations();
  const imports = allImports.filter(imp => {
    const moduleSpec = imp.getModuleSpecifierValue();
    return moduleSpec === packageName || moduleSpec.startsWith(`${packageName}/`);
  });

  // Process each import
  for (const imp of imports) {
    const importUsages = processImport(imp, filePath, packageName, sourceFile);
    usages.push(...importUsages);
  }

  // Process type references
  const typeUsages = processTypeReferences(sourceFile, filePath, patterns);
  usages.push(...typeUsages);

  return usages;
}

function determineUsageType(_node: Node, parent: Node | undefined): UsageItem['type'] {
  if (!parent) return 'other';

  if (Node.isCallExpression(parent)) {
    return 'function-call';
  }

  if (Node.isPropertyAccessExpression(parent)) {
    return 'property-access';
  }

  if (Node.isNewExpression(parent)) {
    return 'constructor';
  }

  if (Node.isHeritageClause(parent)) {
    return 'extends';
  }

  if (Node.isTypeReference(parent)) {
    return 'type-reference';
  }

  return 'other';
}

function getContext(node: Node, lines: number): string {
  const sourceFile = node.getSourceFile();
  const startLine = Math.max(1, node.getStartLineNumber() - lines);
  const endLine = node.getEndLineNumber() + lines;

  const fullText = sourceFile.getFullText();
  const textLines = fullText.split('\n');

  return textLines
    .slice(startLine - 1, endLine)
    .join('\n');
}