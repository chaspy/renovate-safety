import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateConfig, mastra } from '../index';

describe('Mastra Configuration', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    process.env = { ...originalEnv };
    // テスト時のvector-syncエラーログを抑制
    process.env.MASTRA_DISABLE_VECTOR_SYNC = 'true';
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  it('should throw error when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => validateConfig()).toThrow('OPENAI_API_KEY');
  });
  
  it('should validate successfully with required env vars', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    expect(() => validateConfig()).not.toThrow();
  });
  
  it('should warn when GITHUB_TOKEN is missing', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateConfig();
    
    expect(consoleSpy).toHaveBeenCalledWith('Warning: GITHUB_TOKEN not set. Some features may be limited.');
    consoleSpy.mockRestore();
  });
});