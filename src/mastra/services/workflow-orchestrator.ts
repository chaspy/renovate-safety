/**
 * Workflow Orchestrator
 * Handles the orchestration of dependency analysis workflow
 */

import { ReleaseNotesAgent } from '../agents/release-notes-agent.js';
import { CodeImpactAgent } from '../agents/code-impact-agent.js';
import { generateLibraryOverview } from '../agents/library-overview-agent.js';
import { RiskArbiter } from '../tools/index.js';
import { trackAgent, getCurrentTracker } from '../tools/execution-tracker.js';

export interface DependencyAssessment {
  dependency: {
    name: string;
    fromVersion: string;
    toVersion: string;
    type: string;
  };
  overview: {
    overview: string;
    category: string;
    mainPurpose: string;
  };
  releaseNotes: any;
  codeImpact: any;
  risk: {
    level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    score: number;
    factors: string[];
    confidence: number;
    mitigationSteps: string[];
    estimatedEffort: string;
    testingScope: string;
  };
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
    console.warn('Error extracting total usages:', error);
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
    console.warn('Error extracting critical usages:', error);
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
    
    // Extract affected files with more context
    const affectedFiles: string[] = [];
    const fileMatches = text.match(/src\/[^:\s]+\.(ts|js|tsx|jsx)/g) || [];
    fileMatches.forEach(file => {
      if (!affectedFiles.includes(file)) {
        affectedFiles.push(file);
      }
    });
    
    // Extract detailed usage information
    const usageDetails = extractUsageDetails(text);
    
    // Extract recommendations with improved pattern matching
    const recommendations: string[] = [];
    
    // Try multiple patterns to match recommendations
    const patterns = [
      /\*\*Recommendations?\*\*:\s*\n((?:[\s]*- .+(?:\n|$))+)/im,
      /(?:Recommendations?|Actions?):\s*\n((?:[\s]*- .+(?:\n|$))+)/im,
      /### Recommendations?\s*\n((?:[\s]*- .+(?:\n|$))+)/im,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const recText = match[1];
        const recs = recText.match(/- (.+?)(?:\n|$)/g);
        if (recs) {
          recommendations.push(...recs.map(r => r.replace(/^- /, '').trim()));
        }
        break;
      }
    }
    
    // Enhanced fallback: Generate context-aware recommendations
    if (recommendations.length === 0) {
      recommendations.push(...generateContextAwareRecommendations(text, totalUsages, affectedFiles, usageDetails));
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
      usageDetails, // Add usage details
      recommendations,
      projectType: 'typescript',
      score: totalUsages > 0 ? Math.min(10, totalUsages * 2) : 0
    };
  } catch (error) {
    console.warn('Error extracting code impact data:', error);
    return {
      totalUsages: 0,
      criticalUsages: [],
      usageByType: {},
      impactLevel: 'minimal',
      affectedFiles: [],
      usageDetails: [],
      recommendations: [],
      projectType: 'unknown',
      score: 0
    };
  }
}

// Extract detailed usage information from analysis text
function extractUsageDetails(text: string): Array<{file: string, usage: string, context: string}> {
  const usageDetails: Array<{file: string, usage: string, context: string}> = [];
  
  try {
    // Extract import statements and their context
    const importMatches = text.match(/import.*?from\s+['"`][^'"`]*['"`]/g) || [];
    importMatches.forEach(importStmt => {
      const match = importStmt.match(/from\s+['"`]([^'"`]*)['"`]/);
      if (match) {
        usageDetails.push({
          file: 'unknown',
          usage: 'import',
          context: importStmt.trim()
        });
      }
    });
    
    // Extract function calls and their context  
    const functionCallMatches = text.match(/\w+\([^)]*\)/g) || [];
    functionCallMatches.slice(0, 3).forEach(call => { // Limit to first 3 for brevity
      usageDetails.push({
        file: 'unknown',
        usage: 'function-call',
        context: call.trim()
      });
    });
    
    // Extract variable assignments
    const assignmentMatches = text.match(/(?:const|let|var)\s+\w+\s*=.*?[;\n]/g) || [];
    assignmentMatches.slice(0, 2).forEach(assignment => { // Limit to first 2
      usageDetails.push({
        file: 'unknown',
        usage: 'assignment',
        context: assignment.trim()
      });
    });
    
  } catch (error) {
    console.warn('Error extracting usage details:', error);
  }
  
  return usageDetails;
}

// Generate context-aware recommendations based on usage patterns
function generateContextAwareRecommendations(
  text: string, 
  totalUsages: number, 
  affectedFiles: string[], 
  usageDetails: Array<{file: string, usage: string, context: string}>
): string[] {
  const recommendations: string[] = [];
  
  try {
    // Analyze specific usage patterns for targeted recommendations
    const hasImport = usageDetails.some(u => u.usage === 'import');
    const hasFunctionCalls = usageDetails.some(u => u.usage === 'function-call');
    const hasAssignments = usageDetails.some(u => u.usage === 'assignment');
    
    // Check for specific patterns in the text that indicate usage scenarios
    const isParallelProcessing = text.includes('parallel') || text.includes('concurrent') || text.includes('limit');
    const isAPIRelated = text.includes('api') || text.includes('http') || text.includes('request');
    const isFileRelated = text.includes('file') || text.includes('fs') || text.includes('read');
    
    // Generate specific recommendations based on patterns
    if (isParallelProcessing) {
      recommendations.push('並列処理の制御設定を確認し、適切な同時実行数が設定されているか検証してください');
    }
    
    if (isAPIRelated) {
      recommendations.push('API呼び出しのレート制限やエラーハンドリングが適切に実装されているか確認してください');
    }
    
    if (isFileRelated) {
      recommendations.push('ファイル操作の同時実行制限が適切に機能しているかテストしてください');
    }
    
    // Check for breaking changes specific to common libraries
    if (text.includes('p-limit') || text.includes('pLimit')) {
      recommendations.push('p-limit v7では引数の型やエラーハンドリングが変更されている可能性があるため、実装を確認してください');
    }
    
    // Add file-specific recommendations
    if (affectedFiles.length > 0) {
      const parallelHelperFile = affectedFiles.find(f => f.includes('parallel'));
      if (parallelHelperFile) {
        recommendations.push('parallel-helpers.tsの実装を確認し、同時実行制御のロジックが正しく動作するかテストしてください');
      }
    }
    
    // Fallback to usage-specific recommendations
    if (recommendations.length === 0) {
      if (totalUsages > 0) {
        recommendations.push(`${totalUsages}箇所の利用を対象に、更新後の動作を個別にテストしてください`);
      }
      recommendations.push('パッケージの最新のドキュメントを確認し、API変更や廃止予定機能がないか確認してください');
    }
    
  } catch (error) {
    console.warn('Error generating context-aware recommendations:', error);
    recommendations.push('更新による影響を慎重にテストしてください');
  }
  
  return recommendations.slice(0, 4); // Limit to 4 recommendations
}

// Fallback recommendations generator (legacy - now using generateContextAwareRecommendations)
function generateFallbackRecommendations(text: string, totalUsages: number, affectedFiles: string[]): string[] {
  // This function is kept for backwards compatibility but is no longer the primary recommendation generator
  return [
    'パッケージ更新の影響を慎重にテストしてください',
    '関連するテストケースを実行してください'
  ];
}

/**
 * Analyze a single dependency with parallel agent execution where possible
 */
export async function analyzeDependency(
  dep: any,
  compareResult: any,
  language: 'en' | 'ja' = 'en'
): Promise<DependencyAssessment> {
  console.log(`📦 Analyzing ${dep.name} ${dep.fromVersion} → ${dep.toVersion}...`);
  
  // Phase 1: Get overview and release notes in parallel
  const [overviewResult, releaseNotesResult] = await Promise.all([
    // Use direct function call instead of Agent for simple operations
    generateLibraryOverview(dep.name, language),
    
    trackAgent('ReleaseNotesAgent', 'gpt-4o-mini', async () => {
      return await ReleaseNotesAgent.generateVNext([
        {
          role: 'user',
          content: `Analyze ${dep.name} from ${dep.fromVersion} to ${dep.toVersion}`
        }
      ]) as any;
    })
  ]);

  // Phase 2: Code impact analysis (depends on release notes)
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

  // Add data sources to tracker
  const tracker = getCurrentTracker();
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

  // Phase 3: Risk assessment
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

  return {
    dependency: dep,
    overview: overviewResult,
    releaseNotes: releaseNotesResult.object,
    codeImpact: extractCodeImpactData(codeImpactResult),
    risk: riskResult,
  };
}

/**
 * Analyze multiple dependencies with improved parallelization
 */
export async function analyzeDependencies(
  dependencies: any[],
  compareResult: any,
  language: 'en' | 'ja' = 'en',
  concurrency: number = 3
): Promise<DependencyAssessment[]> {
  console.log(`⚙️ Analyzing ${dependencies.length} dependencies with concurrency ${concurrency}...`);
  
  const assessments: DependencyAssessment[] = [];
  
  // Process dependencies in batches to avoid overwhelming the API
  for (let i = 0; i < dependencies.length; i += concurrency) {
    const batch = dependencies.slice(i, i + concurrency);
    
    const batchResults = await Promise.all(
      batch.map(dep => analyzeDependency(dep, compareResult, language))
    );
    
    assessments.push(...batchResults);
  }
  
  return assessments;
}