import { PackageAnalyzer, PackageMetadata, UsageAnalysis, UsageLocation, AdditionalContext } from '../base.js';
import type { PackageUpdate, ChangelogDiff } from '../../types/index.js';
import { execa } from 'execa';
import { readFile, access } from 'fs/promises';
import { resolve, join, relative } from 'path';
import { glob } from 'glob';
import { Project, SyntaxKind, Node } from 'ts-morph';

export class NpmAnalyzer extends PackageAnalyzer {
  async canHandle(packageName: string, projectPath: string): Promise<boolean> {
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
      const { stdout } = await execa('npm', ['view', `${pkg.name}@${pkg.toVersion}`, '--json']);
      const data = JSON.parse(stdout);
      
      return {
        name: data.name,
        version: data.version,
        description: data.description,
        homepage: data.homepage,
        repository: typeof data.repository === 'object' ? data.repository.url : data.repository,
        license: data.license,
        publishedAt: data.time?.[pkg.toVersion] ? new Date(data.time[pkg.toVersion]) : undefined,
        deprecated: data.deprecated !== undefined,
        deprecationMessage: data.deprecated
      };
    } catch (error) {
      console.warn(`Failed to fetch metadata for ${pkg.name}:`, error);
      return null;
    }
  }

  async fetchChangelog(pkg: PackageUpdate, cacheDir?: string): Promise<ChangelogDiff | null> {
    // First try npm registry
    try {
      const fromContent = await this.fetchVersionReadme(pkg.name, pkg.fromVersion);
      const toContent = await this.fetchVersionReadme(pkg.name, pkg.toVersion);
      
      if (fromContent || toContent) {
        return {
          content: this.generateChangelogDiff(fromContent || '', toContent || '', pkg),
          source: 'npm registry',
          fromVersion: pkg.fromVersion,
          toVersion: pkg.toVersion
        };
      }
    } catch (error) {
      console.warn('Failed to fetch from npm registry:', error);
    }

    // Fallback to existing implementation
    const { fetchChangelogDiff } = await import('../../lib/changelog.js');
    return fetchChangelogDiff(pkg, cacheDir);
  }

  async analyzeUsage(packageName: string, projectPath: string): Promise<UsageAnalysis> {
    const project = new Project();
    const locations: UsageLocation[] = [];
    
    // Add source files
    const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs}', {
      cwd: projectPath,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**']
    });

    for (const file of sourceFiles) {
      const sourceFile = project.addSourceFileAtPath(join(projectPath, file));
      
      // Analyze imports
      sourceFile.getImportDeclarations().forEach(importDecl => {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        if (this.isPackageImport(moduleSpecifier, packageName)) {
          const line = importDecl.getStartLineNumber();
          const column = importDecl.getStartLinePos();
          
          locations.push({
            file,
            line,
            column,
            type: 'import',
            code: importDecl.getText(),
            context: this.getFileContext(file)
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
            if (this.isPackageImport(moduleSpecifier, packageName)) {
              locations.push({
                file,
                line: callExpr.getStartLineNumber(),
                column: callExpr.getStartLinePos(),
                type: 'require',
                code: callExpr.getText(),
                context: this.getFileContext(file)
              });
            }
          }
        }
      });
    }

    // Analyze config files
    const configFiles = await glob('**/*.{json,yaml,yml,toml}', {
      cwd: projectPath,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
    });

    for (const file of configFiles) {
      const content = await readFile(join(projectPath, file), 'utf-8');
      if (content.includes(packageName)) {
        // Simple check for now - could be enhanced with proper parsing
        locations.push({
          file,
          line: 1,
          column: 0,
          type: 'config',
          code: `Reference to ${packageName} in config`,
          context: 'config'
        });
      }
    }

    // Calculate metrics
    const productionUsageCount = locations.filter(l => l.context === 'production').length;
    const testUsageCount = locations.filter(l => l.context === 'test').length;
    const configUsageCount = locations.filter(l => l.context === 'config').length;
    
    // Identify critical paths (main entry points, core modules)
    const criticalPaths = this.identifyCriticalPaths(locations, projectPath);
    
    // Check for dynamic imports
    const hasDynamicImports = locations.some(l => l.code.includes('import(') || l.code.includes('require.resolve'));

    return {
      locations,
      totalUsageCount: locations.length,
      productionUsageCount,
      testUsageCount,
      configUsageCount,
      criticalPaths,
      hasDynamicImports
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
      try {
        const { stdout } = await execa('npm', ['diff', `${pkg.name}@${pkg.fromVersion}`, `${pkg.name}@${pkg.toVersion}`]);
        context.npmDiff = stdout;
        context.hasNpmDiff = true;
      } catch {
        context.hasNpmDiff = false;
      }

      // Get download stats
      try {
        const { stdout } = await execa('npm', ['view', pkg.name, 'downloads', '--json']);
        context.weeklyDownloads = JSON.parse(stdout);
      } catch {
        // Ignore
      }

    } catch (error) {
      console.warn('Failed to get additional context:', error);
    }

    return context;
  }

  getFileExtensions(): string[] {
    return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
  }

  getImportPatterns(): RegExp[] {
    return [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(['"]([^'"]+)['"]\)/g,
      /require\s*\(['"]([^'"]+)['"]\)/g,
      /require\.resolve\s*\(['"]([^'"]+)['"]\)/g
    ];
  }

  private async fetchVersionReadme(packageName: string, version: string): Promise<string | null> {
    try {
      const { stdout } = await execa('npm', ['view', `${packageName}@${version}`, 'readme']);
      return stdout;
    } catch {
      return null;
    }
  }

  private generateChangelogDiff(fromContent: string, toContent: string, pkg: PackageUpdate): string {
    return `# Changelog for ${pkg.name}: ${pkg.fromVersion} → ${pkg.toVersion}\n\n` +
           `## Previous Version (${pkg.fromVersion})\n${fromContent}\n\n` +
           `## New Version (${pkg.toVersion})\n${toContent}`;
  }

  private isPackageImport(moduleSpecifier: string, packageName: string): boolean {
    // Direct match
    if (moduleSpecifier === packageName) return true;
    
    // Scoped package or submodule
    if (moduleSpecifier.startsWith(`${packageName}/`)) return true;
    
    // For scoped packages like @types/node
    if (packageName.includes('/') && moduleSpecifier === packageName) return true;
    
    return false;
  }

  private getFileContext(filePath: string): 'production' | 'test' | 'config' | 'build' {
    const lowerPath = filePath.toLowerCase();
    
    if (lowerPath.includes('test') || lowerPath.includes('spec') || 
        lowerPath.includes('__tests__') || lowerPath.includes('__mocks__')) {
      return 'test';
    }
    
    if (lowerPath.endsWith('.config.js') || lowerPath.endsWith('.config.ts') ||
        lowerPath.includes('webpack') || lowerPath.includes('rollup') ||
        lowerPath.includes('vite') || lowerPath.includes('babel')) {
      return 'build';
    }
    
    if (lowerPath.endsWith('.json') || lowerPath.endsWith('.yaml') || 
        lowerPath.endsWith('.yml') || lowerPath.endsWith('.toml')) {
      return 'config';
    }
    
    return 'production';
  }

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
            context: this.getFileContext(filePath)
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
            context: this.getFileContext(filePath)
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
            context: this.getFileContext(filePath)
          });
        }
      }
    });
  }

  private identifyCriticalPaths(locations: UsageLocation[], projectPath: string): string[] {
    const criticalPaths: Set<string> = new Set();
    
    // Common entry points
    const entryPoints = ['index', 'main', 'app', 'server', 'cli'];
    
    locations.forEach(location => {
      const relativePath = relative(projectPath, location.file);
      const fileName = relativePath.split('/').pop()?.split('.')[0] || '';
      
      // Check if it's an entry point
      if (entryPoints.some(entry => fileName.includes(entry))) {
        criticalPaths.add(relativePath);
      }
      
      // Check if it's in src root
      if (relativePath.split('/').length <= 2 && location.context === 'production') {
        criticalPaths.add(relativePath);
      }
    });
    
    return Array.from(criticalPaths);
  }
}