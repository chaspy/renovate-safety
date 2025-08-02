import type {
  RiskAssessment,
  AnalysisResult,
  DependencyUsage,
  BreakingChange,
  APIUsage,
} from '../types/index.js';

interface ActionableRecommendation {
  title: string;
  priority: 'immediate' | 'high' | 'medium' | 'low';
  actions: string[];
  estimatedTime: string;
  automatable: boolean;
  resources?: string[];
}

export function generateActionableRecommendations(
  result: AnalysisResult,
  riskAssessment: RiskAssessment
): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  // Add risk-level based recommendations
  switch (riskAssessment.level) {
    case 'critical':
      recommendations.push(...getCriticalRiskRecommendations(result));
      break;
    case 'high':
      recommendations.push(...getHighRiskRecommendations(result));
      break;
    case 'medium':
      recommendations.push(...getMediumRiskRecommendations(result));
      break;
    case 'low':
      recommendations.push(...getLowRiskRecommendations(result));
      break;
    case 'safe':
      recommendations.push(...getSafeRecommendations(result));
      break;
  }

  // Add package-type specific recommendations
  if (result.dependencyUsage) {
    recommendations.push(...getDependencyTypeRecommendations(result.dependencyUsage));
  }

  // Add breaking change specific recommendations
  if (result.breakingChanges.length > 0) {
    recommendations.push(
      ...getBreakingChangeRecommendations(result.breakingChanges, result.apiUsages)
    );
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = ['immediate', 'high', 'medium', 'low'];
    return priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
  });
}

function getCriticalRiskRecommendations(_result: AnalysisResult): ActionableRecommendation[] {
  return [
    {
      title: 'Block Auto-Merge and Require Manual Review',
      priority: 'immediate',
      actions: [
        'Add "do-not-merge" label to the PR',
        'Request review from senior developers familiar with the affected code',
        'Schedule a code review meeting if breaking changes affect critical paths',
        'Consider creating a feature branch for extensive testing',
      ],
      estimatedTime: '2-4 hours for initial review',
      automatable: false,
      resources: [
        "Link to your team's code review guidelines",
        'Documentation for the updated package',
      ],
    },
  ];
}

function getHighRiskRecommendations(result: AnalysisResult): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  recommendations.push({
    title: 'Comprehensive Testing Required',
    priority: 'high',
    actions: [
      `Run full test suite focusing on ${result.apiUsages.length} affected code locations`,
      'Create additional integration tests for breaking change scenarios',
      'Perform manual testing of critical user paths',
      'Review and update any affected documentation',
    ],
    estimatedTime: '1-2 hours',
    automatable: true,
    resources: ['npm test -- --coverage', 'Link to testing best practices'],
  });

  if (result.apiUsages.length > 0) {
    recommendations.push({
      title: 'Update Affected Code',
      priority: 'high',
      actions: [
        `Review and update ${result.apiUsages.length} code locations using the deprecated/changed APIs`,
        'Search for indirect usages that static analysis might have missed',
        'Update TypeScript definitions if applicable',
        'Consider using codemods if available for this package',
      ],
      estimatedTime: `${Math.ceil((result.apiUsages.length * 15) / 60)} hours (15 min per location)`,
      automatable: false,
    });
  }

  return recommendations;
}

function getMediumRiskRecommendations(result: AnalysisResult): ActionableRecommendation[] {
  return [
    {
      title: 'Targeted Testing and Review',
      priority: 'medium',
      actions: [
        'Run tests for modules that import this package',
        'Perform quick smoke tests on main functionality',
        'Review the changelog for any undocumented changes',
        'Check for deprecation warnings in console/logs',
      ],
      estimatedTime: '30-60 minutes',
      automatable: true,
      resources: [
        `npm test -- --testNamePattern="${result.package.name}"`,
        'grep -r "console.warn" ./node_modules/' + result.package.name,
      ],
    },
  ];
}

function getLowRiskRecommendations(result: AnalysisResult): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  recommendations.push({
    title: 'Standard Verification',
    priority: 'low',
    actions: [
      'Run your standard CI/CD pipeline',
      'Monitor application logs after deployment for any warnings',
      'Check bundle size impact if this is a frontend dependency',
    ],
    estimatedTime: '15-30 minutes',
    automatable: true,
  });

  // Add bundle size check for frontend packages
  if (isFrontendPackage(result.package.name)) {
    recommendations.push({
      title: 'Check Bundle Size Impact',
      priority: 'low',
      actions: [
        'Run bundle analyzer to check size changes',
        'Verify no unintended dependencies were added',
        'Check if tree-shaking still works properly',
      ],
      estimatedTime: '15 minutes',
      automatable: true,
      resources: ['npm run build -- --stats', 'webpack-bundle-analyzer stats.json'],
    });
  }

  return recommendations;
}

function getSafeRecommendations(_result: AnalysisResult): ActionableRecommendation[] {
  return [
    {
      title: 'Auto-Merge Eligible',
      priority: 'low',
      actions: [
        'This update can be safely auto-merged',
        'Standard CI checks are sufficient',
        'Consider enabling auto-merge for similar updates in the future',
      ],
      estimatedTime: 'None - automated',
      automatable: true,
    },
  ];
}

function getDependencyTypeRecommendations(usage: DependencyUsage): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  if (usage.usageType === 'devDependencies') {
    recommendations.push({
      title: 'Development Dependency Update',
      priority: 'low',
      actions: [
        'Verify build tools still work correctly',
        'Check that development scripts run without errors',
        'Update any related configuration files if needed',
      ],
      estimatedTime: '15 minutes',
      automatable: true,
      resources: ['npm run build', 'npm run lint', 'npm run test'],
    });
  } else if (usage.usageType === 'dependencies' && usage.isDirect) {
    recommendations.push({
      title: 'Production Dependency Validation',
      priority: 'high',
      actions: [
        'Test in a staging environment before production',
        'Monitor error rates after deployment',
        'Have a rollback plan ready',
        'Consider gradual rollout if possible',
      ],
      estimatedTime: '1-2 hours including deployment',
      automatable: false,
    });
  }

  return recommendations;
}

function getBreakingChangeRecommendations(
  breakingChanges: BreakingChange[],
  apiUsages: APIUsage[]
): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  // Group breaking changes by type
  const removals = breakingChanges.filter((c) => c.severity === 'removal');
  const breaking = breakingChanges.filter((c) => c.severity === 'breaking');

  if (removals.length > 0) {
    recommendations.push({
      title: 'Handle Removed APIs',
      priority: 'immediate',
      actions: [
        `Replace ${removals.length} removed API calls with recommended alternatives`,
        'Check migration guide for replacement APIs',
        'Update import statements if modules were reorganized',
        'Remove any polyfills that are no longer needed',
      ],
      estimatedTime: `${removals.length * 30} minutes`,
      automatable: false,
      resources: ['Link to package migration guide', 'Search for migration codemods'],
    });
  }

  if (breaking.length > 0 && apiUsages.length > 0) {
    recommendations.push({
      title: 'Adapt to Breaking Changes',
      priority: 'high',
      actions: [
        `Update ${apiUsages.length} code locations to handle API changes`,
        'Review function signatures and parameter changes',
        'Update any mocked APIs in tests',
        'Check for changes in default behaviors',
      ],
      estimatedTime: `${Math.ceil((apiUsages.length * 20) / 60)} hours`,
      automatable: false,
    });
  }

  return recommendations;
}

function isFrontendPackage(packageName: string): boolean {
  const frontendIndicators = [
    'react',
    'vue',
    'angular',
    'svelte',
    'webpack',
    'rollup',
    'vite',
    'parcel',
    'babel',
    'postcss',
    'sass',
    'less',
    'ui',
    'component',
    'style',
  ];

  return frontendIndicators.some((indicator) => packageName.toLowerCase().includes(indicator));
}

export function generateMigrationChecklist(
  result: AnalysisResult,
  _recommendations: ActionableRecommendation[]
): string[] {
  const checklist: string[] = [];

  // Pre-merge checks
  checklist.push('## Pre-Merge Checklist');
  checklist.push('- [ ] Review all breaking changes in the changelog');
  checklist.push(`- [ ] Check ${result.apiUsages.length} identified API usage locations`);
  checklist.push('- [ ] Run full test suite locally');
  checklist.push('- [ ] Update any affected documentation');

  // Testing checklist
  checklist.push('\n## Testing Checklist');
  checklist.push('- [ ] Unit tests pass');
  checklist.push('- [ ] Integration tests pass');
  checklist.push('- [ ] No new console warnings or errors');
  checklist.push('- [ ] Performance benchmarks are acceptable');

  // Deployment checklist
  checklist.push('\n## Deployment Checklist');
  checklist.push('- [ ] Deploy to staging environment first');
  checklist.push('- [ ] Monitor error rates for 24 hours');
  checklist.push('- [ ] Check application metrics (response time, memory usage)');
  checklist.push('- [ ] Have rollback plan ready');

  // Post-deployment
  checklist.push('\n## Post-Deployment');
  checklist.push('- [ ] Monitor logs for deprecation warnings');
  checklist.push('- [ ] Update team about any behavior changes');
  checklist.push('- [ ] Document any workarounds implemented');

  return checklist;
}
