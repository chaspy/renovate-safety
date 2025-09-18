/**
 * Execution Tracker
 * Tracks agent executions, tool calls, and performance statistics
 */

export type AgentExecution = {
  agentName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  success: boolean;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  toolCalls?: ToolExecution[];
};

export type ToolExecution = {
  toolName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  success: boolean;
  error?: string;
  inputParams?: Record<string, any>;
  outputData?: any;
};

export type ExecutionStats = {
  analysisId: string;
  prNumber: number;
  startTime: Date;
  endTime?: Date;
  totalDuration?: number;
  repository?: {
    owner: string;
    name: string;
  };
  branch?: string;
  commitHash?: string;
  agents: AgentExecution[];
  tools: ToolExecution[];
  apiCalls: {
    total: number;
    byModel: Record<string, number>;
    totalTokens: number;
    estimatedCost?: number;
  };
  dataSourcesUsed: string[];
  cacheHits?: number;
  cacheMisses?: number;
};

class ExecutionTracker {
  private readonly stats: ExecutionStats;
  private readonly activeAgents: Map<string, AgentExecution> = new Map();
  private readonly activeTools: Map<string, ToolExecution> = new Map();

  constructor(prNumber: number, analysisId?: string) {
    this.stats = {
      analysisId: analysisId || `analysis_${Date.now()}`,
      prNumber,
      startTime: new Date(),
      agents: [],
      tools: [],
      apiCalls: {
        total: 0,
        byModel: {},
        totalTokens: 0
      },
      dataSourcesUsed: []
    };
  }

  /**
   * Start tracking an agent execution
   */
  startAgent(agentName: string, model?: string): string {
    const executionId = `${agentName}_${Date.now()}`;
    const execution: AgentExecution = {
      agentName,
      startTime: new Date(),
      success: false,
      model,
      toolCalls: []
    };
    
    this.activeAgents.set(executionId, execution);
    return executionId;
  }

  /**
   * End tracking an agent execution
   */
  endAgent(executionId: string, success: boolean, error?: string, tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): void {
    const execution = this.activeAgents.get(executionId);
    if (!execution) {
      console.warn(`Agent execution ${executionId} not found`);
      return;
    }

    execution.endTime = new Date();
    execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
    execution.success = success;
    execution.error = error;

    if (tokenUsage) {
      execution.inputTokens = tokenUsage.inputTokens;
      execution.outputTokens = tokenUsage.outputTokens;
      execution.totalTokens = tokenUsage.totalTokens;

      // Update API call statistics
      this.stats.apiCalls.total++;
      this.stats.apiCalls.totalTokens += tokenUsage.totalTokens || 0;
      
      if (execution.model) {
        this.stats.apiCalls.byModel[execution.model] = 
          (this.stats.apiCalls.byModel[execution.model] || 0) + 1;
      }
    }

    this.stats.agents.push({ ...execution });
    this.activeAgents.delete(executionId);
  }

  /**
   * Start tracking a tool execution
   */
  startTool(toolName: string, inputParams?: Record<string, any>): string {
    const executionId = `${toolName}_${Date.now()}`;
    const execution: ToolExecution = {
      toolName,
      startTime: new Date(),
      success: false,
      inputParams
    };
    
    this.activeTools.set(executionId, execution);
    return executionId;
  }

  /**
   * End tracking a tool execution
   */
  endTool(executionId: string, success: boolean, outputData?: any, error?: string): void {
    const execution = this.activeTools.get(executionId);
    if (!execution) {
      console.warn(`Tool execution ${executionId} not found`);
      return;
    }

    execution.endTime = new Date();
    execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
    execution.success = success;
    execution.outputData = outputData;
    execution.error = error;

    this.stats.tools.push({ ...execution });
    this.activeTools.delete(executionId);

    // Add tool call to the currently active agent if any
    const activeAgent = Array.from(this.activeAgents.values()).find(agent => 
      !agent.endTime && agent.toolCalls
    );
    if (activeAgent) {
      activeAgent.toolCalls!.push({ ...execution });
    }
  }

  /**
   * Add a data source that was used
   */
  addDataSource(source: string): void {
    if (!this.stats.dataSourcesUsed.includes(source)) {
      this.stats.dataSourcesUsed.push(source);
    }
  }

  /**
   * Set repository information
   */
  setRepository(owner: string, name: string): void {
    this.stats.repository = { owner, name };
  }

  /**
   * Set branch and commit information
   */
  setBranchInfo(branch: string, commitHash?: string): void {
    this.stats.branch = branch;
    this.stats.commitHash = commitHash;
  }

  /**
   * Record cache hit/miss
   */
  recordCacheHit(): void {
    this.stats.cacheHits = (this.stats.cacheHits || 0) + 1;
  }

  recordCacheMiss(): void {
    this.stats.cacheMisses = (this.stats.cacheMisses || 0) + 1;
  }

  /**
   * Finalize tracking and get statistics
   */
  finalize(): ExecutionStats {
    this.stats.endTime = new Date();
    this.stats.totalDuration = this.stats.endTime.getTime() - this.stats.startTime.getTime();

    // Calculate accurate cost based on model pricing and input/output token breakdown
    this.stats.apiCalls.estimatedCost = this.calculateAccurateCost();

    return { ...this.stats };
  }

  /**
   * Calculate accurate cost based on model pricing and input/output token breakdown
   */
  private calculateAccurateCost(): number {
    let totalCost = 0;
    
    // Removed debug logging - use structured logging in production
    
    // Calculate cost for each agent execution
    for (const agent of this.stats.agents) {
      if (!agent.inputTokens || !agent.outputTokens || !agent.model) {
        console.log(`DEBUG - Skipping agent ${agent.agentName} - missing data (input:${!!agent.inputTokens}, output:${!!agent.outputTokens}, model:${!!agent.model})`);
        continue;
      }
      
      const modelKey = agent.model.toLowerCase();
      const pricing = MODEL_PRICING[modelKey] || MODEL_PRICING['default'];
      
      const inputCost = (agent.inputTokens / 1000) * pricing.inputPrice;
      const outputCost = (agent.outputTokens / 1000) * pricing.outputPrice;
      const agentCost = inputCost + outputCost;
      
      console.log(`DEBUG - ${agent.agentName}: ${agent.inputTokens}+${agent.outputTokens}=${agent.totalTokens} tokens → $${agentCost.toFixed(6)}`);
      
      totalCost += agentCost;
    }
    
    // If no agent-level pricing available, use simple fallback
    if (totalCost === 0 && this.stats.apiCalls.totalTokens > 0) {
      console.log('DEBUG - Cost calculation using fallback method');
      console.log('DEBUG - Total agents with token data:', this.stats.agents.filter(a => a.inputTokens && a.outputTokens).length);
      console.log('DEBUG - Total tokens for fallback calculation:', this.stats.apiCalls.totalTokens);
      
      // Assume 70% input, 30% output tokens (typical ratio)
      const estimatedInputTokens = this.stats.apiCalls.totalTokens * 0.7;
      const estimatedOutputTokens = this.stats.apiCalls.totalTokens * 0.3;
      
      // Use gpt-4o-mini pricing as default
      const pricing = MODEL_PRICING['gpt-4o-mini'];
      const inputCost = (estimatedInputTokens / 1000) * pricing.inputPrice;
      const outputCost = (estimatedOutputTokens / 1000) * pricing.outputPrice;
      totalCost = inputCost + outputCost;
      
      console.log(`DEBUG - Fallback cost calculation: input=${estimatedInputTokens} * $${pricing.inputPrice} + output=${estimatedOutputTokens} * $${pricing.outputPrice} = $${totalCost}`);
    } else if (totalCost > 0) {
      console.log('DEBUG - Using agent-level pricing, total cost:', totalCost);
    } else {
      console.log('DEBUG - No token data available for cost calculation');
    }
    
    return totalCost;
  }

  /**
   * Get current statistics (without finalizing)
   */
  getCurrentStats(): ExecutionStats {
    return { 
      ...this.stats,
      endTime: new Date(),
      totalDuration: new Date().getTime() - this.stats.startTime.getTime()
    };
  }
}

// Global tracker instance
let currentTracker: ExecutionTracker | null = null;

/**
 * Initialize tracking for a new analysis
 */
export function initializeTracking(prNumber: number, analysisId?: string): ExecutionTracker {
  currentTracker = new ExecutionTracker(prNumber, analysisId);
  return currentTracker;
}

/**
 * Get the current tracker instance
 */
export function getCurrentTracker(): ExecutionTracker | null {
  return currentTracker;
}

/**
 * Finalize and reset tracking
 */
export function finalizeTracking(): ExecutionStats | null {
  if (!currentTracker) {
    return null;
  }
  
  const stats = currentTracker.finalize();
  currentTracker = null;
  return stats;
}

// Helper type for token usage
type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

// Extract token usage from a usage object
function extractFromUsage(usage: any): TokenUsage | null {
  if (!usage) return null;
  return {
    inputTokens: usage.prompt_tokens || usage.input_tokens || usage.promptTokens || usage.inputTokens,
    outputTokens: usage.completion_tokens || usage.output_tokens || usage.completionTokens || usage.outputTokens,
    totalTokens: usage.total_tokens || usage.totalTokens
  };
}

// Try to extract token usage from common response paths
function tryExtractFromCommonPaths(resultObj: any): TokenUsage | undefined {
  const paths = [
    resultObj.usage,
    resultObj.response?.usage,
    resultObj.result?.usage,
    resultObj.object?.usage,
    resultObj._meta?.usage,
    resultObj.rawResponse?.usage,
  ];

  for (const usage of paths) {
    if (usage) {
      const extracted = extractFromUsage(usage);
      if (extracted) return extracted;
    }
  }

  return undefined;
}

// Sum token usage from steps array
function sumTokensFromSteps(steps: any[]): TokenUsage | undefined {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalAllTokens = 0;

  for (const step of steps) {
    const stepUsage = extractFromUsage(step.usage || step);
    if (stepUsage) {
      totalInputTokens += stepUsage.inputTokens || 0;
      totalOutputTokens += stepUsage.outputTokens || 0;
      totalAllTokens += stepUsage.totalTokens || 0;
    }
  }

  if (totalAllTokens > 0 || totalInputTokens > 0 || totalOutputTokens > 0) {
    return {
      inputTokens: totalInputTokens || undefined,
      outputTokens: totalOutputTokens || undefined,
      totalTokens: totalAllTokens || (totalInputTokens + totalOutputTokens) || undefined
    };
  }

  return undefined;
}

// Debug log token extraction
function debugLogTokenExtraction(resultObj: any, tokenUsage: TokenUsage | undefined): void {
  if (tokenUsage && (tokenUsage.inputTokens || tokenUsage.outputTokens || tokenUsage.totalTokens)) {
    console.log('DEBUG - Token tracking - extracted usage:', tokenUsage);
    return;
  }

  console.log('DEBUG - Token tracking - no usage found or empty, checking response structure...');

  if (resultObj.usage) {
    console.log('DEBUG - Found resultObj.usage:', resultObj.usage);
    const extracted = extractFromUsage(resultObj.usage);
    console.log('DEBUG - Extraction result:', extracted);
  }

  // Search for any property containing "token" or "usage"
  searchForTokensInObject(resultObj);
}

// Recursively search for token-related properties (for debugging)
function searchForTokensInObject(obj: any, path = ''): void {
  if (!obj || typeof obj !== 'object') return;

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;

    if (key.toLowerCase().includes('usage') || key.toLowerCase().includes('token')) {
      console.log(`DEBUG - Found potential token data at ${currentPath}:`, value);
    }

    if (typeof value === 'object' && path.length < 20) { // Limit depth to prevent infinite recursion
      searchForTokensInObject(value, currentPath);
    }
  }
}

// Extract token usage from result object
function extractTokenUsageFromResult(result: any): TokenUsage | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const resultObj = result;

  // Debug: log the structure
  console.log('DEBUG - Token tracking - response has usage:', !!resultObj.usage, 'totalTokens:', resultObj.usage?.totalTokens);

  // Try common paths first
  let tokenUsage = tryExtractFromCommonPaths(resultObj);

  // If not found and steps array exists, sum from steps
  if (!tokenUsage && resultObj.steps && Array.isArray(resultObj.steps)) {
    tokenUsage = sumTokensFromSteps(resultObj.steps);
  }

  // Debug logging
  debugLogTokenExtraction(resultObj, tokenUsage);

  return tokenUsage;
}

/**
 * Utility function to wrap agent execution with tracking
 */
export async function trackAgent<T>(
  agentName: string,
  model: string | undefined,
  execution: () => Promise<T>
): Promise<T> {
  const tracker = getCurrentTracker();
  if (!tracker) {
    return execution();
  }

  const executionId = tracker.startAgent(agentName, model);

  try {
    const result = await execution();
    const tokenUsage = extractTokenUsageFromResult(result);
    tracker.endAgent(executionId, true, undefined, tokenUsage);
    return result;
  } catch (error) {
    tracker.endAgent(executionId, false, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Utility function to wrap tool execution with tracking
 */
export async function trackTool<T>(
  toolName: string,
  inputParams: Record<string, any> | undefined,
  execution: () => Promise<T>
): Promise<T> {
  const tracker = getCurrentTracker();
  if (!tracker) {
    return execution();
  }

  const executionId = tracker.startTool(toolName, inputParams);
  
  try {
    const result = await execution();
    tracker.endTool(executionId, true, result);
    return result;
  } catch (error) {
    tracker.endTool(executionId, false, undefined, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Model pricing configuration (per 1K tokens)
 */
interface ModelPricing {
  inputPrice: number;  // Price per 1K input tokens
  outputPrice: number; // Price per 1K output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': {
    inputPrice: 0.00015,   // $0.00015 per 1K input tokens
    outputPrice: 0.0006,   // $0.0006 per 1K output tokens
  },
  'gpt-4o': {
    inputPrice: 0.0025,    // $0.0025 per 1K input tokens
    outputPrice: 0.01,     // $0.01 per 1K output tokens
  },
  'gpt-4': {
    inputPrice: 0.03,      // $0.03 per 1K input tokens
    outputPrice: 0.06,     // $0.06 per 1K output tokens
  },
  // Fallback pricing for unknown models
  'default': {
    inputPrice: 0.0015,    // Conservative estimate
    outputPrice: 0.003,    // Conservative estimate
  }
};