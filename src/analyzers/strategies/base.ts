import type { PackageUpdate } from '../../types/index.js';

/**
 * Analysis result with confidence score
 */
export interface StrategyAnalysisResult {
  content: string;
  breakingChanges: string[];
  confidence: number; // 0-1
  source: string;
  metadata?: Record<string, any>;
}

/**
 * Base strategy for fallback analysis
 */
export abstract class AnalysisStrategy {
  abstract name: string;
  
  /**
   * Try to analyze package changes using this strategy
   */
  abstract tryAnalyze(pkg: PackageUpdate): Promise<StrategyAnalysisResult | null>;
  
  /**
   * Check if this strategy is applicable
   */
  abstract isApplicable(pkg: PackageUpdate): Promise<boolean>;
}

/**
 * Combines multiple analysis strategies with fallback
 */
export class FallbackAnalysisChain {
  private readonly strategies: AnalysisStrategy[] = [];
  
  addStrategy(strategy: AnalysisStrategy): void {
    this.strategies.push(strategy);
  }
  
  async analyze(pkg: PackageUpdate): Promise<StrategyAnalysisResult> {
    const results: StrategyAnalysisResult[] = [];
    
    // Try each strategy
    for (const strategy of this.strategies) {
      if (await strategy.isApplicable(pkg)) {
        try {
          const result = await strategy.tryAnalyze(pkg);
          if (result) {
            results.push(result);
            
            // If high confidence, return immediately
            if (result.confidence > 0.8) {
              return result;
            }
          }
        } catch (error) {
          console.warn(`Strategy ${strategy.name} failed:`, error);
        }
      }
    }
    
    // Combine partial results if no high-confidence result found
    return this.combineResults(results);
  }
  
  private combineResults(results: StrategyAnalysisResult[]): StrategyAnalysisResult {
    if (results.length === 0) {
      return {
        content: 'No information available',
        breakingChanges: [],
        confidence: 0,
        source: 'none'
      };
    }
    
    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);
    
    // Combine breaking changes from all sources
    const allBreakingChanges = new Set<string>();
    let combinedContent = '';
    let totalConfidence = 0;
    const sources: string[] = [];
    
    for (const result of results) {
      result.breakingChanges.forEach(bc => allBreakingChanges.add(bc));
      if (result.content && result.confidence > 0.3) {
        combinedContent += `\n\n### ${result.source}\n${result.content}`;
        sources.push(result.source);
      }
      totalConfidence += result.confidence;
    }
    
    return {
      content: combinedContent.trim() || 'Limited information available',
      breakingChanges: Array.from(allBreakingChanges),
      confidence: Math.min(totalConfidence / results.length, 1),
      source: sources.join(', '),
      metadata: {
        sourceCount: results.length,
        sources
      }
    };
  }
}