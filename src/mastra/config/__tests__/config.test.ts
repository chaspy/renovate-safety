import { describe, it, expect, beforeEach } from 'vitest';
import { validateConfig } from '../index';

describe('Mastra Configuration', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  
  it('should throw error when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => validateConfig()).toThrow('OPENAI_API_KEY');
  });
  
  it('should validate successfully with required env vars', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    expect(() => validateConfig()).not.toThrow();
  });
});