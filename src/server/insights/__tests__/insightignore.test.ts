import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';

import { parseInsightIgnore, shouldSuppressInsight, loadInsightIgnore } from '../insightignore';

import type { InsightResult } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInsight(overrides: Partial<InsightResult> = {}): InsightResult {
  return {
    type: 'god-class',
    category: 'structural-complexity',
    severity: 'warning',
    title: 'God Class Detected',
    description: 'Test insight',
    entities: [
      { id: '1', kind: 'class', name: 'BigClass', moduleId: 'src/models/BigClass.ts' },
    ],
    ...overrides,
  };
}

// ── parseInsightIgnore ───────────────────────────────────────────────────────

describe('parseInsightIgnore', () => {
  it('should skip comment lines', () => {
    const rules = parseInsightIgnore('# this is a comment\n# another comment');
    expect(rules.suppressedKinds.size).toBe(0);
    expect(rules.filePatterns).toHaveLength(0);
    expect(rules.kindFilePatterns.size).toBe(0);
  });

  it('should skip blank lines', () => {
    const rules = parseInsightIgnore('\n\n   \n');
    expect(rules.suppressedKinds.size).toBe(0);
    expect(rules.filePatterns).toHaveLength(0);
    expect(rules.kindFilePatterns.size).toBe(0);
  });

  it('should parse !kind suppression', () => {
    const rules = parseInsightIgnore('!god-class\n!missing-return-types');
    expect(rules.suppressedKinds.has('god-class')).toBe(true);
    expect(rules.suppressedKinds.has('missing-return-types')).toBe(true);
    expect(rules.suppressedKinds.size).toBe(2);
  });

  it('should ignore unknown !kind values', () => {
    const rules = parseInsightIgnore('!not-a-real-kind');
    expect(rules.suppressedKinds.size).toBe(0);
  });

  it('should parse kind:pattern rules', () => {
    const rules = parseInsightIgnore(
      'circular-imports:src/legacy/**\nmodule-size:src/generated/**',
    );
    expect(rules.kindFilePatterns.get('circular-imports')).toEqual(['src/legacy/**']);
    expect(rules.kindFilePatterns.get('module-size')).toEqual(['src/generated/**']);
  });

  it('should accumulate multiple patterns for the same kind', () => {
    const rules = parseInsightIgnore(
      'god-class:src/legacy/**\ngod-class:src/vendor/**',
    );
    expect(rules.kindFilePatterns.get('god-class')).toEqual([
      'src/legacy/**',
      'src/vendor/**',
    ]);
  });

  it('should parse bare file patterns', () => {
    const rules = parseInsightIgnore('*.test.ts\n*.spec.ts');
    expect(rules.filePatterns).toEqual(['*.test.ts', '*.spec.ts']);
  });

  it('should handle a mixed file correctly', () => {
    const content = [
      '# Suppress test files',
      '*.test.ts',
      '',
      '# Suppress god class globally',
      '!god-class',
      '',
      '# Suppress module-size for generated code',
      'module-size:src/generated/**',
    ].join('\n');

    const rules = parseInsightIgnore(content);
    expect(rules.filePatterns).toEqual(['*.test.ts']);
    expect(rules.suppressedKinds.has('god-class')).toBe(true);
    expect(rules.kindFilePatterns.get('module-size')).toEqual(['src/generated/**']);
  });

  it('should trim whitespace from lines', () => {
    const rules = parseInsightIgnore('  !god-class  \n  *.test.ts  ');
    expect(rules.suppressedKinds.has('god-class')).toBe(true);
    expect(rules.filePatterns).toEqual(['*.test.ts']);
  });
});

// ── shouldSuppressInsight ────────────────────────────────────────────────────

describe('shouldSuppressInsight', () => {
  it('should suppress by kind', () => {
    const rules = parseInsightIgnore('!god-class');
    const insight = makeInsight({ type: 'god-class' });
    expect(shouldSuppressInsight(rules, insight)).toBe(true);
  });

  it('should not suppress non-matching kind', () => {
    const rules = parseInsightIgnore('!god-class');
    const insight = makeInsight({ type: 'module-size' });
    expect(shouldSuppressInsight(rules, insight)).toBe(false);
  });

  it('should suppress by file pattern matching moduleId', () => {
    const rules = parseInsightIgnore('*.test.ts');
    const insight = makeInsight({
      entities: [
        { id: '1', kind: 'class', name: 'TestHelper', moduleId: 'utils.test.ts' },
      ],
    });
    expect(shouldSuppressInsight(rules, insight)).toBe(true);
  });

  it('should suppress by file pattern matching name when moduleId is absent', () => {
    const rules = parseInsightIgnore('*.test.ts');
    const insight = makeInsight({
      entities: [
        { id: '1', kind: 'module', name: 'utils.test.ts' },
      ],
    });
    expect(shouldSuppressInsight(rules, insight)).toBe(true);
  });

  it('should not suppress when file pattern does not match', () => {
    const rules = parseInsightIgnore('*.test.ts');
    const insight = makeInsight({
      entities: [
        { id: '1', kind: 'class', name: 'UserService', moduleId: 'src/services/UserService.ts' },
      ],
    });
    expect(shouldSuppressInsight(rules, insight)).toBe(false);
  });

  it('should suppress by kind-specific file pattern', () => {
    const rules = parseInsightIgnore('module-size:src/generated/**');
    const insight = makeInsight({
      type: 'module-size',
      entities: [
        { id: '1', kind: 'module', name: 'types.ts', moduleId: 'src/generated/types.ts' },
      ],
    });
    expect(shouldSuppressInsight(rules, insight)).toBe(true);
  });

  it('should not suppress kind-specific pattern for a different kind', () => {
    const rules = parseInsightIgnore('module-size:src/generated/**');
    const insight = makeInsight({
      type: 'god-class',
      entities: [
        { id: '1', kind: 'class', name: 'BigClass', moduleId: 'src/generated/BigClass.ts' },
      ],
    });
    expect(shouldSuppressInsight(rules, insight)).toBe(false);
  });

  it('should require all entities to match for suppression', () => {
    const rules = parseInsightIgnore('*.test.ts');
    const insight = makeInsight({
      entities: [
        { id: '1', kind: 'module', name: 'utils.test.ts' },
        { id: '2', kind: 'module', name: 'src/services/UserService.ts' },
      ],
    });
    expect(shouldSuppressInsight(rules, insight)).toBe(false);
  });

  it('should not suppress insights with no entities via file patterns', () => {
    const rules = parseInsightIgnore('*.test.ts');
    const insight = makeInsight({ entities: [] });
    expect(shouldSuppressInsight(rules, insight)).toBe(false);
  });

  it('should handle ** glob for deep path matching', () => {
    const rules = parseInsightIgnore('src/legacy/**');
    const insight = makeInsight({
      entities: [
        { id: '1', kind: 'module', name: 'old.ts', moduleId: 'src/legacy/deep/nested/old.ts' },
      ],
    });
    expect(shouldSuppressInsight(rules, insight)).toBe(true);
  });

  it('should not match ** across wrong prefix', () => {
    const rules = parseInsightIgnore('src/legacy/**');
    const insight = makeInsight({
      entities: [
        { id: '1', kind: 'module', name: 'new.ts', moduleId: 'src/modern/new.ts' },
      ],
    });
    expect(shouldSuppressInsight(rules, insight)).toBe(false);
  });
});

// ── loadInsightIgnore ────────────────────────────────────────────────────────

describe('loadInsightIgnore', () => {
  it('should return null when file does not exist', async () => {
    const result = await loadInsightIgnore('/nonexistent/path');
    expect(result).toBeNull();
  });

  it('should parse a real file from disk', async () => {
    const tmpDir = path.join(import.meta.dirname, '__tmp_insightignore_test__');
    await fs.mkdir(tmpDir, { recursive: true });
    try {
      await fs.writeFile(path.join(tmpDir, '.insightignore'), '!god-class\n*.test.ts\n');
      const result = await loadInsightIgnore(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.suppressedKinds.has('god-class')).toBe(true);
      expect(result!.filePatterns).toEqual(['*.test.ts']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
