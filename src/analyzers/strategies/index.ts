import { FallbackAnalysisChain } from './base.js';
import { GitHubReleasesStrategy } from './GitHubReleasesStrategy.js';
import { GitCommitAnalysisStrategy } from './GitCommitAnalysisStrategy.js';
import { NpmDiffStrategy } from './NpmDiffStrategy.js';

export function createDefaultAnalysisChain(): FallbackAnalysisChain {
  const chain = new FallbackAnalysisChain();
  
  // Add strategies in priority order
  chain.addStrategy(new NpmDiffStrategy());
  chain.addStrategy(new GitHubReleasesStrategy());
  chain.addStrategy(new GitCommitAnalysisStrategy());
  
  return chain;
}

export * from './base.js';