/**
 * Renovate PR Analysis Workflow - Refactored for better separation of concerns
 * This workflow orchestrates the analysis process using dedicated services
 */

import { z } from 'zod';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { saveReport, getHighestRisk } from './report-generator.js';
import { 
  initializeTracking, 
  finalizeTracking
} from '../tools/execution-tracker.js';

// New services - much cleaner architecture
import { 
  fetchGitHubPRInfo, 
  getDependencyChanges, 
  compareBranches, 
  handlePRPosting
} from '../services/github-integration.js';
import { generateUnifiedReport } from '../services/report-generator.js';
import { 
  analyzeDependencies
} from '../services/workflow-orchestrator.js';

// Workflow schemas
const workflowInputSchema = z.object({
  prNumber: z.number().describe('PR number to analyze'),
  postMode: z.enum(['always', 'update', 'never']).default('always').describe('When to post comments'),
  format: z.enum(['markdown', 'json']).default('markdown').describe('Output format'),
  language: z.enum(['en', 'ja']).default('en').describe('Output language'),
  threshold: z.number().default(1).describe('Risk threshold for auto-merge'),
  concurrency: z.number().default(3).describe('Number of dependencies to analyze in parallel'),
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
  executionStats: z.any().optional(),
});

// Step 1: Get PR Information (using direct tool calls - no unnecessary Agent wrappers)
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
    concurrency: z.number(),
  }),
  execute: async ({ inputData }) => {
    const { prNumber, postMode, format, language, concurrency } = inputData;
    
    console.log(`🔍 Analyzing PR #${prNumber}...`);
    
    // Initialize execution tracking
    const tracker = initializeTracking(prNumber, `analysis_${prNumber}_${Date.now()}`);
    console.log(`📊 Execution tracking initialized for PR #${prNumber}`);
    
    // Use direct service call instead of Agent wrapper
    const prInfo = await fetchGitHubPRInfo(prNumber);

    // Set repository information for tracking
    if (prInfo.repository) {
      tracker.setRepository(prInfo.repository.owner, prInfo.repository.name);
      tracker.setBranchInfo(prInfo.base, prInfo.head);
    }
    tracker.addDataSource('github-api');

    return {
      prInfo,
      prNumber,
      postMode,
      format,
      language,
      concurrency,
    };
  },
});

// Step 2: Get Dependencies (using direct tool calls)
const getDependenciesStep = createStep({
  id: 'get-dependencies',
  description: 'Get dependency changes and compare info',
  inputSchema: z.object({
    prInfo: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
    concurrency: z.number(),
  }),
  outputSchema: z.object({
    prInfo: z.any(),
    dependencies: z.any(),
    compareResult: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
    concurrency: z.number(),
  }),
  execute: async ({ inputData }) => {
    const { prInfo } = inputData;
    
    console.log(`📦 Getting dependency changes for ${prInfo.repository?.owner}/${prInfo.repository?.name}...`);
    
    // Use parallel service calls for better performance
    const [dependencies, compareResult] = await Promise.all([
      getDependencyChanges(prInfo),
      compareBranches(prInfo)
    ]);

    return {
      ...inputData,
      dependencies,
      compareResult,
    };
  },
});

// Step 3: Analyze Dependencies (with improved parallelization)
const analyzeDependenciesStep = createStep({
  id: 'analyze-dependencies',
  description: 'Analyze each dependency using optimized orchestration',
  inputSchema: z.object({
    prInfo: z.any(),
    dependencies: z.any(),
    compareResult: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
    concurrency: z.number(),
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
    const { dependencies, compareResult, language, concurrency } = inputData;
    
    // Use the optimized parallel analysis from workflow-orchestrator
    const assessments = await analyzeDependencies(
      dependencies, 
      compareResult, 
      language as 'en' | 'ja',
      concurrency
    );

    return {
      ...inputData,
      assessments,
    };
  },
});

// Step 4: Generate and Post Report (using unified services)
const generateReportStep = createStep({
  id: 'generate-report',
  description: 'Generate report and post to PR using services',
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
    
    console.log('📄 Generating unified report...');
    
    // Finalize tracking to get accurate statistics
    const finalExecutionStats = finalizeTracking();
    console.log('📊 Execution tracking finalized');
    
    // Generate report using the unified service
    const report = await generateUnifiedReport(assessments, {
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
      executionStats: finalExecutionStats || undefined,
      includeExecutionStats: true,
    });

    // Handle PR posting using the service
    const overallRisk = getHighestRisk(assessments);
    const reportBody = report.format === 'markdown' ? report.markdown : report.json;
    
    const posted = await handlePRPosting(
      prInfo,
      reportBody,
      postMode,
      overallRisk
    );

    // Save report to file
    await saveReport(report, prNumber);
    
    // Display final statistics
    if (finalExecutionStats) {
      console.log(`⏱️  Total analysis time: ${Math.round((finalExecutionStats.totalDuration || 0) / 1000)}s`);
      console.log(`🔧 Agents used: ${finalExecutionStats.agents.length}`);
      console.log(`🌐 API calls: ${finalExecutionStats.apiCalls.total}`);
      console.log(`💸 Estimated cost: $${(finalExecutionStats.apiCalls.estimatedCost || 0).toFixed(4)}`);
    }
    
    console.log(`✅ Analysis complete - Overall risk: ${overallRisk.toUpperCase()}`);

    return {
      success: true,
      assessments,
      report,
      posted,
      overallRisk,
      executionStats: finalExecutionStats || undefined,
    };
  },
});

// Create the Workflow - much cleaner and more focused
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

// Output schema for reference
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