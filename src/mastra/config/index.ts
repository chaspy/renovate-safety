import { Mastra } from '@mastra/core';
import { createOpenAI } from '@ai-sdk/openai';

// OpenAI プロバイダの設定
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Mastra インスタンスの作成
export const mastra = new Mastra({
  providers: {
    openai,
  },
  // 最小限の設定でvector-syncエラーを回避
  agents: {},
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