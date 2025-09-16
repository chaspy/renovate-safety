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
        content: `Please provide a detailed library overview for package: ${packageName} in language: ${language}`
      }
    ]) as any;

    if (result.object) {
      return result.object;
    } else {
      // Enhanced fallback with better package-specific information
      return generateEnhancedFallback(packageName, language);
    }
  } catch (error) {
    console.warn('Failed to generate library overview, using enhanced fallback:', error);
    return generateEnhancedFallback(packageName, language);
  }
}

// Enhanced fallback with package-specific knowledge
function generateEnhancedFallback(packageName: string, language: 'en' | 'ja'): {
  overview: string;
  category: string;
  mainPurpose: string;
} {
  // Package-specific enhanced descriptions
  const packageInfo = getPackageSpecificInfo(packageName);
  
  if (language === 'ja') {
    return {
      overview: packageInfo.overviewJa,
      category: packageInfo.category,
      mainPurpose: packageInfo.mainPurposeJa
    };
  } else {
    return {
      overview: packageInfo.overviewEn,
      category: packageInfo.category,
      mainPurpose: packageInfo.mainPurposeEn
    };
  }
}

// Package-specific information database
function getPackageSpecificInfo(packageName: string) {
  const knownPackages: Record<string, any> = {
    'p-limit': {
      category: 'concurrency-control',
      overviewJa: 'p-limitは同時実行される非同期処理（Promise）の数を制限するライブラリです。大量のAPI呼び出しやファイル操作を並列実行する際に、システムリソースの枯渇やレート制限エラーを防ぐために使用されます。指定した上限数以内でPromiseを実行し、完了したら次のPromiseを実行するキューイング機能を提供します。',
      overviewEn: 'p-limit is a library that controls the concurrency of asynchronous operations (Promises) by limiting how many can run simultaneously. It prevents system resource exhaustion and rate limit errors when performing bulk API calls or file operations in parallel. It provides a queuing mechanism that executes Promises within a specified limit and processes the next Promise when one completes.',
      mainPurposeJa: '非同期処理の同時実行数を制限してシステム負荷とレート制限を制御する',
      mainPurposeEn: 'Controls concurrency of async operations to prevent system overload and rate limiting'
    },
    'axios': {
      category: 'http-client',
      overviewJa: 'axiosはHTTP通信を行うためのPromise-basedなHTTPクライアントライブラリです。RESTful APIとの通信、リクエスト・レスポンスのインターセプト、自動JSONパース、エラーハンドリングなどの機能を提供します。Node.jsとブラウザの両方で動作し、タイムアウト設定やリトライ機能も備えています。',
      overviewEn: 'axios is a Promise-based HTTP client library for making HTTP requests. It provides features like RESTful API communication, request/response interceptors, automatic JSON parsing, and error handling. It works in both Node.js and browsers, with support for timeouts and retry functionality.',
      mainPurposeJa: 'HTTP通信を簡単かつ柔軟に行うためのクライアントライブラリ',
      mainPurposeEn: 'Simplified and flexible HTTP client for API communication'
    }
    // Add more packages as needed
  };

  return knownPackages[packageName] || {
    category: 'utility',
    overviewJa: `${packageName}は Node.jsエコシステムで使用されるパッケージです。具体的な機能については、パッケージのドキュメントを参照してください。`,
    overviewEn: `${packageName} is a package used in the Node.js ecosystem. Please refer to the package documentation for specific functionality.`,
    mainPurposeJa: '詳細な情報を取得できませんでした',
    mainPurposeEn: 'Unable to retrieve detailed information'
  };
}