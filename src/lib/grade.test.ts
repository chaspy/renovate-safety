import { describe, it, expect } from 'vitest';
import { assessRisk, getRiskEmoji, getRiskDescription } from './grade.js';
import type { BreakingChange, APIUsage, LLMSummary } from '../types/index.js';

describe('Risk Assessment', () => {
  const sampleBreakingChange: BreakingChange = {
    line: 'BREAKING: API removed',
    severity: 'breaking',
  };

  const sampleAPIUsage: APIUsage = {
    file: 'src/test.ts',
    line: 10,
    snippet: 'someApi()',
    apiName: 'someApi',
  };

  const sampleLLMSummary: LLMSummary = {
    summary: 'Breaking changes detected',
    language: 'en',
    breakingChanges: ['API removed'],
  };

  it('should return "safe" for no breaking changes or API usage', () => {
    const risk = assessRisk([], [], null);
    expect(risk).toBe('safe');
  });

  it('should return "low" for breaking changes without API usage', () => {
    const risk = assessRisk([sampleBreakingChange], [], null);
    expect(risk).toBe('low');
  });

  it('should return "review" for breaking changes with API usage', () => {
    const risk = assessRisk([sampleBreakingChange], [sampleAPIUsage], null);
    expect(risk).toBe('review');
  });

  it('should return "low" for LLM identified breaking changes without API usage', () => {
    const risk = assessRisk([], [], sampleLLMSummary);
    expect(risk).toBe('low');
  });

  it('should return correct emojis for risk levels', () => {
    expect(getRiskEmoji('safe')).toBe('✅');
    expect(getRiskEmoji('low')).toBe('⚠️');
    expect(getRiskEmoji('review')).toBe('🔍');
  });

  it('should return correct descriptions for risk levels', () => {
    expect(getRiskDescription('safe')).toContain('No significant risks');
    expect(getRiskDescription('low')).toContain('Low risk');
    expect(getRiskDescription('review')).toContain('Manual review required');
  });
});
