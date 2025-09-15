import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs/promises';

// Zod schemas
const configUsageSchema = z.object({
  file: z.string(),
  line: z.number(),
  type: z.literal('config'),
  content: z.string(),
});

const inputSchema = z.object({
  packageName: z.string().describe('Package name to search for in config files'),
  projectPath: z.string().default('.').describe('Path to the project to scan'),
});

const outputSchema = z.array(configUsageSchema);

// Helper function to search for package references in content
function searchPackageInContent(
  content: string,
  packageName: string,
  fileName: string
): z.infer<typeof configUsageSchema>[] {
  const usages: z.infer<typeof configUsageSchema>[] = [];

  if (!content.includes(packageName)) {
    return usages;
  }

  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (line.includes(packageName)) {
      usages.push({
        file: fileName,
        line: index + 1,
        type: 'config',
        content: line.trim(),
      });
    }
  });

  return usages;
}

// Helper function to scan a single config file
async function scanConfigFile(
  projectPath: string,
  configFile: string,
  packageName: string
): Promise<z.infer<typeof configUsageSchema>[]> {
  const filePath = path.join(projectPath, configFile);

  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    return searchPackageInContent(content, packageName, configFile);
  } catch (error) {
    // File doesn't exist or can't be read
    return [];
  }
}

// Helper function to scan config files in a directory
async function scanConfigDirectory(
  projectPath: string,
  dir: string,
  packageName: string
): Promise<z.infer<typeof configUsageSchema>[]> {
  const usages: z.infer<typeof configUsageSchema>[] = [];
  const dirPath = path.join(projectPath, dir);

  try {
    await fs.access(dirPath);
    const files = await fs.readdir(dirPath);

    for (const file of files) {
      // Only check JSON, JS, TS, and YAML files
      if (!/\.(json|js|ts|yaml|yml)$/i.test(file)) {
        continue;
      }

      const filePath = path.join(dirPath, file);

      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;

        const content = await fs.readFile(filePath, 'utf-8');
        const fileUsages = searchPackageInContent(
          content,
          packageName,
          path.join(dir, file)
        );
        usages.push(...fileUsages);
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }

  return usages;
}

// Helper function to get list of config files
function getConfigFiles(): string[] {
  return [
    'package.json',
    'tsconfig.json',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc',
    'webpack.config.js',
    'webpack.config.ts',
    'vite.config.js',
    'vite.config.ts',
    'rollup.config.js',
    'rollup.config.ts',
    'jest.config.js',
    'jest.config.ts',
    'vitest.config.js',
    'vitest.config.ts',
    '.babelrc',
    '.babelrc.json',
    'babel.config.js',
    'babel.config.json',
    'prettier.config.js',
    '.prettierrc',
    '.prettierrc.json',
    'tailwind.config.js',
    'tailwind.config.ts',
    'next.config.js',
    'next.config.mjs',
    'nuxt.config.js',
    'nuxt.config.ts',
    'angular.json',
    '.angular-cli.json',
    'vue.config.js',
    'svelte.config.js',
    'astro.config.mjs',
    'remix.config.js',
    'gatsby-config.js',
    'tsup.config.ts',
    'tsup.config.js',
    'esbuild.config.js',
    'turbo.json',
    'nx.json',
    'lerna.json',
    'rush.json',
    'pnpm-workspace.yaml',
    'yarn.lock',
    'package-lock.json',
    'pnpm-lock.yaml',
  ];
}

// Helper function to get list of config directories
function getConfigDirectories(): string[] {
  return [
    '.config',
    'config',
    '.github',
    '.vscode',
    '.idea',
  ];
}

export const configScannerTool = createTool({
  id: 'config-scanner',
  description: 'Scan configuration files for package references',
  inputSchema,
  outputSchema,
  execute: async ({ context: { packageName, projectPath } }) => {
    const usages: z.infer<typeof configUsageSchema>[] = [];

    // Scan standard config files
    const configFiles = getConfigFiles();
    for (const configFile of configFiles) {
      const fileUsages = await scanConfigFile(projectPath, configFile, packageName);
      usages.push(...fileUsages);
    }

    // Scan config directories
    const configDirs = getConfigDirectories();
    for (const dir of configDirs) {
      const dirUsages = await scanConfigDirectory(projectPath, dir, packageName);
      usages.push(...dirUsages);
    }

    return usages;
  },
});

// Export types for use in other modules
export type ConfigUsage = z.infer<typeof configUsageSchema>;
export type ConfigScanResult = z.infer<typeof outputSchema>;