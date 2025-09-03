import { Mastra } from '@mastra/core';
import { pingAgent } from '../agents/ping-agent.js';

// Mastra インスタンスの作成
// 正しい方法：Agentを登録する（providersは存在しない）
export const mastra = new Mastra({
  agents: {
    ping: pingAgent,  // Agentを登録
  },
  // workflows と tools は任意（空でOK）
  workflows: {},
  tools: {},
});

// 設定の検証
export function validateConfig(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    console.warn('Warning: GITHUB_TOKEN not set. Some features may be limited.');
  }
}