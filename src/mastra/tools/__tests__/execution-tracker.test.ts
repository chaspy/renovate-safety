import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initializeTracking,
  getCurrentTracker,
  finalizeTracking,
  trackAgent,
  trackTool
} from '../execution-tracker.js';

describe('Execution Tracker', () => {
  beforeEach(() => {
    // Clear any existing tracker
    finalizeTracking();
  });

  describe('Tracker Lifecycle', () => {
    it('should initialize tracker with basic info', () => {
      const tracker = initializeTracking(123, 'test-analysis');
      
      expect(tracker).toBeDefined();
      expect(getCurrentTracker()).toBe(tracker);
      
      const stats = tracker.getCurrentStats();
      expect(stats.analysisId).toBe('test-analysis');
      expect(stats.prNumber).toBe(123);
      expect(stats.agents).toEqual([]);
      expect(stats.tools).toEqual([]);
    });

    it('should auto-generate analysis ID if not provided', () => {
      const tracker = initializeTracking(123);
      const stats = tracker.getCurrentStats();
      
      expect(stats.analysisId).toMatch(/analysis_\d+/);
    });

    it('should finalize and clear tracker', () => {
      const tracker = initializeTracking(123);
      tracker.setRepository('test-owner', 'test-repo');
      
      const finalStats = finalizeTracking();
      
      expect(finalStats).toBeDefined();
      expect(finalStats!.repository).toEqual({
        owner: 'test-owner',
        name: 'test-repo'
      });
      expect(getCurrentTracker()).toBeNull();
    });
  });

  describe('Agent Tracking', () => {
    let tracker: any;

    beforeEach(() => {
      tracker = initializeTracking(123);
    });

    it('should track successful agent execution', () => {
      const executionId = tracker.startAgent('TestAgent', 'gpt-4o-mini');
      
      tracker.endAgent(executionId, true, undefined, {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300
      });
      
      const stats = tracker.getCurrentStats();
      expect(stats.agents).toHaveLength(1);
      
      const agent = stats.agents[0];
      expect(agent.agentName).toBe('TestAgent');
      expect(agent.model).toBe('gpt-4o-mini');
      expect(agent.success).toBe(true);
      expect(agent.totalTokens).toBe(300);
      // Duration may be 0ms in very fast test environments
      expect(agent.duration).toBeGreaterThanOrEqual(0);
    });

    it('should track failed agent execution', () => {
      const executionId = tracker.startAgent('TestAgent');
      
      tracker.endAgent(executionId, false, 'Test error');
      
      const stats = tracker.getCurrentStats();
      const agent = stats.agents[0];
      
      expect(agent.success).toBe(false);
      expect(agent.error).toBe('Test error');
    });

    it('should update API call statistics', () => {
      const executionId = tracker.startAgent('TestAgent', 'gpt-4o-mini');
      
      tracker.endAgent(executionId, true, undefined, {
        totalTokens: 300
      });
      
      const stats = tracker.getCurrentStats();
      expect(stats.apiCalls.total).toBe(1);
      expect(stats.apiCalls.totalTokens).toBe(300);
      expect(stats.apiCalls.byModel['gpt-4o-mini']).toBe(1);
    });

    it('should handle invalid execution ID gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      tracker.endAgent('invalid-id', true);
      
      expect(consoleSpy).toHaveBeenCalledWith('Agent execution invalid-id not found');
      consoleSpy.mockRestore();
    });
  });

  describe('Tool Tracking', () => {
    let tracker: any;

    beforeEach(() => {
      tracker = initializeTracking(123);
    });

    it('should track successful tool execution', () => {
      const executionId = tracker.startTool('TestTool', { param1: 'value1' });
      
      tracker.endTool(executionId, true, { result: 'success' });
      
      const stats = tracker.getCurrentStats();
      expect(stats.tools).toHaveLength(1);
      
      const tool = stats.tools[0];
      expect(tool.toolName).toBe('TestTool');
      expect(tool.success).toBe(true);
      expect(tool.inputParams).toEqual({ param1: 'value1' });
      expect(tool.outputData).toEqual({ result: 'success' });
      // Duration may be 0ms in very fast test environments
      expect(tool.duration).toBeGreaterThanOrEqual(0);
    });

    it('should track failed tool execution', () => {
      const executionId = tracker.startTool('TestTool');
      
      tracker.endTool(executionId, false, undefined, 'Test error');
      
      const stats = tracker.getCurrentStats();
      const tool = stats.tools[0];
      
      expect(tool.success).toBe(false);
      expect(tool.error).toBe('Test error');
    });

    it('should associate tool calls with active agent', () => {
      const agentId = tracker.startAgent('TestAgent');
      const toolId = tracker.startTool('TestTool');
      
      tracker.endTool(toolId, true, { result: 'success' });
      tracker.endAgent(agentId, true);
      
      const stats = tracker.getCurrentStats();
      const agent = stats.agents[0];
      
      expect(agent.toolCalls).toHaveLength(1);
      expect(agent.toolCalls![0].toolName).toBe('TestTool');
    });
  });

  describe('Data Source Tracking', () => {
    let tracker: any;

    beforeEach(() => {
      tracker = initializeTracking(123);
    });

    it('should track unique data sources', () => {
      tracker.addDataSource('npm-registry');
      tracker.addDataSource('github-releases');
      tracker.addDataSource('npm-registry'); // Duplicate
      
      const stats = tracker.getCurrentStats();
      expect(stats.dataSourcesUsed).toEqual(['npm-registry', 'github-releases']);
    });
  });

  describe('Cache Tracking', () => {
    let tracker: any;

    beforeEach(() => {
      tracker = initializeTracking(123);
    });

    it('should track cache hits and misses', () => {
      tracker.recordCacheHit();
      tracker.recordCacheHit();
      tracker.recordCacheMiss();
      
      const stats = tracker.getCurrentStats();
      expect(stats.cacheHits).toBe(2);
      expect(stats.cacheMisses).toBe(1);
    });
  });

  describe('Repository and Branch Info', () => {
    let tracker: any;

    beforeEach(() => {
      tracker = initializeTracking(123);
    });

    it('should set repository information', () => {
      tracker.setRepository('test-owner', 'test-repo');
      
      const stats = tracker.getCurrentStats();
      expect(stats.repository).toEqual({
        owner: 'test-owner',
        name: 'test-repo'
      });
    });

    it('should set branch and commit information', () => {
      tracker.setBranchInfo('main', 'abc123');
      
      const stats = tracker.getCurrentStats();
      expect(stats.branch).toBe('main');
      expect(stats.commitHash).toBe('abc123');
    });
  });

  describe('Cost Estimation', () => {
    it('should estimate cost in finalized stats', () => {
      const tracker = initializeTracking(123);
      
      const executionId = tracker.startAgent('TestAgent', 'gpt-4o-mini');
      tracker.endAgent(executionId, true, undefined, {
        totalTokens: 1000
      });
      
      const finalStats = finalizeTracking();
      
      // Cost model may change; assert it's a positive number
      expect(finalStats!.apiCalls.estimatedCost).toBeGreaterThan(0);
    });

    it('should handle zero tokens gracefully', () => {
      const tracker = initializeTracking(123);
      
      const finalStats = finalizeTracking();
      
      // When no tokens recorded, cost may be undefined or 0 depending on implementation
      expect(finalStats!.apiCalls.estimatedCost === undefined || finalStats!.apiCalls.estimatedCost === 0).toBe(true);
    });
  });

  describe('Utility Functions', () => {
    beforeEach(() => {
      initializeTracking(123);
    });

    describe('trackAgent', () => {
      it('should track successful agent execution', async () => {
        const mockExecution = vi.fn().mockResolvedValue('success');
        
        const result = await trackAgent('TestAgent', 'gpt-4o-mini', mockExecution);
        
        expect(result).toBe('success');
        expect(mockExecution).toHaveBeenCalled();
        
        const stats = getCurrentTracker()!.getCurrentStats();
        expect(stats.agents).toHaveLength(1);
        expect(stats.agents[0].success).toBe(true);
      });

      it('should track failed agent execution', async () => {
        const mockExecution = vi.fn().mockRejectedValue(new Error('Test error'));
        
        await expect(trackAgent('TestAgent', 'gpt-4o-mini', mockExecution)).rejects.toThrow('Test error');
        
        const stats = getCurrentTracker()!.getCurrentStats();
        expect(stats.agents[0].success).toBe(false);
        expect(stats.agents[0].error).toBe('Test error');
      });
    });

    describe('trackTool', () => {
      it('should track successful tool execution', async () => {
        const mockExecution = vi.fn().mockResolvedValue({ data: 'result' });
        
        const result = await trackTool('TestTool', { param: 'value' }, mockExecution);
        
        expect(result).toEqual({ data: 'result' });
        
        const stats = getCurrentTracker()!.getCurrentStats();
        expect(stats.tools).toHaveLength(1);
        expect(stats.tools[0].success).toBe(true);
      });

      it('should track failed tool execution', async () => {
        const mockExecution = vi.fn().mockRejectedValue(new Error('Tool error'));
        
        await expect(trackTool('TestTool', undefined, mockExecution)).rejects.toThrow('Tool error');
        
        const stats = getCurrentTracker()!.getCurrentStats();
        expect(stats.tools[0].success).toBe(false);
        expect(stats.tools[0].error).toBe('Tool error');
      });
    });

    it('should handle no tracker gracefully', async () => {
      finalizeTracking(); // Clear tracker
      
      const mockExecution = vi.fn().mockResolvedValue('success');
      const result = await trackAgent('TestAgent', 'gpt-4o-mini', mockExecution);
      
      expect(result).toBe('success');
      expect(mockExecution).toHaveBeenCalled();
    });
  });
});
