import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Project, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs/promises';

// Zod schemas
const usageItemSchema = z.object({
  file: z.string(),
  line: z.number(),
  type: z.enum([
    'import',
    'function-call',
    'property-access',
    'constructor',
    'type-reference',
    'extends',
    'other'
  ]),
  code: z.string().optional(),
  context: z.string().optional(),
  specifiers: z.array(z.string()).optional(),
});

const usageSummarySchema = z.object({
  total: z.number(),
  byType: z.record(z.number()),
  byFile: z.record(z.number()),
  criticalFiles: z.array(z.string()),
});

const inputSchema = z.object({
  packageName: z.string().describe('NPM package name to scan for'),
  projectPath: z.string().default('.').describe('Path to the project to scan'),
  patterns: z.array(z.string()).nullable().optional().describe('Additional patterns to search for'),
}).transform(data => ({
  ...data,
  patterns: data.patterns || []  // Convert null/undefined to empty array
}));

const outputSchema = z.object({
  usages: z.array(usageItemSchema),
  summary: usageSummarySchema,
});

export const tsUsageScannerTool = createTool({
  id: 'ts-usage-scanner',
  description: 'Scan TypeScript/JavaScript code for package usage',
  inputSchema,
  outputSchema,
  execute: async ({ context: { packageName, projectPath, patterns = [] } }) => {
    try {
      // Input validation - removed debug logging
      
      // Check if tsconfig.json exists
      const tsconfigPath = path.join(projectPath, 'tsconfig.json');
      const hasTsConfig = await fs.access(tsconfigPath).then(() => true).catch(() => false);
      
      // TypeScript config detection

      // Create ts-morph project
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

      const sourceFiles = project.getSourceFiles();
      const usages: z.infer<typeof usageItemSchema>[] = [];

      // Source file discovery completed

      for (const sourceFile of sourceFiles) {
        const filePath = sourceFile.getFilePath();
        
        // Skip node_modules
        if (filePath.includes('node_modules')) continue;
        
        // Find imports from the package
        const allImports = sourceFile.getImportDeclarations();
        // Import analysis for file
        
        const imports = allImports.filter(imp => {
            const moduleSpec = imp.getModuleSpecifierValue();
            const matches = moduleSpec === packageName || moduleSpec.startsWith(`${packageName}/`);
            // Package import detected
            return matches;
          });

        for (const imp of imports) {
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
        }
        
        // Find type references matching patterns
        if (patterns.length > 0) {
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
        }
      }

      const summary = summarizeUsages(usages);

      return {
        usages,
        summary,
      };
    } catch (error) {
      throw new Error(`Failed to scan TypeScript usage: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

function determineUsageType(_node: Node, parent: Node | undefined): z.infer<typeof usageItemSchema>['type'] {
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

function summarizeUsages(usages: z.infer<typeof usageItemSchema>[]): z.infer<typeof usageSummarySchema> {
  const byType: Record<string, number> = Object.create(null);
  const byFile: Record<string, number> = Object.create(null);
  
  for (const usage of usages) {
    // Count by type
    byType[usage.type] = (byType[usage.type] || 0) + 1;
    
    // Count by file
    byFile[usage.file] = (byFile[usage.file] || 0) + 1;
  }
  
  // Find critical files (files with more than 5 usages)
  const criticalFiles = Object.entries(byFile)
    .filter(([_, count]) => count > 5)
    .map(([file]) => file);
  
  return {
    total: usages.length,
    byType,
    byFile,
    criticalFiles,
  };
}

// Export for use in other modules
export type TsUsage = z.infer<typeof usageItemSchema>;
export type TsUsageSummary = z.infer<typeof usageSummarySchema>;
export type TsUsageResult = z.infer<typeof outputSchema>;