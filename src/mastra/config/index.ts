// import { Mastra } from '@mastra/core';
import { createOpenAI } from '@ai-sdk/openai';

// OpenAI プロバイダの設定
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Mastra インスタンスの作成
// 注意: 現在、Mastraの依存関係（Prisma）の問題があるため、一時的にコメントアウト
// TODO: Prismaの設定後に再度有効化
// export const mastra = new Mastra({
//   providers: {
//     openai,
//   },
//   // vector-syncエラーを回避するため、agents設定を明示的に空にする
//   agents: {},
//   workflows: {},
//   tools: {},
// });

// 代替: aiパッケージとの統合用のopenaiプロバイダーをエクスポート
export const mastra = null; // 一時的なプレースホルダー

// 設定の検証
export function validateConfig(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    console.warn('Warning: GITHUB_TOKEN not set. Some features may be limited.');
  }
}