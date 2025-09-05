import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { npmDiffTool } from '../tools/npm-diff.js';
import { dependencyReviewTool } from '../tools/dependency-review.js';
import { githubCompareTool } from '../tools/github-compare.js';

/**
 * NPM Package Analysis Agent
 * npm-diffツールを使用してパッケージ間の差分を分析
 */
export const npmAgent = new Agent({
  name: 'npm-analyst',
  instructions: `You are an NPM package analysis expert. 
    Use npm-diff tool to compare package versions when asked.
    Use dependency-review tool for GitHub dependency changes.
    Use github-compare tool for GitHub commit comparisons.
    Provide clear summaries of breaking changes and version differences.`,
  model: openai('gpt-4o-mini'),
  tools: { 
    npmDiffTool, 
    dependencyReviewTool,
    githubCompareTool,
  },
});