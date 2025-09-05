import { z } from 'zod';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { 
  // TODO: #28でAgent.generate()実装時に再度有効化
  // getPRInfoTool,
  // dependencyReviewTool,
  // githubCompareTool,
  // prCommentTool,
  // prLabelTool,
  RiskArbiter
} from '../tools/index.js';
import { ReleaseNotesAgent } from '../agents/release-notes-agent.js';
import { CodeImpactAgent } from '../agents/code-impact-agent.js';
import { LibraryOverviewAgent } from '../agents/library-overview-agent.js';
import { 
  PRInfoAgent,
  DependencyReviewAgent,
  GitHubCompareAgent,
  PRCommentAgent,
  PRLabelAgent
} from '../agents/tool-agent.js';
import { generateReport, getHighestRisk, saveReport } from './report-generator.js';
import { 
  initializeTracking, 
  finalizeTracking, 
  getCurrentTracker, 
  trackAgent,
  type ExecutionStats 
} from '../tools/execution-tracker.js';
import {
  generateGitHubFileLink,
  generateMarkdownLink,
  autoDetectRepository,
  type GitHubLinkOptions
} from '../tools/github-link-generator.js';

// Translation function using OpenAI for natural Japanese translation
async function translateRecommendation(rec: string): Promise<string> {
  // Skip translation if already in Japanese or very short
  if (rec.length < 10 || /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(rec)) {
    return rec;
  }
  
  try {
    // Use OpenAI for natural translation
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: '技術的な推奨アクションを自然な日本語に翻訳してください。技術用語は適切な日本語に翻訳し、コード名（バッククォートで囲まれた部分）はそのまま保持してください。丁寧語を使用してください。'
          },
          {
            role: 'user',
            content: rec
          }
        ],
        temperature: 0.1,
        max_tokens: 200
      })
    });
    
    if (!response.ok) {
      throw new Error(`Translation API failed: ${response.status}`);
    }
    
    const data = await response.json();
    const translated = data.choices?.[0]?.message?.content?.trim();
    
    return translated || rec; // Fallback to original if translation fails
  } catch (error) {
    console.log('DEBUG - Translation failed, using original:', error);
    return rec; // Fallback to original text on error
  }
}

// Helper functions to extract data from CodeImpactAgent response
function extractTotalUsages(codeImpactResult: any): number {
  try {
    // Try to extract from tool results in the response
    const toolResults = codeImpactResult?.steps?.find((step: any) => 
      step.stepType === 'tool-result' && step.tools?.length > 0
    )?.tools || [];
    
    const tsUsageResult = toolResults.find((tool: any) => tool.name === 'tsUsageScanner');
    if (tsUsageResult?.result?.summary?.total) {
      return tsUsageResult.result.summary.total;
    }
    
    // Fallback: try to parse from text response
    const text = codeImpactResult?.text || '';
    const totalMatch = text.match(/Total Usages.*?(\d+)/i);
    if (totalMatch) {
      return parseInt(totalMatch[1], 10);
    }
    
    return 0;
  } catch (error) {
    console.log('DEBUG - Error extracting total usages:', error);
    return 0;
  }
}

function extractCriticalUsages(codeImpactResult: any): number {
  try {
    // Try to extract from text response
    const text = codeImpactResult?.text || '';
    const criticalMatch = text.match(/Critical Usages.*?(\d+)/i);
    if (criticalMatch) {
      return parseInt(criticalMatch[1], 10);
    }
    
    return 0;
  } catch (error) {
    console.log('DEBUG - Error extracting critical usages:', error);
    return 0;
  }
}

function extractCodeImpactData(codeImpactResult: any): any {
  try {
    const totalUsages = extractTotalUsages(codeImpactResult);
    const criticalUsages = extractCriticalUsages(codeImpactResult);
    
    // Extract other data from text response
    const text = codeImpactResult?.text || '';
    
    // Extract impact level
    let impactLevel = 'minimal';
    const impactMatch = text.match(/Impact Level.*?(\w+)/i);
    if (impactMatch) {
      impactLevel = impactMatch[1].toLowerCase();
    }
    
    // Extract affected files
    const affectedFiles: string[] = [];
    const fileMatches = text.match(/src\/[^:\s]+\.ts/g) || [];
    fileMatches.forEach(file => {
      if (!affectedFiles.includes(file)) {
        affectedFiles.push(file);
      }
    });
    
    // Extract recommendations with improved pattern matching
    const recommendations: string[] = [];
    console.log('DEBUG - Extracting recommendations from text:', text.substring(0, 500));
    
    // Try multiple patterns to match recommendations
    const patterns = [
      /\*\*Recommendations?\*\*:\s*\n((?:[\s]*- .+(?:\n|$))+)/im, // **Recommendations**: with bullet points
      /(?:Recommendations?|Actions?):\s*\n((?:[\s]*- .+(?:\n|$))+)/im, // Regular format
      /### Recommendations?\s*\n((?:[\s]*- .+(?:\n|$))+)/im, // Markdown header format
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        console.log('DEBUG - Found recommendations with pattern:', pattern.source);
        const recText = match[1];
        const recs = recText.match(/- (.+?)(?:\n|$)/g);
        if (recs) {
          recommendations.push(...recs.map(r => r.replace(/^- /, '').trim()));
        }
        break;
      }
    }
    
    console.log('DEBUG - Extracted recommendations:', recommendations);
    
    // Fallback: Generate recommendations if none found
    if (recommendations.length === 0) {
      console.log('DEBUG - No recommendations extracted, generating fallback recommendations');
      recommendations.push(...generateFallbackRecommendations(text, totalUsages, affectedFiles));
    }
    
    return {
      totalUsages,
      criticalUsages: Array.from({length: criticalUsages}, (_, i) => ({ 
        file: affectedFiles[0] || 'unknown',
        line: 0,
        reason: 'Usage detected'
      })),
      usageByType: { 'function-call': totalUsages },
      impactLevel,
      affectedFiles,
      recommendations,
      projectType: 'typescript',
      score: totalUsages > 0 ? Math.min(10, totalUsages * 2) : 0
    };
  } catch (error) {
    console.log('DEBUG - Error extracting code impact data:', error);
    return {
      totalUsages: 0,
      criticalUsages: [],
      usageByType: {},
      impactLevel: 'minimal',
      affectedFiles: [],
      recommendations: [],
      projectType: 'unknown',
      score: 0
    };
  }
}

// Fallback recommendations generator
function generateFallbackRecommendations(text: string, totalUsages: number, affectedFiles: string[]): string[] {
  const recommendations: string[] = [];
  
  try {
    // Check for major version update
    if (text.includes('major') || text.includes('Major') || /\d+\.\d+\.\d+.*→.*\d+\.\d+\.\d+/.test(text)) {
      recommendations.push('Verify compatibility with current codebase due to major version update');
    }
    
    // Check for Node.js requirements
    if (text.includes('Node.js') || text.includes('nodejs') || text.includes('node ')) {
      recommendations.push('Check Node.js version requirements and update engines field in package.json if needed');
    }
    
    // Check for breaking changes
    if (text.includes('breaking') || text.includes('Breaking')) {
      recommendations.push('Review breaking changes and update affected code accordingly');
    }
    
    // Usage-specific recommendations
    if (totalUsages > 0) {
      recommendations.push(`Test functionality in ${totalUsages} usage location${totalUsages > 1 ? 's' : ''} after update`);
      
      if (affectedFiles.length > 0) {
        const fileNames = affectedFiles.map(f => f.split('/').pop()).join(', ');
        recommendations.push(`Run tests for affected files: ${fileNames}`);
      }
    }
    
    // TypeScript project specific
    if (text.includes('typescript') || text.includes('TypeScript') || affectedFiles.some(f => f.endsWith('.ts'))) {
      recommendations.push('Run TypeScript compiler to check for type compatibility issues');
    }
    
    // Performance related
    if (text.includes('performance') || text.includes('Performance')) {
      recommendations.push('Run performance tests to ensure no regressions');
    }
    
    // API changes
    if (text.includes('API') || text.includes('api') || text.includes('function') || text.includes('method')) {
      recommendations.push('Review API usage and update function calls if signatures changed');
    }
    
    // Fallback general recommendations
    if (recommendations.length === 0) {
      recommendations.push('Run full test suite before merging');
      if (totalUsages > 0) {
        recommendations.push('Manually verify functionality in affected areas');
      }
      recommendations.push('Check changelog for any additional migration steps');
    }
    
  } catch (error) {
    console.log('DEBUG - Error generating fallback recommendations:', error);
    // Ultimate fallback
    recommendations.push('Run tests and verify functionality before merging');
  }
  
  return recommendations.slice(0, 5); // Limit to 5 recommendations
}

// Unified report generation with GitHub links and proper execution stats
async function generateUnifiedReport(assessments: any[], options: {
  format: 'markdown' | 'json';
  language: 'en' | 'ja';
  prInfo: any;
  executionStats?: ExecutionStats;
  includeExecutionStats?: boolean;
}) {
  const { format, language, prInfo, executionStats, includeExecutionStats = true } = options;
  
  if (format === 'json') {
    return generateReport(assessments, options);
  }
  
  // Generate markdown with GitHub links and translation support
  const isJapanese = language === 'ja';
  const overallRisk = getHighestRisk(assessments);
  const riskEmoji = getRiskEmoji(overallRisk);
  
  // Auto-detect repository for GitHub links
  let repository;
  let linkOptions: GitHubLinkOptions | undefined;
  
  try {
    repository = await autoDetectRepository(prInfo);
    if (repository) {
      linkOptions = { repository };
    }
  } catch (error) {
    console.log('DEBUG - Could not auto-detect repository for links:', error);
  }
  
  let markdown = `### ${isJapanese ? 'renovate-safety 分析結果' : 'renovate-safety Analysis'}\n\n`;
  markdown += `**${isJapanese ? '結論' : 'Conclusion'}**: ${riskEmoji} ${overallRisk.toUpperCase()}\n\n`;
  
  // Summary section
  markdown += await generateSummarySection(assessments, isJapanese, linkOptions);
  
  // Individual assessments
  markdown += await generateAssessmentsSection(assessments, isJapanese, linkOptions);
  
  // Recommendations section
  markdown += await generateRecommendationsSection(assessments, overallRisk, isJapanese);
  
  // Execution statistics (using finalized stats)
  if (includeExecutionStats && executionStats) {
    markdown += generateExecutionStatsSection(executionStats, isJapanese);
  }
  
  return {
    format: 'markdown' as const,
    markdown,
  };
}

// Helper function to get risk emoji
function getRiskEmoji(risk: string): string {
  switch (risk.toLowerCase()) {
    case 'safe': return '✅';
    case 'low': return '🟡';
    case 'medium': return '🟠';
    case 'high': return '🔴';
    case 'critical': return '🚨';
    default: return '❓';
  }
}

// Generate summary section with proper GitHub links
async function generateSummarySection(assessments: any[], isJapanese: boolean, linkOptions?: GitHubLinkOptions): Promise<string> {
  let markdown = `#### ${isJapanese ? '📊 概要' : '📊 Summary'}\n\n`;
  
  const riskCounts = assessments.reduce((acc, a) => {
    acc[a.risk.level] = (acc[a.risk.level] || 0) + 1;
    return acc;
  }, {});
  
  // Risk distribution table
  markdown += '| Risk Level | Count |\n|---|---|\n';
  const riskLevels = ['critical', 'high', 'medium', 'low', 'safe'];
  for (const level of riskLevels) {
    if (riskCounts[level] > 0) {
      const emoji = getRiskEmoji(level);
      markdown += `| ${emoji} ${level.toUpperCase()} | ${riskCounts[level]} |\n`;
    }
  }
  markdown += '\n';
  
  return markdown;
}

// Generate assessments section with GitHub links  
async function generateAssessmentsSection(assessments: any[], isJapanese: boolean, linkOptions?: GitHubLinkOptions): Promise<string> {
  let markdown = `#### ${isJapanese ? '📦 パッケージ分析' : '📦 Package Analysis'}\n\n`;
  
  for (const assessment of assessments) {
    const { dependency, overview, codeImpact, risk } = assessment;
    const riskEmoji = getRiskEmoji(risk.level);
    
    markdown += `##### ${dependency.name} ${dependency.fromVersion} → ${dependency.toVersion} ${riskEmoji}\n\n`;
    
    // Library overview - new feature at the top
    if (overview) {
      markdown += `**${isJapanese ? 'ライブラリ概要' : 'Library Overview'}**: ${overview.overview}\n\n`;
      if (overview.category && overview.category !== 'unknown') {
        markdown += `**${isJapanese ? 'カテゴリ' : 'Category'}**: ${overview.category}\n\n`;
      }
    }
    
    // Risk level and impact
    markdown += `**${isJapanese ? 'リスクレベル' : 'Risk Level'}**: ${risk.level.toUpperCase()} (${isJapanese ? 'スコア' : 'Score'}: ${risk.score})\n\n`;
    
    // Usage information with GitHub links
    if (codeImpact && codeImpact.totalUsages > 0) {
      markdown += `**${isJapanese ? '利用箇所' : 'Usage Locations'}**: ${codeImpact.totalUsages} ${isJapanese ? '箇所' : 'locations'}\n\n`;
      
      // Affected files with links
      if (codeImpact.affectedFiles && codeImpact.affectedFiles.length > 0) {
        markdown += `**${isJapanese ? '影響ファイル' : 'Affected Files'}**:\n`;
        
        for (const file of codeImpact.affectedFiles) {
          if (linkOptions) {
            const link = generateMarkdownLink(file, 1, linkOptions);
            markdown += `- ${link}\n`;
          } else {
            markdown += `- ${file}\n`;
          }
        }
        markdown += '\n';
      }
    }
    
    // Translated recommendations
    if (codeImpact && codeImpact.recommendations && codeImpact.recommendations.length > 0) {
      markdown += `**${isJapanese ? '推奨アクション' : 'Recommendations'}**:\n`;
      for (const rec of codeImpact.recommendations) {
        const translatedRec = isJapanese ? await translateRecommendation(rec) : rec;
        markdown += `- ${translatedRec}\n`;
      }
      markdown += '\n';
    }
  }
  
  return markdown;
}

// Generate recommendations section with translation
async function generateRecommendationsSection(assessments: any[], overallRisk: string, isJapanese: boolean): Promise<string> {
  let markdown = `#### ${isJapanese ? '📌 全体的な推奨アクション' : '📌 Overall Recommendations'}\n\n`;
  
  // Generate general recommendations based on overall risk
  const recommendations = [];
  
  if (overallRisk === 'critical' || overallRisk === 'high') {
    recommendations.push('Run comprehensive tests before merging');
    recommendations.push('Consider manual testing for critical functionality');
    recommendations.push('Review breaking changes carefully');
  } else if (overallRisk === 'medium') {
    recommendations.push('Run unit and integration tests');
    recommendations.push('Monitor for any runtime issues');
  } else {
    recommendations.push('Standard testing should be sufficient');
    recommendations.push('Monitor deployment for any unexpected issues');
  }
  
  for (const rec of recommendations) {
    const translatedRec = isJapanese ? await translateRecommendation(rec) : rec;
    markdown += `- ${translatedRec}\n`;
  }
  markdown += '\n';
  
  return markdown;
}

// Generate execution statistics section
function generateExecutionStatsSection(stats: ExecutionStats, isJapanese: boolean): string {
  let markdown = `#### ${isJapanese ? '📊 実行統計' : '📊 Execution Statistics'}\n\n`;
  
  markdown += `| ${isJapanese ? '項目' : 'Metric'} | ${isJapanese ? '値' : 'Value'} |\n`;
  markdown += '|---|---|\n';
  
  if (stats.totalDuration) {
    const duration = Math.round(stats.totalDuration / 1000);
    markdown += `| ${isJapanese ? '実行時間' : 'Duration'} | ${duration}s |\n`;
  }
  
  markdown += `| ${isJapanese ? 'エージェント数' : 'Agents Used'} | ${stats.agents.length} |\n`;
  markdown += `| ${isJapanese ? 'API呼び出し' : 'API Calls'} | ${stats.apiCalls.total} |\n`;
  
  if (stats.apiCalls.estimatedCost !== undefined) {
    const cost = stats.apiCalls.estimatedCost.toFixed(4);
    markdown += `| ${isJapanese ? '推定コスト' : 'Estimated Cost'} | $${cost} |\n`;
  }
  
  markdown += '\n';
  
  return markdown;
}

// Workflow schemas
const workflowInputSchema = z.object({
  prNumber: z.number().describe('PR number to analyze'),
  postMode: z.enum(['always', 'update', 'never']).default('always').describe('When to post comments'),
  format: z.enum(['markdown', 'json']).default('markdown').describe('Output format'),
  language: z.enum(['en', 'ja']).default('en').describe('Output language'),
  threshold: z.number().default(1).describe('Risk threshold for auto-merge'),
});

const workflowOutputSchema = z.object({
  success: z.boolean(),
  assessments: z.array(z.any()),
  report: z.object({
    markdown: z.string().optional(),
    json: z.string().optional(),
    format: z.string(),
  }),
  posted: z.boolean(),
  overallRisk: z.string(),
  executionStats: z.any().optional(),
});

// Output schema (for reference)
export const outputSchema = z.object({
  success: z.boolean(),
  assessments: z.array(z.any()),
  report: z.object({
    markdown: z.string().optional(),
    json: z.string().optional(),
    format: z.string(),
  }),
  posted: z.boolean(),
  overallRisk: z.string(),
});

// Step 1: Get PR Information
const getPRInfoStep = createStep({
  id: 'get-pr-info',
  description: 'Get PR information from GitHub',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    prInfo: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { prNumber, postMode, format, language } = inputData;
    
    console.log(`🔍 Analyzing PR #${prNumber}...`);
    
    // Initialize execution tracking
    const tracker = initializeTracking(prNumber, `analysis_${prNumber}_${Date.now()}`);
    console.log(`📊 Execution tracking initialized for PR #${prNumber}`);
    
    // Track PR Info Agent execution
    const prInfoResult = await trackAgent('PRInfoAgent', 'gpt-4o-mini', async () => {
      return await PRInfoAgent.generateVNext([
        {
          role: 'user',
          content: `Fetch PR information for PR #${prNumber}. Use the getPRInfoTool with prNumber: ${prNumber} and includeBaseRepository: true.`
        }
      ]) as any;
    });
    
    // Extract the tool result from Agent response
    const toolResult = prInfoResult?.steps?.[0]?.toolResults?.[0]?.payload?.result;
    const prInfo = toolResult || { success: false, error: 'Failed to extract PR info from Agent response' };

    if (!prInfo.success || !prInfo.data) {
      throw new Error(`Failed to get PR info: ${prInfo.error || 'Unknown error'}`);
    }

    // Set repository information for tracking
    if (prInfo.data.repository) {
      tracker.setRepository(prInfo.data.repository.owner, prInfo.data.repository.name);
      tracker.setBranchInfo(prInfo.data.base, prInfo.data.head);
    }
    tracker.addDataSource('github-api');

    return {
      prInfo: prInfo.data,
      prNumber,
      postMode,
      format,
      language,
    };
  },
});

// Step 2: Get Dependencies
const getDependenciesStep = createStep({
  id: 'get-dependencies',
  description: 'Get dependency changes and compare info',
  inputSchema: z.object({
    prInfo: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
  }),
  outputSchema: z.object({
    prInfo: z.any(),
    dependencies: z.any(),
    compareResult: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { prInfo } = inputData;
    
    // Using prInfo to access repository info for dependencies
    const owner = prInfo.repository?.owner || 'unknown';
    const repo = prInfo.repository?.name || 'unknown';
    console.log(`Processing dependencies for ${owner}/${repo}`);
    
    // Get dependency changes with tracking
    console.log('📦 Getting dependency changes...');
    const tracker = getCurrentTracker();
    
    const dependenciesResult = await trackAgent('DependencyReviewAgent', 'gpt-4o-mini', async () => {
      return await DependencyReviewAgent.generateVNext([
        {
          role: 'user',
          content: `Review dependency changes for PR #${prInfo.number} in repository ${owner}/${repo}. 
Use the dependencyReviewTool with these parameters:
- owner: ${owner}
- repo: ${repo}
- base: ${prInfo.base}
- head: ${prInfo.head}
Call the dependencyReviewTool now.`
        }
      ]) as any;
    });
    
    // Extract the tool result from Agent response
    const depToolResult = dependenciesResult?.steps?.[0]?.toolResults?.[0]?.payload?.result;
    const dependencies = depToolResult || { success: false, error: 'Failed to extract dependencies from Agent response' };

    // Check if lockfile-only with tracking
    console.log(`🔧 Checking change type for ${owner}/${repo}...`);
    const compareResultResponse = await trackAgent('GitHubCompareAgent', 'gpt-4o-mini', async () => {
      return await GitHubCompareAgent.generateVNext([
        {
          role: 'user',
          content: `Compare branches for ${owner}/${repo} between base ${prInfo.base} and head ${prInfo.head}. Use the githubCompareTool.`
        }
      ]) as any;
    });
    
    // Extract the tool result from Agent response
    const compareToolResult = compareResultResponse?.steps?.[0]?.toolResults?.[0]?.payload?.result;
    const compareResult = compareToolResult || { success: false, error: 'Failed to extract compare result from Agent response' };
    
    // Add data sources
    if (tracker) {
      tracker.addDataSource('dependency-review-api');
      tracker.addDataSource('github-compare-api');
    }

    if (!dependencies.success || !dependencies.data) {
      throw new Error(`Failed to get dependencies: ${dependencies.error || 'Unknown error'}`);
    }

    if (!compareResult.success || !compareResult.data) {
      throw new Error(`Failed to compare branches: ${compareResult.error || 'Unknown error'}`);
    }

    return {
      ...inputData,
      dependencies: dependencies.data,
      compareResult: compareResult.data,
    };
  },
});

// Step 3: Analyze Dependencies with Agents
const analyzeDependenciesStep = createStep({
  id: 'analyze-dependencies',
  description: 'Analyze each dependency using Mastra Agents',
  inputSchema: z.object({
    prInfo: z.any(),
    dependencies: z.any(),
    compareResult: z.any(),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
  }),
  outputSchema: z.object({
    assessments: z.array(z.any()),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
    prInfo: z.any(),
  }),
  execute: async ({ inputData }) => {
    const { dependencies, compareResult } = inputData;
    const tracker = getCurrentTracker();
    
    console.log('⚙️ Analyzing dependencies...');
    const assessments = [];
    
    for (const dep of dependencies) {
      console.log(`📦 Analyzing ${dep.name} ${dep.fromVersion} → ${dep.toVersion}...`);
      
      // Get library overview first
      const overviewResult = await trackAgent('LibraryOverviewAgent', 'gpt-4o-mini', async () => {
        return await LibraryOverviewAgent.generateVNext([
          {
            role: 'user',
            content: inputData.language === 'ja' 
              ? `npm パッケージ「${dep.name}」について日本語で概要を教えてください。JSONフォーマットで返答してください。`
              : `Provide an overview of the npm package "${dep.name}" in JSON format.`
          }
        ]) as any;
      });
      
      // Track ReleaseNotesAgent execution
      const releaseNotesResult = await trackAgent('ReleaseNotesAgent', 'gpt-4o-mini', async () => {
        return await ReleaseNotesAgent.generateVNext([
          {
            role: 'user',
            content: `Analyze ${dep.name} from ${dep.fromVersion} to ${dep.toVersion}`
          }
        ]) as any;
      });

      // Track CodeImpactAgent execution with structured parameters
      const codeImpactResult = await trackAgent('CodeImpactAgent', 'gpt-4o-mini', async () => {
        return await CodeImpactAgent.generateVNext([
          {
            role: 'user',
            content: `Please analyze code impact for the following package:

Package Name: ${dep.name}
Project Path: .
Breaking Changes: ${JSON.stringify(releaseNotesResult?.object?.breakingChanges || [])}

Use the tsUsageScanner and configScanner tools with these exact parameters:
- packageName: "${dep.name}"
- projectPath: "."
- patterns: []`
          }
        ]) as any;
      });

      // Add data sources based on analysis results
      if (tracker) {
        tracker.addDataSource('npm-registry');
        tracker.addDataSource('github-releases');
        tracker.addDataSource('ts-morph-analysis');
        if (releaseNotesResult.object?.sources) {
          releaseNotesResult.object.sources.forEach((source: any) => {
            if (source.status === 'success') {
              tracker.addDataSource(source.type);
            }
          });
        }
      }

      // Risk assessment
      const riskResult = await RiskArbiter.assess({
        packageName: dep.name,
        fromVersion: dep.fromVersion,
        toVersion: dep.toVersion,
        isDevDependency: dep.type === 'devDependencies',
        isTypeDefinition: dep.name.startsWith('@types/'),
        isLockfileOnly: compareResult.isLockfileOnly,
        breakingChanges: releaseNotesResult.object?.breakingChanges?.map((bc: any) => bc.text) || [],
        usageCount: extractTotalUsages(codeImpactResult) || 0,
        hasChangelog: releaseNotesResult.object?.sources?.some((s: any) => s.status === 'success') || false,
        hasDiff: true,
        testCoverage: 0,
        criticalPathUsage: extractCriticalUsages(codeImpactResult) > 0,
      }) as {
        level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
        score: number;
        factors: string[];
        confidence: number;
        mitigationSteps: string[];
        estimatedEffort: string;
        testingScope: string;
      };

      assessments.push({
        dependency: dep,
        overview: overviewResult.object || {
          overview: inputData.language === 'ja' 
            ? `${dep.name}は Node.js エコシステムで使用されるライブラリです。`
            : `${dep.name} is a library used in the Node.js ecosystem.`,
          category: 'unknown',
          mainPurpose: inputData.language === 'ja' 
            ? '詳細な情報を取得できませんでした。'
            : 'Unable to retrieve detailed information.'
        },
        releaseNotes: releaseNotesResult.object,
        codeImpact: extractCodeImpactData(codeImpactResult),
        risk: riskResult,
      });
    }

    return {
      ...inputData,
      assessments,
    };
  },
});

// Step 4: Generate and Post Report
const generateReportStep = createStep({
  id: 'generate-report',
  description: 'Generate report and post to PR',
  inputSchema: z.object({
    assessments: z.array(z.any()),
    prNumber: z.number(),
    postMode: z.string(),
    format: z.string(),
    language: z.string(),
    prInfo: z.any(),
  }),
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const { assessments, prNumber, postMode, format, language, prInfo } = inputData;
    
    // Get current execution statistics
    const tracker = getCurrentTracker();
    let executionStats: ExecutionStats | undefined;
    
    // Generate report using unified generator with finalized execution stats
    console.log('📄 Generating unified report with GitHub links and proper execution stats...');
    
    // Finalize tracking to get accurate statistics BEFORE generating report
    const finalExecutionStats = finalizeTracking();
    console.log('📊 Execution tracking finalized for report generation');
    
    const report = await generateUnifiedReport(assessments, {
      format: format as 'markdown' | 'json',
      language: language as 'en' | 'ja',
      prInfo: {
        number: prInfo.number,
        title: prInfo.title,
        base: prInfo.base,
        head: prInfo.head,
        repository: {
          owner: prInfo.repository?.owner || 'unknown',
          name: prInfo.repository?.name || 'unknown',
        },
      },
      executionStats: finalExecutionStats,
      includeExecutionStats: true,
    });

    // Post to PR (if enabled)
    let posted = false;
    if (postMode !== 'never') {
      console.log('📝 Posting to PR...');
      
      try {
        // Check for existing comment using PRCommentAgent with tracking
        const existingCommentResult = await trackAgent('PRCommentAgent', 'gpt-4o-mini', async () => {
          return await PRCommentAgent.generateVNext([
            {
              role: 'user',
              content: `Check if there's an existing comment from renovate-safety bot on PR #${prInfo.number} in ${prInfo.repository?.owner || 'unknown'}/${prInfo.repository?.name || 'unknown'}. Use the prCommentTool with action: 'find'.`
            }
          ]) as any;
        });
        
        const commentToolResult = existingCommentResult?.steps?.[0]?.toolResults?.[0]?.payload?.result;
        const existingComment = commentToolResult || { exists: false };

        const commentMode = existingComment.exists && postMode === 'update' 
          ? 'update' as const
          : 'create' as const;

        // Use the already finalized report for PR comment (no need to regenerate)
        const reportBody = report.format === 'markdown' ? report.markdown : report.json;

        // Post comment using PRCommentAgent with tracking
        await trackAgent('PRCommentAgent', 'gpt-4o-mini', async () => {
          return await PRCommentAgent.generateVNext([
            {
              role: 'user',
              content: `Post a comment to PR #${prInfo.number} in ${prInfo.repository?.owner || 'unknown'}/${prInfo.repository?.name || 'unknown'}. Use the prCommentTool with action: '${commentMode}' and body: ${JSON.stringify(reportBody)}`
            }
          ]) as any;
        });

        // Add label based on highest risk using PRLabelAgent with tracking
        const highestRisk = getHighestRisk(assessments);
        await trackAgent('PRLabelAgent', 'gpt-4o-mini', async () => {
          return await PRLabelAgent.generateVNext([
            {
              role: 'user',
              content: `Add label 'renovate-safety:${highestRisk}' to PR #${prInfo.number} in ${prInfo.repository?.owner || 'unknown'}/${prInfo.repository?.name || 'unknown'}. Use the prLabelTool.`
            }
          ]) as any;
        });

        posted = true;
      } catch (error) {
        console.warn('Failed to post to PR:', error);
      }
    }

    // Save report to file
    await saveReport(report, prNumber);
    
    // Display final statistics (already finalized earlier)
    if (finalExecutionStats) {
      console.log(`⏱️  Total analysis time: ${Math.round((finalExecutionStats.totalDuration || 0) / 1000)}s`);
      console.log(`🔧 Agents used: ${finalExecutionStats.agents.length}`);
      console.log(`🌐 API calls: ${finalExecutionStats.apiCalls.total}`);
      console.log(`DEBUG - Raw cost value: ${finalExecutionStats.apiCalls.estimatedCost} (type: ${typeof finalExecutionStats.apiCalls.estimatedCost})`);
      console.log(`💸 Estimated cost: $${(finalExecutionStats.apiCalls.estimatedCost || 0).toFixed(4)}`);
    }
    
    const overallRisk = getHighestRisk(assessments);
    console.log(`✅ Analysis complete - Overall risk: ${overallRisk.toUpperCase()}`);

    return {
      success: true,
      assessments,
      report,
      posted,
      overallRisk,
      executionStats: finalExecutionStats,
    };
  },
});

// Create the Workflow
export const analyzeRenovatePRWorkflow = createWorkflow({
  id: 'analyze-renovate-pr',
  description: 'Analyze Renovate PR for breaking changes and risk assessment',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
.then(getPRInfoStep)
.then(getDependenciesStep) 
.then(analyzeDependenciesStep)
.then(generateReportStep)
.commit();

// Legacy function wrapper for backwards compatibility
export async function analyzeRenovatePR(input: z.infer<typeof workflowInputSchema>) {
  const workflow = analyzeRenovatePRWorkflow;
  const run = await workflow.createRunAsync();
  const result = await run.start({ inputData: input });
  
  if (result.status !== 'success') {
    throw new Error(`Workflow failed with status: ${result.status}`);
  }
  
  return result.result;
}

// Export types
export type AnalyzeRenovatePRInput = z.infer<typeof workflowInputSchema>;
export type AnalyzeRenovatePROutput = z.infer<typeof workflowOutputSchema>;