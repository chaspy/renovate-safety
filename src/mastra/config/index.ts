import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { pingAgent } from '../agents/ping-agent.js';
import { ReleaseNotesAgent } from '../agents/release-notes-agent.js';
import { CodeImpactAgent } from '../agents/code-impact-agent.js';
import { analyzeRenovatePRWorkflow } from '../workflows/analyze-renovate-pr.js';
import { 
  dependencyReviewTool, 
  githubCompareTool, 
  prCommentTool, 
  prLabelTool, 
  getPRInfoTool 
} from '../tools/index.js';

// Mastra インスタンスの作成
export const mastra = new Mastra({
  agents: {
    ping: pingAgent,
    releaseNotesAgent: ReleaseNotesAgent,
    codeImpactAgent: CodeImpactAgent,
  },
  workflows: {
    analyzeRenovatePRWorkflow,
  },
});

// GitHub API Tools をエクスポート
export {
  dependencyReviewTool,
  githubCompareTool, 
  prCommentTool,
  prLabelTool,
  getPRInfoTool
};

// 設定の検証
export function validateConfig(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    console.warn('Warning: GITHUB_TOKEN not set. Some features may be limited.');
  }
}