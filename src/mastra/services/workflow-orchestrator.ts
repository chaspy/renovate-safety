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
    
    // Fallback: Generate recommendations if none found
    if (recommendations.length === 0) {
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
    console.warn('Error extracting code impact data:', error);
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
    
    // Usage-specific recommendations
    if (totalUsages > 0) {
      recommendations.push(`Test functionality in ${totalUsages} usage location${totalUsages > 1 ? 's' : ''} after update`);
      
      if (affectedFiles.length > 0) {
        const fileNames = affectedFiles.map(f => f.split('/').pop()).join(', ');
        recommendations.push(`Run tests for affected files: ${fileNames}`);
      }
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
    console.warn('Error generating fallback recommendations:', error);
    recommendations.push('Run tests and verify functionality before merging');
  }
  
  return recommendations.slice(0, 5);
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