import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { PackageUpdate, ChangelogDiff, BreakingChange, LLMSummary } from '../types/index.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export async function summarizeWithLLM(
  packageUpdate: PackageUpdate,
  changelogDiff: ChangelogDiff,
  breakingChanges: BreakingChange[],
  provider?: 'anthropic' | 'openai',
  cacheDir?: string
): Promise<LLMSummary | null> {
  // Check cache first
  if (cacheDir) {
    const cached = await getCachedSummary(packageUpdate, cacheDir);
    if (cached) return cached;
  }

  // Determine provider
  const llmProvider = provider || detectProvider();
  if (!llmProvider) {
    console.warn('No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
    return null;
  }

  try {
    const prompt = buildPrompt(packageUpdate, changelogDiff, breakingChanges);
    const summary = await (llmProvider === 'anthropic'
      ? summarizeWithAnthropic(prompt)
      : summarizeWithOpenAI(prompt));

    // Cache the result
    if (summary && cacheDir) {
      await cacheSummary(packageUpdate, summary, cacheDir);
    }

    return summary;
  } catch (error) {
    console.error('LLM summarization failed:', error);
    return null;
  }
}

function detectProvider(): 'anthropic' | 'openai' | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function buildPrompt(
  packageUpdate: PackageUpdate,
  changelogDiff: ChangelogDiff,
  breakingChanges: BreakingChange[]
): string {
  const breakingSection =
    breakingChanges.length > 0
      ? `\nIdentified Breaking Changes:\n${breakingChanges.map((bc) => `- [${bc.severity}] ${bc.line}`).join('\n')}`
      : '\nNo explicit breaking changes identified.';

  return `You are analyzing a dependency update for a software project.

Package: ${packageUpdate.name}
Version: ${packageUpdate.fromVersion} → ${packageUpdate.toVersion}

${breakingSection}

Changelog excerpt:
${changelogDiff.content.substring(0, 3000)}${changelogDiff.content.length > 3000 ? '\n...(truncated)' : ''}

Please provide:
1. A concise summary of the key changes (2-3 sentences)
2. List any breaking changes that could affect users
3. Determine if the changelog is in English or Japanese

Format your response as JSON:
{
  "summary": "Your summary here",
  "language": "en" or "ja",
  "breakingChanges": ["change 1", "change 2", ...]
}`;
}

async function summarizeWithAnthropic(prompt: string): Promise<LLMSummary | null> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        temperature: 0,
        system:
          'You are a helpful assistant that analyzes software changelogs. Always respond with valid JSON.',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        return parseResponse(content.text);
      }

      return null;
    } catch (error) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  return null;
}

async function summarizeWithOpenAI(prompt: string): Promise<LLMSummary | null> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: 'o3-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that analyzes software changelogs. Always respond with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        return parseResponse(content);
      }

      return null;
    } catch (error) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  return null;
}

function parseResponse(text: string): LLMSummary | null {
  try {
    // Extract JSON from the response (in case there's extra text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate the response
    if (!parsed.summary || !parsed.language || !Array.isArray(parsed.breakingChanges)) {
      console.warn('Invalid LLM response format');
      return null;
    }

    return {
      summary: parsed.summary,
      language: parsed.language === 'ja' ? 'ja' : 'en',
      breakingChanges: parsed.breakingChanges.filter((x: unknown) => typeof x === 'string'),
    };
  } catch (error) {
    console.warn('Failed to parse LLM response:', error);
    return null;
  }
}

async function getCachedSummary(
  packageUpdate: PackageUpdate,
  cacheDir: string
): Promise<LLMSummary | null> {
  try {
    const cacheKey = getSummaryCacheKey(packageUpdate);
    const cachePath = path.join(cacheDir, 'summaries', `${cacheKey}.json`);

    const exists = await fs
      .access(cachePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) return null;

    const content = await fs.readFile(cachePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function cacheSummary(
  packageUpdate: PackageUpdate,
  summary: LLMSummary,
  cacheDir: string
): Promise<void> {
  try {
    const summaryDir = path.join(cacheDir, 'summaries');
    await fs.mkdir(summaryDir, { recursive: true });

    const cacheKey = getSummaryCacheKey(packageUpdate);
    const cachePath = path.join(summaryDir, `${cacheKey}.json`);

    await fs.writeFile(cachePath, JSON.stringify(summary, null, 2));
  } catch (error) {
    console.warn('Failed to cache summary:', error);
  }
}

function getSummaryCacheKey(packageUpdate: PackageUpdate): string {
  const key = `${packageUpdate.name}@${packageUpdate.fromVersion}->${packageUpdate.toVersion}`;
  return createHash('sha1').update(key).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
