import { PackageAnalyzer, PackageMetadata, UsageAnalysis, UsageLocation } from '../base.js';
import type { PackageUpdate, ChangelogDiff } from '../../types/index.js';
import { execa } from 'execa';
import { readFile, access } from 'fs/promises';
import { join, relative } from 'path';
import { glob } from 'glob';

export class PyPiAnalyzer extends PackageAnalyzer {
  async canHandle(packageName: string, projectPath: string): Promise<boolean> {
    try {
      // Check for Python project files
      const checks = await Promise.all([
        access(join(projectPath, 'requirements.txt')).then(() => true).catch(() => false),
        access(join(projectPath, 'setup.py')).then(() => true).catch(() => false),
        access(join(projectPath, 'pyproject.toml')).then(() => true).catch(() => false),
        access(join(projectPath, 'Pipfile')).then(() => true).catch(() => false),
      ]);
      
      return checks.some(exists => exists);
    } catch {
      return false;
    }
  }

  async fetchMetadata(pkg: PackageUpdate): Promise<PackageMetadata | null> {
    try {
      // Use dynamic import for node-fetch
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(`https://pypi.org/pypi/${pkg.name}/${pkg.toVersion}/json`);
      if (!response.ok) {
        throw new Error(`PyPI API returned ${response.status}`);
      }
      
      const data = await response.json() as any;
      const info = data.info;
      
      return {
        name: info.name,
        version: info.version,
        description: info.summary,
        homepage: info.home_page || info.project_url,
        repository: info.project_urls?.Source || info.project_urls?.Repository,
        license: info.license,
        publishedAt: data.releases[pkg.toVersion]?.[0]?.upload_time 
          ? new Date(data.releases[pkg.toVersion][0].upload_time) 
          : undefined,
        deprecated: info.yanked || false,
        deprecationMessage: info.yanked_reason
      };
    } catch (error) {
      console.warn(`Failed to fetch PyPI metadata for ${pkg.name}:`, error);
      return null;
    }
  }

  async fetchChangelog(pkg: PackageUpdate, cacheDir?: string): Promise<ChangelogDiff | null> {
    try {
      // Try to get changelog from PyPI description
      const [fromData, toData] = await Promise.all([
        this.fetchPyPiData(pkg.name, pkg.fromVersion),
        this.fetchPyPiData(pkg.name, pkg.toVersion)
      ]);

      if (fromData || toData) {
        const content = this.extractChangelogContent(fromData, toData, pkg);
        if (content) {
          return {
            content,
            source: 'PyPI',
            fromVersion: pkg.fromVersion,
            toVersion: pkg.toVersion
          };
        }
      }
    } catch (error) {
      console.warn('Failed to fetch PyPI changelog:', error);
    }

    // Fallback to GitHub
    const { fetchChangelogDiff } = await import('../../lib/changelog.js');
    return fetchChangelogDiff(pkg, cacheDir);
  }

  async analyzeUsage(packageName: string, projectPath: string): Promise<UsageAnalysis> {
    const locations: UsageLocation[] = [];
    
    // Find Python files
    const pythonFiles = await glob('**/*.py', {
      cwd: projectPath,
      ignore: ['**/venv/**', '**/__pycache__/**', '**/site-packages/**', '**/.tox/**']
    });

    for (const file of pythonFiles) {
      const content = await readFile(join(projectPath, file), 'utf-8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        // Check various import patterns
        const importPatterns = [
          new RegExp(`^import\\s+${packageName}(?:\\s|$|\\.)`, 'i'),
          new RegExp(`^from\\s+${packageName}(?:\\s|\\.)`, 'i'),
          new RegExp(`^import\\s+.*?\\s*,\\s*${packageName}(?:\\s|$|,)`, 'i'),
          new RegExp(`\\s+as\\s+\\w+\\s*,\\s*${packageName}(?:\\s|$|,)`, 'i')
        ];

        for (const pattern of importPatterns) {
          if (pattern.test(line.trim())) {
            locations.push({
              file,
              line: index + 1,
              column: 0,
              type: 'import',
              code: line.trim(),
              context: this.getFileContext(file)
            });
            break;
          }
        }

        // Check for function calls and attribute access
        const usagePattern = new RegExp(`\\b${packageName}\\.[\\w.]+\\(`, 'g');
        if (usagePattern.test(line)) {
          locations.push({
            file,
            line: index + 1,
            column: line.indexOf(packageName),
            type: 'function-call',
            code: line.trim(),
            context: this.getFileContext(file)
          });
        }

        // Check for dynamic imports
        if (line.includes('importlib.import_module') && line.includes(packageName)) {
          locations.push({
            file,
            line: index + 1,
            column: 0,
            type: 'require',
            code: line.trim(),
            context: this.getFileContext(file)
          });
        }
      });
    }

    // Check configuration files
    const configPatterns = [
      { pattern: 'requirements*.txt', type: 'requirements' },
      { pattern: 'setup.py', type: 'setup' },
      { pattern: 'pyproject.toml', type: 'pyproject' },
      { pattern: 'Pipfile', type: 'pipfile' },
      { pattern: 'tox.ini', type: 'tox' },
      { pattern: '.pre-commit-config.yaml', type: 'precommit' }
    ];

    for (const { pattern, type } of configPatterns) {
      const configFiles = await glob(pattern, { cwd: projectPath });
      for (const file of configFiles) {
        const content = await readFile(join(projectPath, file), 'utf-8');
        if (content.includes(packageName)) {
          locations.push({
            file,
            line: 1,
            column: 0,
            type: 'config',
            code: `${packageName} reference in ${type} file`,
            context: 'config'
          });
        }
      }
    }

    // Calculate metrics
    const productionUsageCount = locations.filter(l => l.context === 'production').length;
    const testUsageCount = locations.filter(l => l.context === 'test').length;
    const configUsageCount = locations.filter(l => l.context === 'config').length;
    
    const criticalPaths = this.identifyCriticalPaths(locations, projectPath);
    const hasDynamicImports = locations.some(l => 
      l.code.includes('importlib.import_module') || 
      l.code.includes('__import__')
    );

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

  async getAdditionalContext(pkg: PackageUpdate): Promise<Record<string, any>> {
    const context: Record<string, any> = {};

    try {
      // Check if it's a stub package
      if (pkg.name.endsWith('-stubs') || pkg.name.startsWith('types-')) {
        context.isTypeStub = true;
        context.runtimePackage = pkg.name.replace(/-stubs$/, '').replace(/^types-/, '');
      }

      // Get Python version requirements
      const data = await this.fetchPyPiData(pkg.name, pkg.toVersion);
      if (data?.info?.requires_python) {
        context.pythonVersionRequirement = data.info.requires_python;
      }

      // Check for deprecation or replacement
      if (data?.info?.obsoletes_dist) {
        context.obsoletes = data.info.obsoletes_dist;
      }

      // Get classifiers (useful for understanding package purpose)
      if (data?.info?.classifiers) {
        context.classifiers = data.info.classifiers;
        context.isAlpha = data.info.classifiers.some((c: string) => 
          c.includes('Alpha') || c.includes('Development Status :: 3')
        );
        context.isBeta = data.info.classifiers.some((c: string) => 
          c.includes('Beta') || c.includes('Development Status :: 4')
        );
      }

    } catch (error) {
      console.warn('Failed to get additional Python context:', error);
    }

    return context;
  }

  getFileExtensions(): string[] {
    return ['.py', '.pyi'];
  }

  getImportPatterns(): RegExp[] {
    return [
      /^import\s+(\S+)/gm,
      /^from\s+(\S+)\s+import/gm,
      /importlib\.import_module\(['"]([^'"]+)['"]\)/g,
      /__import__\(['"]([^'"]+)['"]\)/g
    ];
  }

  private async fetchPyPiData(packageName: string, version: string): Promise<any> {
    try {
      // Use dynamic import for node-fetch
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(`https://pypi.org/pypi/${packageName}/${version}/json`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  private extractChangelogContent(fromData: any, toData: any, pkg: PackageUpdate): string | null {
    const toDescription = toData?.info?.description || '';
    const fromDescription = fromData?.info?.description || '';

    // Look for changelog section in description
    const changelogSection = this.extractChangelogSection(toDescription);
    if (changelogSection) {
      return `# Changelog for ${pkg.name}: ${pkg.fromVersion} → ${pkg.toVersion}\n\n${changelogSection}`;
    }

    // If descriptions are different, show the diff
    if (toDescription && toDescription !== fromDescription) {
      return `# Description changes for ${pkg.name}: ${pkg.fromVersion} → ${pkg.toVersion}\n\n` +
             `## Previous (${pkg.fromVersion})\n${fromDescription}\n\n` +
             `## Current (${pkg.toVersion})\n${toDescription}`;
    }

    return null;
  }

  private extractChangelogSection(description: string): string | null {
    // Common changelog headers
    const changelogHeaders = [
      /^#+\s*changelog/im,
      /^#+\s*changes/im,
      /^#+\s*release\s+notes/im,
      /^#+\s*what'?s?\s+new/im
    ];

    for (const header of changelogHeaders) {
      const match = description.match(header);
      if (match) {
        const startIndex = match.index!;
        // Extract until next major header or end
        const endMatch = description.substring(startIndex + match[0].length).match(/^#{1,2}\s+/m);
        const endIndex = endMatch ? startIndex + match[0].length + endMatch.index! : description.length;
        
        return description.substring(startIndex, endIndex).trim();
      }
    }

    return null;
  }

  private getFileContext(filePath: string): 'production' | 'test' | 'config' | 'build' {
    const lowerPath = filePath.toLowerCase();
    
    if (lowerPath.includes('test') || lowerPath.includes('tests') || 
        lowerPath.includes('test_') || lowerPath.endsWith('_test.py') ||
        lowerPath.includes('conftest.py')) {
      return 'test';
    }
    
    if (lowerPath.includes('setup.py') || lowerPath.includes('setup.cfg') ||
        lowerPath.includes('pyproject.toml') || lowerPath.includes('tox.ini')) {
      return 'build';
    }
    
    if (lowerPath.endsWith('.cfg') || lowerPath.endsWith('.ini') || 
        lowerPath.endsWith('.toml') || lowerPath.endsWith('.yaml') ||
        lowerPath.endsWith('.yml')) {
      return 'config';
    }
    
    return 'production';
  }

  private identifyCriticalPaths(locations: UsageLocation[], projectPath: string): string[] {
    const criticalPaths: Set<string> = new Set();
    
    // Common Python entry points
    const entryPoints = ['__main__', '__init__', 'main', 'app', 'wsgi', 'asgi', 'cli', 'manage'];
    
    locations.forEach(location => {
      const relativePath = relative(projectPath, location.file);
      const fileName = relativePath.split('/').pop()?.split('.')[0] || '';
      
      // Check if it's an entry point
      if (entryPoints.some(entry => fileName.includes(entry))) {
        criticalPaths.add(relativePath);
      }
      
      // Check if it's in package root
      if (relativePath.split('/').length <= 2 && location.context === 'production') {
        criticalPaths.add(relativePath);
      }
      
      // Check for Django/Flask specific patterns
      if (fileName.includes('urls') || fileName.includes('views') || 
          fileName.includes('models') || fileName.includes('settings')) {
        criticalPaths.add(relativePath);
      }
    });
    
    return Array.from(criticalPaths);
  }
}