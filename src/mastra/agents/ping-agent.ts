import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

/**
 * 最小限のテスト用Agent
 * Mastra統合を確認するためのシンプルなAgent
 */
export const pingAgent = new Agent({
  name: 'ping',
  instructions: 'You are a helpful assistant. When asked to say hello to Mastra, respond with exactly "Hello, Mastra!" and nothing else.',
  model: openai('gpt-3.5-turbo'),
});