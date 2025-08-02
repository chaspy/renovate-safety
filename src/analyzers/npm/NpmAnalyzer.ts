import { PackageAnalyzer, PackageMetadata, UsageAnalysis, UsageLocation, AdditionalContext } from '../base.js';
import type { PackageUpdate, ChangelogDiff } from '../../types/index.js';
import { access } from 'fs/promises';
import { join } from 'path';
import { Project, SyntaxKind, Node } from 'ts-morph';
import { getFileContext, categorizeUsages, isPackageImport } from '../utils.js';
import { getPackageMetadata, getPackageReadme, getNpmDiff, getPackageDownloads } from '../../lib/npm-registry.js';
import { validatePackageName } from '../../lib/validation.js';
import { findSourceFiles, searchInGenericConfigs } from '../file-utils.js';
import { loggers } from '../../lib/logger.js';

export class NpmAnalyzer extends PackageAnalyzer {
  async canHandle(_packageName: string, projectPath: string): Promise<boolean> {
    try {
      // Check for package.json
      await access(join(projectPath, 'package.json'));
      return true;
    } catch {
      return false;
    }
  }

  async fetchMetadata(pkg: PackageUpdate): Promise<PackageMetadata | null> {
    try {
      // Use centralized npm registry utility
      const data = await getPackageMetadata(`${pkg.name}@${pkg.toVersion}`);
      
      if (!data) {
        return null;
      }
      
      return {
        name: data.name,
        version: data.version,
        description: data.description,
        homepage: data.homepage,
        repository: typeof data.repository === 'object' ? data.repository.url : data.repository,
        license: data.license,
        publishedAt: data.time?.[pkg.toVersion] ? new Date(data.time[pkg.toVersion]) : undefined,
        deprecated: data.deprecated !== undefined,
        deprecationMessage: typeof data.deprecated === 'string' ? data.deprecated : undefined
      };
    } catch (error) {
      loggers.fetchFailed('metadata', pkg.name, error);
      return null;
    }
  }

  async fetchChangelog(pkg: PackageUpdate, cacheDir?: string): Promise<ChangelogDiff | null> {
    // First try npm registry
    try {
      const safeName = validatePackageName(pkg.name);
      const fromContent = await this.fetchVersionReadme(safeName, pkg.fromVersion);
      const toContent = await this.fetchVersionReadme(safeName, pkg.toVersion);
      
      if (fromContent || toContent) {
        return {
          content: this.generateChangelogDiff(fromContent || '', toContent || '', pkg),
          source: 'npm',
          fromVersion: pkg.fromVersion,
          toVersion: pkg.toVersion
        };
      }
    } catch (error) {
      loggers.genericFailed('fetch from npm registry', error);
    }

    // Fallback to existing implementation
    const { fetchChangelogDiff } = await import('../../lib/changelog.js');
    return fetchChangelogDiff(pkg, cacheDir || '.');
  }

  async analyzeUsage(packageName: string, projectPath: string): Promise<UsageAnalysis> {
    const project = new Project();
    const locations: UsageLocation[] = [];
    
    // Add source files
    const sourceFiles = await findSourceFiles(projectPath, 'javascript');

    for (const file of sourceFiles) {
      const sourceFile = project.addSourceFileAtPath(join(projectPath, file));
      
      // Analyze imports
      sourceFile.getImportDeclarations().forEach(importDecl => {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        if (isPackageImport(moduleSpecifier, packageName)) {
          const line = importDecl.getStartLineNumber();
          const column = importDecl.getStartLinePos();
          
          locations.push({
            file,
            line,
            column,
            type: 'import',
            code: importDecl.getText(),
            context: getFileContext(file)
          });

          // Check for specific imported symbols
          importDecl.getNamedImports().forEach(namedImport => {
            const identifier = namedImport.getName();
            this.findIdentifierUsages(sourceFile, identifier, file, locations);
          });

          // Check default import
          const defaultImport = importDecl.getDefaultImport();
          if (defaultImport) {
            this.findIdentifierUsages(sourceFile, defaultImport.getText(), file, locations);
          }
        }
      });

      // Analyze require calls
      sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(callExpr => {
        const expression = callExpr.getExpression();
        if (Node.isIdentifier(expression) && expression.getText() === 'require') {
          const args = callExpr.getArguments();
          if (args.length > 0 && Node.isStringLiteral(args[0])) {
            const moduleSpecifier = args[0].getLiteralValue();
            if (isPackageImport(moduleSpecifier, packageName)) {
              locations.push({
                file,
                line: callExpr.getStartLineNumber(),
                column: callExpr.getStartLinePos(),
                type: 'require',
                code: callExpr.getText(),
                context: getFileContext(file)
              });
            }
          }
        }
      });
    }

    // Analyze config files
    const configLocations = await searchInGenericConfigs(packageName, projectPath);
    locations.push(...configLocations);

    // Use common categorization logic
    const categorization = categorizeUsages(locations);
    
    return {
      locations,
      ...categorization
    };
  }

  async getAdditionalContext(pkg: PackageUpdate): Promise<AdditionalContext> {
    const context: AdditionalContext = {};

    try {
      // Check if it's a type definition package
      if (pkg.name.startsWith('@types/')) {
        context.isTypeDefinition = true;
        context.runtimePackage = pkg.name.substring(7);
      }

      // Check npm diff if available
      const npmDiff = await getNpmDiff(
        `${pkg.name}@${pkg.fromVersion}`,
        `${pkg.name}@${pkg.toVersion}`
      );
      
      if (npmDiff) {
        context.npmDiff = npmDiff;
        context.hasNpmDiff = true;
      } else {
        context.hasNpmDiff = false;
      }

      // Get download stats
      const downloads = await getPackageDownloads(pkg.name);
      if (downloads !== null) {
        context.weeklyDownloads = downloads;
      }

    } catch (error) {
      loggers.genericFailed('get additional context', error);
    }

    return context;
  }

  getFileExtensions(): string[] {
    return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
  }

  getImportPatterns(): RegExp[] {
    return [
      /import\s+[^]+?\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(['"]([^'"]+)['"]\)/g,
      /require\s*\(['"]([^'"]+)['"]\)/g,
      /require\.resolve\s*\(['"]([^'"]+)['"]\)/g
    ];
  }

  private async fetchVersionReadme(packageName: string, version: string): Promise<string | null> {
    return getPackageReadme(`${packageName}@${version}`);
  }

  private generateChangelogDiff(fromContent: string, toContent: string, pkg: PackageUpdate): string {
    return `# Changelog for ${pkg.name}: ${pkg.fromVersion} → ${pkg.toVersion}\n\n` +
           `## Previous Version (${pkg.fromVersion})\n${fromContent}\n\n` +
           `## New Version (${pkg.toVersion})\n${toContent}`;
  }

  // Remove duplicate method - using shared utility instead
  // isPackageImport is now imported from utils.ts

  // Remove duplicate method - using shared utility getFileContext from utils.ts

  private findIdentifierUsages(
    sourceFile: any,
    identifier: string,
    filePath: string,
    locations: UsageLocation[]
  ): void {
    sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach((node: any) => {
      if (node.getText() === identifier) {
        const parent = node.getParent();
        
        // Function call
        if (Node.isCallExpression(parent) && parent.getExpression() === node) {
          locations.push({
            file: filePath,
            line: node.getStartLineNumber(),
            column: node.getStartLinePos(),
            type: 'function-call',
            code: parent.getText(),
            context: getFileContext(filePath)
          });
        }
        
        // Property access
        else if (Node.isPropertyAccessExpression(parent)) {
          locations.push({
            file: filePath,
            line: node.getStartLineNumber(),
            column: node.getStartLinePos(),
            type: 'property-access',
            code: parent.getText(),
            context: getFileContext(filePath)
          });
        }
        
        // Type reference
        else if (Node.isTypeReference(parent) || Node.isTypeReference(parent?.getParent())) {
          locations.push({
            file: filePath,
            line: node.getStartLineNumber(),
            column: node.getStartLinePos(),
            type: 'type-reference',
            code: node.getText(),
            context: getFileContext(filePath)
          });
        }
      }
    });
  }

  // Remove duplicate method - critical paths are now identified in categorizeUsages
}