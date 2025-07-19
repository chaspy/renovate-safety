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

  it('should return "safe" for no breaking changes or API usage', async () => {
    const risk = await assessRisk([], [], null);
    expect(risk.level).toBe('safe');
  });

  it('should return "low" for breaking changes without API usage', async () => {
    const risk = await assessRisk([sampleBreakingChange], [], null);
    expect(risk.level).toBe('low');
  });

  it('should return "high" for breaking changes with API usage', async () => {
    const risk = await assessRisk([sampleBreakingChange], [sampleAPIUsage], null);
    expect(risk.level).toBe('high');
  });

  it('should return "low" for LLM identified breaking changes without API usage', async () => {
    const risk = await assessRisk([], [], sampleLLMSummary);
    expect(risk.level).toBe('low');
  });

  it('should return correct emojis for risk levels', () => {
    expect(getRiskEmoji('safe')).toBe('✅');
    expect(getRiskEmoji('low')).toBe('🟡');
    expect(getRiskEmoji('medium')).toBe('🟠');
    expect(getRiskEmoji('high')).toBe('🔴');
  });

  it('should return correct descriptions for risk levels', () => {
    expect(getRiskDescription('safe')).toContain('No significant risks');
    expect(getRiskDescription('low')).toContain('Low risk');
    expect(getRiskDescription('medium')).toContain('Medium risk');
    expect(getRiskDescription('high')).toContain('High risk');
  });
});
