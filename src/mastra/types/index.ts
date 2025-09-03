import { z } from 'zod';

// PR情報のスキーマ
export const PRInfoSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().optional(),
  base: z.string(),
  head: z.string(),
  repository: z.object({
    owner: z.string(),
    name: z.string(),
  }),
});

// 依存関係差分のスキーマ
export const DependencyDiffSchema = z.object({
  name: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  type: z.enum(['dependencies', 'devDependencies', 'peerDependencies']),
  changeType: z.enum(['added', 'removed', 'updated']),
});

// リスク評価のスキーマ
export const RiskAssessmentSchema = z.object({
  level: z.enum(['safe', 'low', 'medium', 'high', 'critical', 'unknown']),
  score: z.number(),
  factors: z.array(z.string()),
  recommendation: z.string(),
});

export type PRInfo = z.infer<typeof PRInfoSchema>;
export type DependencyDiff = z.infer<typeof DependencyDiffSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;