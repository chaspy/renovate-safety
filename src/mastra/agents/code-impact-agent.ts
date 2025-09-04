import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { tsUsageScannerTool } from '../tools/ts-usage-scanner.js';
import { configScannerTool } from '../tools/config-scanner.js';

// Input/Output schemas for Agent
export const codeImpactInputSchema = z.object({
  packageName: z.string().describe('Package name to analyze'),
  projectPath: z.string().default('.').describe('Path to the project to analyze'),
  breakingChanges: z.array(z.string()).optional().describe('List of breaking changes to check for'),
  filePatterns: z.array(z.string()).optional().describe('Additional file patterns to scan'),
});

export const codeImpactOutputSchema = z.object({
  totalUsages: z.number(),
  criticalUsages: z.array(z.object({
    file: z.string(),
    line: z.number(),
    reason: z.string(),
  })),
  usageByType: z.record(z.number()),
  impactLevel: z.enum(['minimal', 'low', 'medium', 'high']),
  affectedFiles: z.array(z.string()),
  recommendations: z.array(z.string()),
  projectType: z.string().optional(),
  score: z.number(),
});

export type CodeImpactInput = z.infer<typeof codeImpactInputSchema>;
export type CodeImpactOutput = z.infer<typeof codeImpactOutputSchema>;

export const CodeImpactAgent = new Agent({
  name: 'CodeImpactAgent',
  description: 'Analyze code impact of dependency updates',
  
  instructions: `You are an expert at analyzing code dependencies and their usage.
    
    When given packageName, projectPath, optional breakingChanges array, and optional filePatterns:
    1. Use tsUsageScanner to detect project type and scan for TypeScript/JavaScript usage
    2. Use configScanner to scan configuration files for package references
    3. Analyze usage patterns to determine impact level:
       - Count total usages across the codebase
       - Identify critical paths (main entry points, core modules)
       - Categorize usage by type (import, function call, type reference)
       - Assess impact level: minimal/low/medium/high
    
    Focus on identifying:
    - Direct API usage that might break with updates
    - Type definitions that might change
    - Configuration files that reference the package
    - Main entry points and critical application paths
    
    Return structured output with:
    - totalUsages: total count of package usages found
    - criticalUsages: array of {file, line, reason} for high-risk usage locations
    - usageByType: record of usage counts by category
    - impactLevel: overall assessment (minimal/low/medium/high)
    - affectedFiles: list of files that use the package
    - recommendations: actionable advice based on analysis
    - projectType: detected project type (typescript/javascript/python/etc)
    - score: numerical risk score
    
    Always use both tools to gather comprehensive usage information.`,
  
  model: openai('gpt-4o-mini'),
  
  tools: {
    tsUsageScanner: tsUsageScannerTool,
    configScanner: configScannerTool,
  },
});


