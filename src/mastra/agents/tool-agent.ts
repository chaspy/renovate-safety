import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import {
  getPRInfoTool,
  dependencyReviewTool,
  githubCompareTool,
  prCommentTool,
  prLabelTool,
} from '../tools/index.js';

/**
 * Tool Agent - Executes various GitHub and npm tools
 */
export const ToolAgent = new Agent({
  name: 'Tool Agent',
  model: openai('gpt-4o-mini'),
  instructions: `You are a tool execution agent that handles various GitHub and npm operations.
Execute the requested tool based on the operation type provided.
Return the tool's result directly.`,
  tools: {
    getPRInfoTool,
    dependencyReviewTool,
    githubCompareTool,
    prCommentTool,
    prLabelTool,
  },
});

// Individual specialized agents for better separation of concerns
export const PRInfoAgent = new Agent({
  name: 'PR Info Agent',
  model: openai('gpt-4o-mini'),
  instructions: 'Fetch PR information using the getPRInfoTool and return the result.',
  tools: {
    getPRInfoTool,
  },
});

export const DependencyReviewAgent = new Agent({
  name: 'Dependency Review Agent',
  model: openai('gpt-4o-mini'),
  instructions: 'Review dependency changes using the dependencyReviewTool and return the result.',
  tools: {
    dependencyReviewTool,
  },
});

export const GitHubCompareAgent = new Agent({
  name: 'GitHub Compare Agent',
  model: openai('gpt-4o-mini'),
  instructions: 'Compare branches using the githubCompareTool and return the result.',
  tools: {
    githubCompareTool,
  },
});

export const PRCommentAgent = new Agent({
  name: 'PR Comment Agent',
  model: openai('gpt-4o-mini'),
  instructions: 'Manage PR comments using the prCommentTool and return the result.',
  tools: {
    prCommentTool,
  },
});

export const PRLabelAgent = new Agent({
  name: 'PR Label Agent',
  model: openai('gpt-4o-mini'),
  instructions: 'Manage PR labels using the prLabelTool and return the result.',
  tools: {
    prLabelTool,
  },
});