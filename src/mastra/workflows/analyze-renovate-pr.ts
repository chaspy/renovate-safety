import { z } from 'zod';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { 
  // TODO: #28でAgent.generate()実装時に再度有効化
  // getPRInfoTool,
  // dependencyReviewTool,
  // githubCompareTool,
  // prCommentTool,
  // prLabelTool,
  RiskArbiter
} from '../tools/index.js';
import { ReleaseNotesAgent } from '../agents/release-notes-agent.js';
import { CodeImpactAgent } from '../agents/code-impact-agent.js';
import { 
  PRInfoAgent,
  DependencyReviewAgent,
  GitHubCompareAgent,
  PRCommentAgent,
  PRLabelAgent
} from '../agents/tool-agent.js';
import { generateReport, getHighestRisk, saveReport } from './report-generator.js';

// Workflow schemas
const workflowInputSchema = z.object({
  prNumber: z.number().describe('PR number to analyze'),
  postMode: z.enum(['always', 'update', 'never']).default('always').describe('When to post comments'),
  format: z.enum(['markdown', 'json']).default('markdown').describe('Output format'),
  language: z.enum(['en', 'ja']).default('en').describe('Output language'),
  threshold: z.number().default(1).describe('Risk threshold for auto-merge'),
});

const workflowOutputSchema = z.object({
  success: z.boolean(),
  assessments: z.array(z.any()),
  report: z.object({
    markdown: z.string().optional(),
    json: z.string().optional(),
    format: z.string(),
  }),
  posted: z.boolean(),
  overallRisk: z.string(),
});

// Output schema (for reference)
export const outputSchema = z.object({
  success: z.boolean(),
  assessments: z.array(z.any()),
  report: z.object({
    markdown: z.string().optional(),
    json: z.string().optional(),
    format: z.string(),
  }),
  posted: z.boolean(),
  overallRisk: z.string(),
});

// Step 1: Get PR Information
const getPRInfoStep = createStep({
  id: 'get-pr-info',
  description: 'Get PR information from GitHub',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    prInfo: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { prNumber, postMode, format, language } = inputData;
    
    console.log(`🔍 Analyzing PR #${prNumber}...`);
    // Use PRInfoAgent to fetch PR information
    const prInfoResult = await PRInfoAgent.generateVNext([
      {
        role: 'user',
        content: `Fetch PR information for PR #${prNumber}. Use the getPRInfoTool with prNumber: ${prNumber}.`
      }
    ]) as any;
    
    // Extract the result from Agent response
    const prInfo = prInfoResult?.object || prInfoResult;

    if (!prInfo.success || !prInfo.data) {
      throw new Error(`Failed to get PR info: ${prInfo.error || 'Unknown error'}`);
    }

    return {
      prInfo: prInfo.data,
      prNumber,
      postMode,
      format,
      language,
    };
  },
});

// Step 2: Get Dependencies
const getDependenciesStep = createStep({
  id: 'get-dependencies',
  description: 'Get dependency changes and compare info',
  inputSchema: z.object({
    prInfo: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
  }),
  outputSchema: z.object({
    prInfo: z.any(),
    dependencies: z.any(),
    compareResult: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { prInfo } = inputData;
    
    // Using prInfo to access repository info for dependencies
    const owner = prInfo.repository?.owner || 'unknown';
    const repo = prInfo.repository?.name || 'unknown';
    console.log(`Processing dependencies for ${owner}/${repo}`);
    
    // Get dependency changes
    console.log('📦 Getting dependency changes...');
    // Use DependencyReviewAgent to get dependency changes
    const dependenciesResult = await DependencyReviewAgent.generateVNext([
      {
        role: 'user',
        content: `Review dependency changes for PR #${prInfo.number} in repository ${owner}/${repo}. Use the dependencyReviewTool.`
      }
    ]) as any;
    
    // Extract the result from Agent response
    const dependencies = dependenciesResult?.object || dependenciesResult;

    // Check if lockfile-only
    console.log(`🔧 Checking change type for ${owner}/${repo}...`);
    // Use GitHubCompareAgent to compare branches
    const compareResultResponse = await GitHubCompareAgent.generateVNext([
      {
        role: 'user',
        content: `Compare branches for ${owner}/${repo} between base ${prInfo.base} and head ${prInfo.head}. Use the githubCompareTool.`
      }
    ]) as any;
    
    // Extract the result from Agent response
    const compareResult = compareResultResponse?.object || compareResultResponse;

    if (!dependencies.success || !dependencies.data) {
      throw new Error(`Failed to get dependencies: ${dependencies.error || 'Unknown error'}`);
    }

    if (!compareResult.success || !compareResult.data) {
      throw new Error(`Failed to compare branches: ${compareResult.error || 'Unknown error'}`);
    }

    return {
      ...inputData,
      dependencies: dependencies.data,
      compareResult: compareResult.data,
    };
  },
});

// Step 3: Analyze Dependencies with Agents
const analyzeDependenciesStep = createStep({
  id: 'analyze-dependencies',
  description: 'Analyze each dependency using Mastra Agents',
  inputSchema: z.object({
    prInfo: z.any(),
    dependencies: z.any(),
    compareResult: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
  }),
  outputSchema: z.object({
    assessments: z.array(z.any()),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
    prInfo: z.any(),
  }),
  execute: async ({ inputData }) => {
    const { dependencies, compareResult } = inputData;
    
    console.log('⚙️ Analyzing dependencies...');
    const assessments = [];
    
    for (const dep of dependencies) {
      // Agent.generateVNext()実装
      const releaseNotesResult = await ReleaseNotesAgent.generateVNext([
        {
          role: 'user',
          content: `Analyze ${dep.name} from ${dep.fromVersion} to ${dep.toVersion}`
        }
      ]) as any;

      // Agent.generateVNext()実装
      const codeImpactResult = await CodeImpactAgent.generateVNext([
        {
          role: 'user',
          content: `Analyze code impact for ${dep.name}`
        }
      ]) as any;

      // Risk assessment
      const riskResult = await RiskArbiter.assess({
        packageName: dep.name,
        fromVersion: dep.fromVersion,
        toVersion: dep.toVersion,
        isDevDependency: dep.type === 'devDependencies',
        isTypeDefinition: dep.name.startsWith('@types/'),
        isLockfileOnly: compareResult.isLockfileOnly,
        breakingChanges: releaseNotesResult.object?.breakingChanges?.map((bc: any) => bc.text) || [],
        usageCount: codeImpactResult.object?.totalUsages || 0,
        hasChangelog: releaseNotesResult.object?.sources?.some((s: any) => s.status === 'success') || false,
        hasDiff: true,
        testCoverage: 0,
        criticalPathUsage: (codeImpactResult.object?.criticalUsages?.length || 0) > 0,
      }) as {
        level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
        score: number;
        factors: string[];
        confidence: number;
        mitigationSteps: string[];
        estimatedEffort: string;
        testingScope: string;
      };

      assessments.push({
        dependency: dep,
        releaseNotes: releaseNotesResult.object,
        codeImpact: codeImpactResult.object,
        risk: riskResult,
      });
    }

    return {
      ...inputData,
      assessments,
    };
  },
});

// Step 4: Generate and Post Report
const generateReportStep = createStep({
  id: 'generate-report',
  description: 'Generate report and post to PR',
  inputSchema: z.object({
    assessments: z.array(z.any()),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
    prInfo: z.any(),
  }),
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const { assessments, prNumber, postMode, format, language, prInfo } = inputData;
    
    // Generate report
    console.log('📄 Generating report...');
    const report = generateReport(assessments, {
      format: format as 'markdown' | 'json',
      language: language as 'en' | 'ja',
      prInfo: {
        number: prInfo.number,
        title: prInfo.title,
        base: prInfo.base,
        head: prInfo.head,
        repository: {
          owner: prInfo.repository?.owner || 'unknown',
          name: prInfo.repository?.name || 'unknown',
        },
      },
    });

    // Post to PR (if enabled)
    let posted = false;
    if (postMode !== 'never') {
      console.log('📝 Posting to PR...');
      
      try {
        // Check for existing comment using PRCommentAgent
        const existingCommentResult = await PRCommentAgent.generateVNext([
          {
            role: 'user',
            content: `Check if there's an existing comment from renovate-safety bot on PR #${prInfo.number} in ${prInfo.repository?.owner || 'unknown'}/${prInfo.repository?.name || 'unknown'}. Use the prCommentTool with action: 'find'.`
          }
        ]) as any;
        
        const existingComment = existingCommentResult?.object || { exists: false };

        const commentMode = existingComment.exists && postMode === 'update' 
          ? 'update' as const
          : 'create' as const;

        const reportBody = report.format === 'markdown' ? report.markdown : report.json;

        // Post comment using PRCommentAgent
        await PRCommentAgent.generateVNext([
          {
            role: 'user',
            content: `Post a comment to PR #${prInfo.number} in ${prInfo.repository?.owner || 'unknown'}/${prInfo.repository?.name || 'unknown'}. Use the prCommentTool with action: '${commentMode}' and body: ${JSON.stringify(reportBody).slice(0, 100)}...`
          }
        ]);

        // Add label based on highest risk
        const highestRisk = getHighestRisk(assessments);
        // Add label using PRLabelAgent
        await PRLabelAgent.generateVNext([
          {
            role: 'user',
            content: `Add label 'renovate-safety:${highestRisk}' to PR #${prInfo.number} in ${prInfo.repository?.owner || 'unknown'}/${prInfo.repository?.name || 'unknown'}. Use the prLabelTool.`
          }
        ]);

        posted = true;
      } catch (error) {
        console.warn('Failed to post to PR:', error);
      }
    }

    // Save report to file
    await saveReport(report, prNumber);
    
    const overallRisk = getHighestRisk(assessments);
    console.log(`✅ Analysis complete - Overall risk: ${overallRisk.toUpperCase()}`);

    return {
      success: true,
      assessments,
      report,
      posted,
      overallRisk,
    };
  },
});

// Create the Workflow
export const analyzeRenovatePRWorkflow = createWorkflow({
  id: 'analyze-renovate-pr',
  description: 'Analyze Renovate PR for breaking changes and risk assessment',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
.then(getPRInfoStep)
.then(getDependenciesStep) 
.then(analyzeDependenciesStep)
.then(generateReportStep)
.commit();

// Legacy function wrapper for backwards compatibility
export async function analyzeRenovatePR(input: z.infer<typeof workflowInputSchema>) {
  const workflow = analyzeRenovatePRWorkflow;
  const run = await workflow.createRunAsync();
  const result = await run.start({ inputData: input });
  
  if (result.status !== 'success') {
    throw new Error(`Workflow failed with status: ${result.status}`);
  }
  
  return result.result;
}

// Export types
export type AnalyzeRenovatePRInput = z.infer<typeof workflowInputSchema>;
export type AnalyzeRenovatePROutput = z.infer<typeof workflowOutputSchema>;