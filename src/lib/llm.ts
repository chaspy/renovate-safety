import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { secureSystemExec } from './secure-exec.js';
import type { PackageUpdate, ChangelogDiff, BreakingChange, LLMSummary, CodeDiff, DependencyUsage } from '../types/index.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export async function summarizeWithLLM(
  packageUpdate: PackageUpdate,
  changelogDiff: ChangelogDiff,
  breakingChanges: BreakingChange[],
  provider?: 'claude-cli' | 'anthropic' | 'openai',
  cacheDir?: string
): Promise<LLMSummary | null> {
  // Check cache first
  if (cacheDir) {
    const cached = await getCachedSummary(packageUpdate, cacheDir);
    if (cached) return cached;
  }

  // Determine provider
  const llmProvider = provider || (await detectProvider());
  if (!llmProvider) {
    console.warn(
      'No LLM provider available. Install Claude CLI or set ANTHROPIC_API_KEY/OPENAI_API_KEY.'
    );
    return null;
  }

  try {
    const prompt = buildPrompt(packageUpdate, changelogDiff, breakingChanges);

    let summary: LLMSummary | null = null;
    switch (llmProvider) {
      case 'claude-cli':
        summary = await summarizeWithClaudeCLI(prompt);
        break;
      case 'anthropic':
        summary = await summarizeWithAnthropic(prompt);
        break;
      case 'openai':
        summary = await summarizeWithOpenAI(prompt);
        break;
    }

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

async function detectProvider(): Promise<'claude-cli' | 'anthropic' | 'openai' | null> {
  // Priority 1: Claude CLI (for Pro/Max users - preferred for best model access)
  try {
    const result = await secureSystemExec('claude', ['--version'], { timeout: 5000 });
    if (result.success) {
      return 'claude-cli';
    }
  } catch (error) {
    // Claude CLI not available, continue to next option
  }

  // Priority 2: Anthropic API
  if (process.env.ANTHROPIC_API_KEY) {
    return 'anthropic';
  }

  // Priority 3: OpenAI API
  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }

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

async function summarizeWithClaudeCLI(prompt: string): Promise<LLMSummary | null> {
  // Test if prompt is too long or contains problematic characters
  if (prompt.length > 10000) {
    prompt = prompt.substring(0, 9000) + '\n\n... (truncated for analysis)';
  }
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await secureSystemExec('claude', [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--max-turns',
        '1',
      ], {
        timeout: 30000, // 30 second timeout for Claude CLI stability
      });
      
      if (!result.success) {
        throw new Error(`Claude CLI failed: ${result.error}`);
      }

      return parseResponse(result.stdout);
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

  // Check if prompt is in Japanese
  const isJapanesePrompt = prompt.includes('日本語で');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const systemPrompt = isJapanesePrompt
        ? 'あなたはソフトウェアの変更履歴を分析する有用なアシスタントです。常に有効なJSONで応答してください。日本語で回答してください。'
        : 'You are a helpful assistant that analyzes software changelogs. Always respond with valid JSON.';
      
      const response = await openai.chat.completions.create({
        model: 'o3-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_completion_tokens: 1000,
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
    if (!jsonMatch) {
      console.warn('No JSON found in LLM response');
      return null;
    }

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

// Enhanced LLM analysis that works without changelog
export async function enhancedLLMAnalysis(
  packageUpdate: PackageUpdate,
  changelogDiff: ChangelogDiff | null,
  codeDiff: CodeDiff | null,
  dependencyUsage: DependencyUsage | null,
  breakingChanges: BreakingChange[],
  provider?: 'claude-cli' | 'anthropic' | 'openai',
  cacheDir?: string,
  language: 'en' | 'ja' = 'en'
): Promise<LLMSummary | null> {
  // Fix invalid provider parameter (likely from CLI parsing issue)
  if (typeof provider !== 'string' || !['claude-cli', 'anthropic', 'openai'].includes(provider)) {
    provider = undefined;
  }
  
  // Check cache first
  if (cacheDir) {
    const cached = await getCachedEnhancedSummary(packageUpdate, cacheDir);
    if (cached) return cached;
  }

  // Determine provider
  const llmProvider = provider || (await detectProvider());
  
  if (!llmProvider) {
    console.warn(
      'No LLM provider available. Install Claude CLI or set ANTHROPIC_API_KEY/OPENAI_API_KEY.'
    );
    return null;
  }

  try {
    const prompt = buildEnhancedPrompt(packageUpdate, changelogDiff, codeDiff, dependencyUsage, breakingChanges, language);

    let summary: LLMSummary | null = null;
    
    // Try primary provider first
    
    try {
      switch (llmProvider) {
        case 'claude-cli':
          summary = await summarizeWithClaudeCLI(prompt);
          break;
        case 'anthropic':
          summary = await summarizeWithAnthropic(prompt);
          break;
        case 'openai':
          summary = await summarizeWithOpenAI(prompt);
          break;
      }
    } catch (primaryError) {
      
      // Try fallback providers
      const fallbackProviders = ['anthropic', 'openai'].filter(p => p !== llmProvider);
      
      for (const fallback of fallbackProviders) {
        if ((fallback === 'anthropic' && process.env.ANTHROPIC_API_KEY) ||
            (fallback === 'openai' && process.env.OPENAI_API_KEY)) {
          
          try {
            switch (fallback) {
              case 'anthropic':
                summary = await summarizeWithAnthropic(prompt);
                break;
              case 'openai':
                summary = await summarizeWithOpenAI(prompt);
                break;
            }
            
            if (summary) {
              break;
            }
          } catch (fallbackError) {
          }
        }
      }
    }

    // Cache the result
    if (summary && cacheDir) {
      await cacheEnhancedSummary(packageUpdate, summary, cacheDir);
    }

    return summary;
  } catch (error) {
    console.error('Enhanced LLM analysis failed:', error);
    return null;
  }
}

function buildEnhancedPrompt(
  packageUpdate: PackageUpdate,
  changelogDiff: ChangelogDiff | null,
  codeDiff: CodeDiff | null,
  dependencyUsage: DependencyUsage | null,
  breakingChanges: BreakingChange[],
  language: 'en' | 'ja' = 'en'
): string {
  const sections: string[] = [];

  // Package info
  sections.push(`You are analyzing a dependency update for a software project.

Package: ${packageUpdate.name}
Version: ${packageUpdate.fromVersion} → ${packageUpdate.toVersion}`);

  // Breaking changes section
  const breakingSection = breakingChanges.length > 0 
    ? `\nPattern-Identified Breaking Changes:\n${breakingChanges.map((bc) => `- [${bc.severity}] ${bc.line}`).join('\n')}`
    : '\nNo explicit breaking changes identified from patterns.';
  sections.push(breakingSection);

  // Changelog section
  if (changelogDiff) {
    sections.push(`\nChangelog excerpt:\n${changelogDiff.content.substring(0, 3000)}${changelogDiff.content.length > 3000 ? '\n...(truncated)' : ''}`);
  } else {
    sections.push('\nNo changelog found for this version update.');
  }

  // Code diff section
  if (codeDiff) {
    sections.push(`\nCode Changes Analysis:
Files changed: ${codeDiff.filesChanged}
Additions: ${codeDiff.additions}
Deletions: ${codeDiff.deletions}
Tags compared: ${codeDiff.fromTag} → ${codeDiff.toTag}

Code diff excerpt:
${codeDiff.content.substring(0, 4000)}${codeDiff.content.length > 4000 ? '\n...(truncated for analysis)' : ''}`);
  } else {
    sections.push('\nNo code diff available (package may not have GitHub repository or tags).');
  }

  // Dependency usage section
  if (dependencyUsage) {
    sections.push(`\nDependency Usage Analysis:
- Type: ${dependencyUsage.isDirect ? 'Direct' : 'Transitive'} dependency
- Category: ${dependencyUsage.usageType}
- Number of dependents: ${dependencyUsage.dependents.length}

Dependency chain:
${dependencyUsage.dependents.slice(0, 5).map(dep => 
  `- ${dep.name} (${dep.version}) [${dep.type}] - Path: ${dep.path.join(' → ')}`
).join('\n')}${dependencyUsage.dependents.length > 5 ? `\n- ... and ${dependencyUsage.dependents.length - 5} more` : ''}`);
  } else {
    sections.push('\nNo dependency usage information available.');
  }

  // Analysis request
  if (language === 'ja') {
    sections.push(`\n上記のすべての情報（changelog、コード変更、依存関係）に基づいて、以下の内容を日本語で提供してください：

1. 主要な変更点とその潜在的な影響についての包括的な要約（2-4文）
2. ユーザーに影響を与える可能性のある破壊的変更をリストアップ。以下を考慮：
   - コード差分からのAPI変更
   - 依存関係の変更
   - メジャーバージョンアップの影響
3. 依存関係の使用状況を考慮した全体的なリスクレベルの評価
4. 分析内容の言語を"ja"として返す

重要：changelogがなくても、コード差分と依存関係の使用状況を分析して、潜在的な破壊的変更を特定してください。メジャーバージョンアップは特に注意が必要です。

応答はJSON形式で：
{
  "summary": "ここに包括的な要約を日本語で記載",
  "language": "ja", 
  "breakingChanges": ["変更1", "変更2", ...]
}`);
  } else {
    sections.push(`\nBased on ALL available information above (changelog, code changes, dependency usage), please provide:

1. A comprehensive summary of the key changes and their potential impact (2-4 sentences)
2. List any breaking changes that could affect users, considering:
   - Code API changes from the diff
   - Dependency relationship changes
   - Major version implications
3. Assess the overall risk level considering the dependency usage
4. Return the language as "en"

Important: Even without a changelog, analyze the code diff and dependency usage to identify potential breaking changes. Major version updates should be treated with extra caution.

Format your response as JSON:
{
  "summary": "Your comprehensive summary here",
  "language": "en", 
  "breakingChanges": ["change 1", "change 2", ...]
}`);
  }

  return sections.join('\n');
}

async function getCachedEnhancedSummary(
  packageUpdate: PackageUpdate,
  cacheDir: string
): Promise<LLMSummary | null> {
  try {
    const cacheKey = getEnhancedSummaryCacheKey(packageUpdate);
    const cachePath = path.join(cacheDir, 'enhanced-summaries', `${cacheKey}.json`);

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

async function cacheEnhancedSummary(
  packageUpdate: PackageUpdate,
  summary: LLMSummary,
  cacheDir: string
): Promise<void> {
  try {
    const summaryDir = path.join(cacheDir, 'enhanced-summaries');
    await fs.mkdir(summaryDir, { recursive: true });

    const cacheKey = getEnhancedSummaryCacheKey(packageUpdate);
    const cachePath = path.join(summaryDir, `${cacheKey}.json`);

    await fs.writeFile(cachePath, JSON.stringify(summary, null, 2));
  } catch (error) {
    console.warn('Failed to cache enhanced summary:', error);
  }
}

function getEnhancedSummaryCacheKey(packageUpdate: PackageUpdate): string {
  const key = `enhanced-${packageUpdate.name}@${packageUpdate.fromVersion}->${packageUpdate.toVersion}`;
  return createHash('sha1').update(key).digest('hex');
}
