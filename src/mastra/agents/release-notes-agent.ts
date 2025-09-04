import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { npmDiffTool } from '../tools/npm-diff.js';
import { githubReleasesFetcher } from '../tools/github-releases.js';
import { changelogFetcher } from '../tools/changelog-fetcher.js';

// Input/Output schemas for Agent
export const releaseNotesInputSchema = z.object({
  packageName: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  registry: z.enum(['npm', 'pypi']).default('npm'),
  repoUrl: z.string().optional(),
});

export const releaseNotesOutputSchema = z.object({
  breakingChanges: z.array(z.object({
    text: z.string(),
    severity: z.enum(['breaking', 'warning', 'removal']),
    source: z.string().optional(),
  })),
  migrationSteps: z.array(z.string()),
  riskLevel: z.enum(['safe', 'low', 'medium', 'high']),
  summary: z.string(),
  sources: z.array(z.object({
    type: z.string(),
    url: z.string().optional(),
    status: z.enum(['success', 'failed']),
  })),
});

export type ReleaseNotesInput = z.infer<typeof releaseNotesInputSchema>;
export type ReleaseNotesOutput = z.infer<typeof releaseNotesOutputSchema>;

export const ReleaseNotesAgent = new Agent({
  name: 'ReleaseNotesAgent',
  instructions: `You are an expert at analyzing software release notes and changelogs.
    
    When given packageName, fromVersion, toVersion, registry, and optional repoUrl:
    1. Use npmDiffTool (for npm packages) to get package differences
    2. Use githubReleasesFetcher (if repoUrl provided) to get GitHub release notes
    3. Use changelogFetcher to get official changelogs from registry
    4. Analyze ALL gathered information to identify:
       - Breaking changes, deprecations, and removals
       - Migration steps if provided
       - Risk level based on severity of changes
    
    For each source, collect and analyze:
    - Breaking changes with severity (breaking/warning/removal)
    - Migration steps from documentation
    - Source success/failure status
    
    Combine and deduplicate information from all sources:
    - Merge similar breaking changes from multiple sources
    - Prioritize explicit breaking change markers
    - Consider semantic versioning indicators
    - Special consideration for @types/* packages (lower risk)
    
    Return structured output with:
    - breakingChanges: array of {text, severity, source}
    - migrationSteps: array of strings
    - riskLevel: safe/low/medium/high
    - summary: comprehensive summary of changes
    - sources: array of {type, url?, status}
    
    Always attempt to use all available tools to gather comprehensive information.`,
    
  model: openai('gpt-4o-mini'),
  
  tools: { 
    npmDiffTool, 
    githubReleasesFetcher, 
    changelogFetcher 
  },
});


