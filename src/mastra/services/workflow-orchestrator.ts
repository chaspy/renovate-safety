/**
 * Workflow Orchestrator
 * Handles the orchestration of dependency analysis workflow
 */

import { ReleaseNotesAgent } from '../agents/release-notes-agent.js';
import { CodeImpactAgent } from '../agents/code-impact-agent.js';
import { generateLibraryOverview } from '../agents/library-overview-agent.js';
import { RiskArbiter } from '../tools/index.js';
import { trackAgent, getCurrentTracker } from '../tools/execution-tracker.js';
import { usageImpactAnalyzer, type UsageImpact } from '../tools/usage-impact-analyzer.js';

export type DependencyAssessment = {
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
  usageImpact?: UsageImpact; // Add usage impact analysis
  risk: {
    level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    score: number;
    factors: string[];
    confidence: number;
    mitigationSteps: string[];
    estimatedEffort: string;
    testingScope: string;
  };
};

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
    // Limit characters to prevent ReDoS with external input
    const totalMatch = /Total Usages[^\n]{0,50}?(\d+)/i.exec(text);
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
    // Limit characters to prevent ReDoS with external input
    const criticalMatch = /Critical Usages[^\n]{0,50}?(\d+)/i.exec(text);
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
    // Limit characters to prevent ReDoS with external input
    const impactMatch = /Impact Level[^\n]{0,50}?(\w+)/i.exec(text);
    if (impactMatch) {
      impactLevel = impactMatch[1].toLowerCase();
    }
    
    // Extract affected files with more context
    const affectedFiles: string[] = [];
    const fileMatches = text.match(/src\/[^:\s]+\.(ts|js|tsx|jsx)/g) || [];
    fileMatches.forEach((file: string) => {
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
      /\*\*Recommendations?\*\*:\s*\n([\s\S]*?)(?=\n\n|\n#|\n\*|$)/im,
      /(?:Recommendations?|Actions?):\s*\n([\s\S]*?)(?=\n\n|\n#|\n\*|$)/im,
      /### Recommendations?\s*\n([\s\S]*?)(?=\n\n|\n#|\n\*|$)/im,
    ];
    
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        const recText = match[1];
        // Limit line length to prevent ReDoS
        const recs = recText.match(/- ([^\n]{1,500})(?:\n|$)/g);
        if (recs) {
          recommendations.push(...recs.map(r => r.replace(/^- /, '').trim()));
        }
        break;
      }
    }
    
    // Enhanced fallback: Generate context-aware recommendations
    if (recommendations.length === 0) {
      recommendations.push(...generateContextAwareRecommendations(text, totalUsages, affectedFiles));
    }
    
    return {
      totalUsages,
      criticalUsages: Array.from({length: criticalUsages}, () => ({ 
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

// Extract detailed usage information from analysis text with enhanced parsing
function extractUsageDetails(text: string): Array<{file: string, usage: string, context: string, description?: string}> {
  const usageDetails: Array<{file: string, usage: string, context: string, description?: string}> = [];
  
  try {
    // Extract import statements with safer pattern (avoids ReDoS)
    const importMatches = text.match(/import[^;\n]+from\s+['"`][^'"`]+['"`]/g) || [];
    importMatches.forEach(importStmt => {
      const packageMatch = /from\s+['"`]([^'"`]*)['"`]/.exec(importStmt);
      const importedItemsMatch = /import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))/.exec(importStmt);
      
      if (packageMatch) {
        let description = 'パッケージをインポート';
        if (importedItemsMatch) {
          const namedImports = importedItemsMatch[1];
          const namespaceImport = importedItemsMatch[2];
          const defaultImport = importedItemsMatch[3];
          
          if (namedImports) {
            const items = namedImports.split(',').map(s => s.trim()).filter(Boolean);
            description = `${items.join(', ')}をインポート`;
          } else if (namespaceImport) {
            description = `${namespaceImport}として名前空間インポート`;
          } else if (defaultImport) {
            description = `${defaultImport}としてデフォルトインポート`;
          }
        }
        
        usageDetails.push({
          file: 'unknown',
          usage: 'import',
          context: importStmt.trim(),
          description
        });
      }
    });
    
    // Extract function calls with safer pattern (avoids ReDoS)
    // Limit whitespace and content inside parentheses to prevent ReDoS
    const functionCallMatches = text.match(/\w+\s{0,5}\([^)]{0,100}\)/g) || [];
    functionCallMatches.slice(0, 4).forEach(call => {
      let description = '関数を実行';
      
      // Analyze the function call pattern
      if (call.includes('pLimit') || call.includes('p-limit')) {
        description = '同時実行数制限の設定・実行';
      } else if (call.includes('async') || call.includes('await')) {
        description = '非同期処理の実行';
      } else if (call.includes('Promise')) {
        description = 'Promise処理の実行';
      }
      
      usageDetails.push({
        file: 'unknown',
        usage: 'function-call',
        context: call.trim(),
        description
      });
    });
    
    // Extract variable assignments with more context
    // Limit content to prevent ReDoS with external input
    const assignmentMatches = text.match(/(?:const|let|var)\s{1,5}\w+\s{0,5}=[^;\n]{0,200}[;\n]/g) || [];
    assignmentMatches.slice(0, 3).forEach(assignment => {
      let description = '変数への代入';
      
      if (assignment.includes('pLimit') || assignment.includes('limit')) {
        description = '同時実行制限の設定を変数に格納';
      } else if (assignment.includes('async') || assignment.includes('await')) {
        description = '非同期処理の結果を変数に格納';
      }
      
      usageDetails.push({
        file: 'unknown',
        usage: 'assignment',
        context: assignment.trim(),
        description
      });
    });

    // Extract function definitions with safer pattern (avoids ReDoS)
    const functionDefMatches = text.match(/(function\s+\w+|const\s+\w+\s*=|async\s+function)/g) || [];
    functionDefMatches.slice(0, 2).forEach(funcDef => {
      usageDetails.push({
        file: 'unknown',
        usage: 'function-definition',
        context: funcDef.trim(),
        description: 'パッケージを使用する関数を定義'
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
  affectedFiles: string[]
): string[] {
  const recommendations: string[] = [];
  
  try {
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

  // Extract breaking changes from ReleaseNotesAgent result (fallback to text parsing)
  const extractedReleaseNotes = extractReleaseNotesData(releaseNotesResult);

  // Phase 2.5: Analyze actual usage impact of breaking changes
  let usageImpact: UsageImpact | null = null;
  if (extractedReleaseNotes.breakingChanges && extractedReleaseNotes.breakingChanges.length > 0) {
    try {
      console.log(`🔍 Analyzing actual usage impact for ${dep.name}...`);
      
      // Convert breaking changes to the format expected by UsageImpactAnalyzer
      const breakingChangesForAnalysis = extractedReleaseNotes.breakingChanges.map((bc: any) => ({
        text: typeof bc === 'string' ? bc : bc.text || bc.description || String(bc),
        category: bc.category || 'api-change'
      }));
      
      usageImpact = await usageImpactAnalyzer.analyzeImpact(
        dep.name,
        breakingChangesForAnalysis,
        process.cwd()
      );
      
      console.log(`✅ Usage impact analysis complete:`, {
        affected: usageImpact.isAffected,
        riskLevel: usageImpact.riskLevel,
        confidence: usageImpact.confidence,
        affectedFiles: usageImpact.affectedFiles.length
      });
    } catch (error) {
      console.warn('Error analyzing usage impact:', error);
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
    breakingChanges: extractedReleaseNotes.breakingChanges?.map((bc: any) => bc.text) || [],
    usageCount: extractTotalUsages(codeImpactResult) || 0,
    hasChangelog: extractedReleaseNotes.sources?.some((s: any) => s.status === 'success') || false,
    hasDiff: true,
    testCoverage: 0,
    criticalPathUsage: extractCriticalUsages(codeImpactResult) > 0,
    // Enhanced risk factors based on usage impact analysis
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
    releaseNotes: extractedReleaseNotes,
    codeImpact: extractCodeImpactData(codeImpactResult),
    usageImpact: usageImpact || undefined, // Include usage impact analysis
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

// Extract release notes data from ReleaseNotesAgent result (with fallback to text parsing)
function extractReleaseNotesData(releaseNotesResult: any): any {
  try {
    // First, try to use structured output if available
    if (releaseNotesResult.object?.breakingChanges) {
      return releaseNotesResult.object;
    }
    
    // Fallback: Parse from text field
    if (releaseNotesResult.text) {
      const parsedData = parseReleaseNotesFromText(releaseNotesResult.text);
      if (parsedData) {
        return parsedData;
      }
    }
    
    // Last resort: return empty structure
    return {
      breakingChanges: [],
      migrationSteps: [],
      riskLevel: 'medium',
      summary: 'Unable to extract release notes data',
      sources: []
    };
  } catch (error) {
    console.warn('Error extracting release notes data:', error);
    return {
      breakingChanges: [],
      migrationSteps: [],
      riskLevel: 'medium', 
      summary: 'Error parsing release notes',
      sources: []
    };
  }
}

// Parse release notes data from text field
function parseReleaseNotesFromText(text: string): any {
  try {
    // Look for JSON in various formats
    const jsonPatterns = [
      /```json\n([\s\S]*?)\n```/,
      // Safer pattern to avoid ReDoS - limit content length
      /\{[^}]{0,1000}"breakingChanges"[^}]{0,1000}\}/,
      /### Structured Output[^\n]*\n```json\n([\s\S]{0,50000}?)\n```/
    ];
    
    for (const pattern of jsonPatterns) {
      const match = pattern.exec(text);
      if (match) {
        try {
          const jsonStr = match[1] || match[0];
          const parsed = JSON.parse(jsonStr);
          
          // Validate that it has the expected structure
          if (parsed.breakingChanges !== undefined) {
            return parsed;
          }
        } catch (jsonError) {
          // Continue to next pattern if JSON parsing fails
          console.debug('JSON parsing failed for pattern, trying next:', jsonError);
          continue;
        }
      }
    }
    
    // If JSON parsing fails, try to extract key information from text
    return extractFromPlainText(text);
  } catch (error) {
    console.warn('Error parsing release notes from text:', error);
    return null;
  }
}

// Extract breaking changes information from plain text
function extractFromPlainText(text: string): any {
  const breakingChanges: any[] = [];
  let riskLevel = 'low';
  const sources: any[] = [];
  
  // Look for breaking change indicators in text
  const breakingPatterns = [
    /Node\.js requirement raised from ([^"]+) to ([^"]+)/gi,
    /Export structure changed/gi,
    /Functions removed or renamed/gi,
    /API methods? (removed|added|changed)/gi,
    /Breaking[:\s]+([^\n]+)/gi
  ];
  
  for (const pattern of breakingPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let severity = 'breaking';
      let changeText = match[0];
      
      // Special handling for Node.js requirement changes
      if (match[1] && match[2]) {
        severity = 'critical';
        changeText = `Node.js requirement raised from ${match[1]} to ${match[2]}`;
        riskLevel = 'high';
      } else if (changeText.includes('Node.js requirement')) {
        severity = 'critical';
        riskLevel = 'high';
      }
      
      breakingChanges.push({
        text: changeText,
        severity,
        source: 'text-extraction'
      });
    }
  }
  
  // Look for sources mentioned in text
  if (text.includes('npm Diff Tool') || text.includes('npmDiffTool')) {
    sources.push({ type: 'npm-diff', status: 'success' });
  }
  if (text.includes('GitHub Releases') || text.includes('githubReleasesFetcher')) {
    sources.push({ type: 'github-releases', status: 'success' });
  }
  if (text.includes('Changelog') || text.includes('changelogFetcher')) {
    sources.push({ type: 'changelog', status: 'success' });
  }
  
  return {
    breakingChanges,
    migrationSteps: [],
    riskLevel: breakingChanges.length > 0 ? riskLevel : 'low',
    summary: `Extracted ${breakingChanges.length} breaking changes from release notes analysis`,
    sources
  };
}