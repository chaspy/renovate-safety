import { describe, it, expect } from 'vitest';
import { extractBreakingChanges } from './breaking.js';

describe('Breaking Change Detection', () => {
  it('should detect BREAKING CHANGE markers', () => {
    const changelog = `
# 2.0.0

## BREAKING CHANGE: API changes
- The old API has been removed
- New API is incompatible

## Features
- Added new feature
`;

    const changes = extractBreakingChanges(changelog);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.line.includes('BREAKING CHANGE: API changes'))).toBe(true);
    expect(changes.some((c) => c.severity === 'breaking')).toBe(true);
  });

  it('should detect removal patterns', () => {
    const changelog = `
# 2.0.0

- * Removed deprecated function
- * Deleted old API
- Added new feature
`;

    const changes = extractBreakingChanges(changelog);
    expect(changes).toHaveLength(2);
    expect(changes[0].severity).toBe('removal');
    expect(changes[1].severity).toBe('removal');
  });

  it('should detect warning patterns', () => {
    const changelog = `
# 2.0.0

- ⚠️ This API is deprecated
- [DEPRECATED] Old function will be removed
- Normal change
`;

    const changes = extractBreakingChanges(changelog);
    expect(changes).toHaveLength(2);
    expect(changes[0].severity).toBe('warning');
    expect(changes[1].severity).toBe('warning');
  });

  it('should return empty array for non-breaking changes', () => {
    const changelog = `
# 2.0.0

- Added new feature
- Fixed bug
- Updated documentation
`;

    const changes = extractBreakingChanges(changelog);
    expect(changes).toHaveLength(0);
  });
});
