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
  instructions: `You are an expert at analyzing software release notes and changelogs with particular focus on detecting breaking changes.
    
    When given packageName, fromVersion, toVersion, registry, and optional repoUrl:
    1. Use npmDiffTool (for npm packages) to get package differences - PAY SPECIAL ATTENTION to the 'breakingChanges' field
    2. Use githubReleasesFetcher (if repoUrl provided) to get GitHub release notes
    3. Use changelogFetcher to get official changelogs from registry
    4. Analyze ALL gathered information to identify:
       - Breaking changes, deprecations, and removals
       - Migration steps if provided
       - Risk level based on severity of changes
    
    CRITICAL: The npmDiffTool returns a 'breakingChanges' array field containing automatically detected breaking changes:
    - Node.js requirement changes (e.g., "Node.js requirement raised from >=18 to >=20") are CRITICAL breaking changes
    - Export structure changes indicate API breaking changes
    - Function removals/renames are breaking changes
    - API method additions in TypeScript definitions may indicate breaking changes
    - Major version bumps are strong indicators of breaking changes
    
    ALWAYS check tool results for 'breakingChanges' fields and include them in your analysis.
    
    For each source, collect and analyze:
    - Breaking changes with severity (breaking/warning/removal)
    - Migration steps from documentation
    - Source success/failure status
    
    Combine and deduplicate information from all sources:
    - Merge similar breaking changes from multiple sources
    - Prioritize explicit breaking change markers from tools
    - ALWAYS include breaking changes detected by npmDiffTool
    - Consider semantic versioning indicators
    - Special consideration for @types/* packages (lower risk)
    
    You MUST return structured JSON output that matches this exact schema:
    {
      "breakingChanges": [{"text": "string", "severity": "critical|breaking|warning|removal", "source": "string"}],
      "migrationSteps": ["string"],
      "riskLevel": "safe|low|medium|high",
      "summary": "string",
      "sources": [{"type": "string", "url": "string", "status": "success|failed"}]
    }
    
    If major Node.js requirement changes or multiple breaking changes exist, use 'high' risk level.
    If npmDiffTool finds breaking changes but other sources don't provide details, prioritize the tool findings and clearly state what was detected.
    
    Always attempt to use all available tools to gather comprehensive information.`,
    
  model: openai('gpt-4o-mini'),
  
  tools: { 
    npmDiffTool, 
    githubReleasesFetcher, 
    changelogFetcher 
  }
});


