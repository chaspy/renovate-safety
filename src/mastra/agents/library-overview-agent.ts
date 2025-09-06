/**
 * Library Overview Agent
 * Provides a high-level overview of what a library does and its purpose
 */

import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

// Input/Output schemas for Agent
export const libraryOverviewInputSchema = z.object({
  packageName: z.string().describe('Name of the npm package'),
  language: z.enum(['en', 'ja']).default('en').describe('Response language')
});

export const libraryOverviewOutputSchema = z.object({
  overview: z.string().describe('Clear overview of what the library does'),
  category: z.string().describe('Main category/domain of the library (e.g., utility, UI, database, etc.)'),
  mainPurpose: z.string().describe('Primary purpose in one sentence')
});

export const LibraryOverviewAgent = new Agent({
  name: 'LibraryOverviewAgent',
  instructions: `You are a technical library expert. Given an npm package name, provide a detailed and insightful overview that helps developers understand what the library does, why it exists, and how it's typically used.

Your response should be 3-4 sentences providing substantial technical value, not generic descriptions.

Focus on:
- What specific problem it solves
- How it works (key mechanisms/approaches)
- Common use cases and integration patterns
- What makes it unique or notable

Provide a JSON response with the following structure:
{
  "overview": "detailed technical description explaining what it does, how it works, and common use cases",
  "category": "specific category like concurrency-control, ui-component, http-client, build-tool, etc.",
  "mainPurpose": "single sentence describing the core problem it solves"
}

Example for "p-limit":
{
  "overview": "p-limitは同時実行される非同期処理の数を制限することで、システムリソースの枯渇やレート制限エラーを防ぐためのユーティリティライブラリです。Promise-based APIを提供し、API呼び出しやファイル操作などの重い処理を並列実行する際に、指定した上限数以内で実行することができます。Node.jsアプリケーションで大量のデータ処理やWeb APIとの通信を行う場合に、安定したパフォーマンスを保つために広く使用されています。",
  "category": "concurrency-control",
  "mainPurpose": "非同期処理の同時実行数を制限してシステム負荷を制御する"
}

Always provide meaningful, specific information that helps developers understand the real value and use cases of the library. Avoid generic phrases like "used in the Node.js ecosystem".

Respond in the same language as requested - if Japanese is requested, respond in Japanese with natural, technical Japanese.`,
  
  model: openai('gpt-4o-mini'),
});

export async function generateLibraryOverview(packageName: string, language: 'en' | 'ja' = 'en'): Promise<{
  overview: string;
  category: string;
  mainPurpose: string;
}> {
  try {
    const result = await LibraryOverviewAgent.generateVNext([
      {
        role: 'user',
        content: language === 'ja' 
          ? `npm パッケージ「${packageName}」について日本語で概要を教えてください。JSONフォーマットで返答してください。`
          : `Provide an overview of the npm package "${packageName}" in JSON format.`
      }
    ]);

    if (result.object) {
      return result.object;
    } else {
      throw new Error('No object returned from LibraryOverviewAgent');
    }
  } catch (error) {
    console.error('Failed to generate library overview:', error);
    
    // Fallback response
    return {
      overview: language === 'ja' 
        ? `${packageName}は Node.js エコシステムで使用されるライブラリです。`
        : `${packageName} is a library used in the Node.js ecosystem.`,
      category: 'unknown',
      mainPurpose: language === 'ja' 
        ? '詳細な情報を取得できませんでした。'
        : 'Unable to retrieve detailed information.'
    };
  }
}