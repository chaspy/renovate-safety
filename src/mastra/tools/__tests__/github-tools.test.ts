import { describe, it, expect } from 'vitest';
import { getPRInfoTool, githubCompareTool, prCommentTool, prLabelTool, dependencyReviewTool } from '../index.js';

describe('GitHub Tools', () => {
  describe('Tool Structure', () => {
    it('should export getPRInfoTool with correct structure', () => {
      expect(getPRInfoTool.id).toBe('get-pr-info');
      expect(getPRInfoTool.inputSchema).toBeDefined();
      expect(getPRInfoTool.outputSchema).toBeDefined();
      expect(typeof getPRInfoTool.execute).toBe('function');
    });

    it('should export githubCompareTool with correct structure', () => {
      expect(githubCompareTool.id).toBe('github-compare');
      expect(githubCompareTool.inputSchema).toBeDefined();
      expect(githubCompareTool.outputSchema).toBeDefined();
      expect(typeof githubCompareTool.execute).toBe('function');
    });

    it('should export prCommentTool with correct structure', () => {
      expect(prCommentTool.id).toBe('pr-comment');
      expect(prCommentTool.inputSchema).toBeDefined();
      expect(prCommentTool.outputSchema).toBeDefined();
      expect(typeof prCommentTool.execute).toBe('function');
    });

    it('should export prLabelTool with correct structure', () => {
      expect(prLabelTool.id).toBe('pr-label');
      expect(prLabelTool.inputSchema).toBeDefined();
      expect(prLabelTool.outputSchema).toBeDefined();
      expect(typeof prLabelTool.execute).toBe('function');
    });

    it('should export dependencyReviewTool with correct structure', () => {
      expect(dependencyReviewTool.id).toBe('dependency-review');
      expect(dependencyReviewTool.inputSchema).toBeDefined();
      expect(dependencyReviewTool.outputSchema).toBeDefined();
      expect(typeof dependencyReviewTool.execute).toBe('function');
    });
  });

  describe('Input Schema Validation', () => {
    it('should validate getPRInfoTool input schema', () => {
      const validInput = { prNumber: 123 };
      const result = getPRInfoTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate githubCompareTool input schema', () => {
      const validInput = { owner: 'test', repo: 'test', base: 'main', head: 'feature' };
      const result = githubCompareTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate prCommentTool input schema', () => {
      const validInput = { prNumber: 123, body: 'test comment' };
      const result = prCommentTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate prLabelTool input schema', () => {
      const validInput = { prNumber: 123, labels: ['test-label'] };
      const result = prLabelTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate dependencyReviewTool input schema', () => {
      const validInput = { owner: 'test', repo: 'test', base: 'main', head: 'feature' };
      const result = dependencyReviewTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });
});