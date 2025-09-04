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

export const configScannerTool = createTool({
  id: 'config-scanner',
  description: 'Scan configuration files for package references',
  inputSchema,
  outputSchema,
  execute: async ({ context: { packageName, projectPath } }) => {
    const configFiles = [
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

    const usages: z.infer<typeof configUsageSchema>[] = [];

    for (const configFile of configFiles) {
      const filePath = path.join(projectPath, configFile);
      
      try {
        // Check if file exists
        await fs.access(filePath);
        
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Search for package references
        if (content.includes(packageName)) {
          const lines = content.split('\n');
          
          lines.forEach((line, index) => {
            if (line.includes(packageName)) {
              usages.push({
                file: configFile,
                line: index + 1,
                type: 'config',
                content: line.trim(),
              });
            }
          });
        }
      } catch (error) {
        // File doesn't exist or can't be read, skip it
        continue;
      }
    }

    // Also check for config files in specific directories
    const configDirs = [
      '.config',
      'config',
      '.github',
      '.vscode',
      '.idea',
    ];

    for (const dir of configDirs) {
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
            
            if (content.includes(packageName)) {
              const lines = content.split('\n');
              
              lines.forEach((line, index) => {
                if (line.includes(packageName)) {
                  usages.push({
                    file: path.join(dir, file),
                    line: index + 1,
                    type: 'config',
                    content: line.trim(),
                  });
                }
              });
            }
          } catch (error) {
            // Skip files that can't be read
            continue;
          }
        }
      } catch (error) {
        // Directory doesn't exist or can't be read
        continue;
      }
    }

    return usages;
  },
});

// Export types for use in other modules
export type ConfigUsage = z.infer<typeof configUsageSchema>;
export type ConfigScanResult = z.infer<typeof outputSchema>;