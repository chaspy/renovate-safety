import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  setupProject,
  processSourceFile,
} from './ts-usage-scanner-helpers.js';

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
      // Setup project
      const { project } = await setupProject(projectPath);
      const sourceFiles = project.getSourceFiles();

      // Process all source files
      const usages: z.infer<typeof usageItemSchema>[] = [];
      for (const sourceFile of sourceFiles) {
        const fileUsages = processSourceFile(sourceFile, packageName, patterns);
        usages.push(...fileUsages);
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

// Helper functions moved to ts-usage-scanner-helpers.ts

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