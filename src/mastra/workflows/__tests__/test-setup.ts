import { vi } from 'vitest';

// Set dummy environment variables for testing
process.env.OPENAI_API_KEY = 'sk-test-dummy-key';
process.env.GITHUB_TOKEN = 'ghp-test-dummy-token';

// Mock the Mastra agents to prevent actual API calls
vi.mock('../../agents/release-notes-agent.js', () => ({
  ReleaseNotesAgent: {
    generateVNext: vi.fn().mockResolvedValue({
      object: {
        breakingChanges: [],
        migrationSteps: [],
        riskLevel: 'safe',
        summary: 'Mocked summary',
        sources: [{ type: 'npm', status: 'success' }],
      },
    }),
  },
}));

vi.mock('../../agents/code-impact-agent.js', () => ({
  CodeImpactAgent: {
    generateVNext: vi.fn().mockResolvedValue({
      object: {
        totalUsages: 0,
        criticalUsages: [],
        usageByType: {},
        impactLevel: 'minimal',
        affectedFiles: [],
        recommendations: [],
        projectType: 'typescript',
        score: 0,
      },
    }),
  },
}));