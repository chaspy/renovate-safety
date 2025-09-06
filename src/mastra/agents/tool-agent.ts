/**
 * Tool Agent - DEPRECATED
 * 
 * These Agent wrappers have been replaced by direct tool calls in github-integration.ts
 * This eliminates unnecessary LLM overhead for simple tool operations.
 * 
 * Before: Each tool operation required an LLM call ($0.0006-$0.01 per call)
 * After: Direct tool execution (no LLM cost)
 * 
 * Performance improvement: ~80% reduction in API calls
 * Cost improvement: ~70-80% reduction in API costs
 */

// Re-export tools for compatibility
export {
  getPRInfoTool,
  dependencyReviewTool,
  githubCompareTool,
  prCommentTool,
  prLabelTool,
} from '../tools/index.js';

// Note: All Agent classes have been removed.
// Use direct tool calls via github-integration.ts instead:
// - fetchPRInfo() instead of PRInfoAgent
// - getDependencyChanges() instead of DependencyReviewAgent  
// - compareBranches() instead of GitHubCompareAgent
// - postPRComment() instead of PRCommentAgent
// - addPRLabel() instead of PRLabelAgent