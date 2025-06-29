import type { PackageUpdate, CodeDiff, ChangelogDiff } from '../types/index.js';

interface SecurityIssue {
  type: 'vulnerability' | 'suspicious-pattern' | 'permission-change' | 'dependency-injection';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation: string;
}

export async function analyzeSecurityImplications(
  packageUpdate: PackageUpdate,
  codeDiff: CodeDiff | null,
  changelogDiff: ChangelogDiff | null
): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];
  
  // Check for security-related keywords in changelog
  if (changelogDiff) {
    const securityKeywords = [
      { pattern: /security\s+(fix|patch|update)/gi, severity: 'medium' as const },
      { pattern: /vulnerabilit(y|ies)/gi, severity: 'high' as const },
      { pattern: /CVE-\d{4}-\d+/gi, severity: 'critical' as const },
      { pattern: /remote\s+code\s+execution/gi, severity: 'critical' as const },
      { pattern: /XSS|cross-site\s+scripting/gi, severity: 'high' as const },
      { pattern: /SQL\s+injection/gi, severity: 'high' as const },
      { pattern: /authentication\s+bypass/gi, severity: 'critical' as const },
      { pattern: /privilege\s+escalation/gi, severity: 'critical' as const },
    ];
    
    for (const { pattern, severity } of securityKeywords) {
      const matches = changelogDiff.content.match(pattern);
      if (matches) {
        issues.push({
          type: 'vulnerability',
          severity,
          description: `Security-related changes detected: ${matches[0]}`,
          recommendation: 'Review security fixes and ensure they address vulnerabilities in your usage patterns'
        });
      }
    }
  }
  
  // Analyze code diff for suspicious patterns
  if (codeDiff) {
    // Check for significant permission or capability changes
    if (codeDiff.additions > 1000 && codeDiff.deletions < 100) {
      issues.push({
        type: 'suspicious-pattern',
        severity: 'medium',
        description: `Large code addition (${codeDiff.additions} lines) with minimal deletions may indicate new functionality`,
        recommendation: 'Review new code for unexpected capabilities or dependencies'
      });
    }
    
    // Check for complete rewrites
    if (codeDiff.additions > 500 && codeDiff.deletions > 500) {
      issues.push({
        type: 'suspicious-pattern',
        severity: 'high',
        description: 'Significant code rewrite detected',
        recommendation: 'Thoroughly review changes as behavior may have changed substantially'
      });
    }
  }
  
  // Check for known vulnerable packages
  const vulnerablePatterns = [
    { name: 'event-stream', versions: ['3.3.6'], severity: 'critical' as const },
    { name: 'flatmap-stream', versions: ['*'], severity: 'critical' as const },
  ];
  
  for (const pattern of vulnerablePatterns) {
    if (packageUpdate.name === pattern.name) {
      issues.push({
        type: 'vulnerability',
        severity: pattern.severity,
        description: `Known vulnerable package detected: ${pattern.name}`,
        recommendation: 'This package has known security issues. Consider alternatives or ensure patches are applied.'
      });
    }
  }
  
  return issues;
}

export function generateSecurityChecklist(issues: SecurityIssue[]): string[] {
  const checklist: string[] = ['## Security Review Checklist'];
  
  if (issues.length === 0) {
    checklist.push('- [ ] No specific security concerns identified');
    checklist.push('- [ ] Standard security review completed');
    return checklist;
  }
  
  // Group by severity
  const critical = issues.filter(i => i.severity === 'critical');
  const high = issues.filter(i => i.severity === 'high');
  const medium = issues.filter(i => i.severity === 'medium');
  const low = issues.filter(i => i.severity === 'low');
  
  if (critical.length > 0) {
    checklist.push('\n### 🚨 Critical Security Items');
    for (const issue of critical) {
      checklist.push(`- [ ] ${issue.description}`);
      checklist.push(`  - ${issue.recommendation}`);
    }
  }
  
  if (high.length > 0) {
    checklist.push('\n### 🔴 High Priority Security Items');
    for (const issue of high) {
      checklist.push(`- [ ] ${issue.description}`);
      checklist.push(`  - ${issue.recommendation}`);
    }
  }
  
  if (medium.length > 0) {
    checklist.push('\n### 🟠 Medium Priority Security Items');
    for (const issue of medium) {
      checklist.push(`- [ ] ${issue.description}`);
      checklist.push(`  - ${issue.recommendation}`);
    }
  }
  
  if (low.length > 0) {
    checklist.push('\n### 🟡 Low Priority Security Items');
    for (const issue of low) {
      checklist.push(`- [ ] ${issue.description}`);
      checklist.push(`  - ${issue.recommendation}`);
    }
  }
  
  // Add general security checks
  checklist.push('\n### General Security Checks');
  checklist.push('- [ ] Review package permissions and capabilities');
  checklist.push('- [ ] Check for new external network connections');
  checklist.push('- [ ] Verify no sensitive data is exposed');
  checklist.push('- [ ] Ensure no new filesystem access is introduced');
  checklist.push('- [ ] Validate input sanitization is maintained');
  
  return checklist;
}