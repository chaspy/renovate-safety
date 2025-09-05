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
  instructions: `You are a technical library expert. Given a npm package name, provide a clear and concise overview of what the library does, its main purpose, and common use cases.

Your response should be 2-3 sentences maximum and suitable for both technical and non-technical audiences.

Provide a JSON response with the following structure:
{
  "overview": "comprehensive but concise description",
  "category": "common category like utility, ui-component, framework, database, testing, build-tool, security, etc.",
  "mainPurpose": "single sentence describing the primary purpose"
}

Example for "p-limit":
{
  "overview": "p-limit is a utility library that controls concurrency by limiting the number of promises that run simultaneously. It helps prevent overwhelming systems with too many parallel operations and is commonly used for rate limiting API calls or file operations.",
  "category": "utility",
  "mainPurpose": "Controls promise concurrency to prevent system overload."
}

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