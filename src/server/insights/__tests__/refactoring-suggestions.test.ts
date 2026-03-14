import { describe, expect, it } from 'vitest';

import { enrichWithSuggestions } from '../refactoring-suggestions';

import type { ImportGraph } from '../import-graph';
import type { InsightResult } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyGraph(): ImportGraph {
  return {
    adjacency: new Map(),
    reverseAdjacency: new Map(),
    modules: new Map(),
    nodeIds: new Set(),
  };
}

function makeInsight(overrides: Partial<InsightResult> & Pick<InsightResult, 'type'>): InsightResult {
  return {
    category: 'structural-complexity',
    severity: 'warning',
    title: 'Test Insight',
    description: 'A test insight',
    entities: [],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('enrichWithSuggestions', () => {
  it('returns enriched insights with suggestions arrays', () => {
    const insights = [makeInsight({ type: 'orphaned-modules' })];
    const result = enrichWithSuggestions(insights, emptyGraph());

    expect(result).toHaveLength(1);
    expect(result[0]!.suggestions).toBeDefined();
    expect(Array.isArray(result[0]!.suggestions)).toBe(true);
  });

  it('does not mutate original insight objects', () => {
    const original = makeInsight({ type: 'orphaned-modules' });
    const frozen = Object.freeze(original);
    const result = enrichWithSuggestions([frozen as InsightResult], emptyGraph());

    expect(result[0]).not.toBe(original);
    expect(result[0]!.suggestions).toBeDefined();
    // Original should not have suggestions
    expect((original as InsightResult & { suggestions?: unknown }).suggestions).toBeUndefined();
  });

  describe('god-class', () => {
    it('suggests extracting methods when method_count > property_count', () => {
      const insight = makeInsight({
        type: 'god-class',
        entities: [
          { id: 'c1', kind: 'class', name: 'BigClass', detail: '12 methods, 3 properties' },
        ],
      });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions.length).toBeGreaterThanOrEqual(1);
      expect(result[0]!.suggestions.some((s) => s.action === 'Extract class')).toBe(true);
      expect(result[0]!.suggestions.every((s) => s.effort === 'medium')).toBe(true);
    });

    it('suggests facade pattern when many public members', () => {
      const insight = makeInsight({
        type: 'god-class',
        entities: [
          { id: 'c1', kind: 'class', name: 'HugeClass', detail: '10 methods, 10 properties' },
        ],
      });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions.some((s) => s.action === 'Apply facade pattern')).toBe(true);
    });

    it('provides a default suggestion when detail is missing', () => {
      const insight = makeInsight({
        type: 'god-class',
        entities: [{ id: 'c1', kind: 'class', name: 'SomeClass' }],
      });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('circular-imports', () => {
    it('suggests cycle-breaking strategies', () => {
      const adjacency = new Map<string, Set<string>>();
      adjacency.set('mod-a', new Set(['mod-b']));
      adjacency.set('mod-b', new Set(['mod-a']));

      const reverseAdjacency = new Map<string, Set<string>>();
      reverseAdjacency.set('mod-a', new Set(['mod-b']));
      reverseAdjacency.set('mod-b', new Set(['mod-a']));

      const graph: ImportGraph = {
        adjacency,
        reverseAdjacency,
        modules: new Map([
          ['mod-a', { name: 'moduleA.ts', directory: '/src', relativePath: 'src/moduleA.ts', isBarrel: false, lineCount: 50, packageId: 'pkg-1' }],
          ['mod-b', { name: 'moduleB.ts', directory: '/src', relativePath: 'src/moduleB.ts', isBarrel: false, lineCount: 30, packageId: 'pkg-1' }],
        ]),
        nodeIds: new Set(['mod-a', 'mod-b']),
      };

      const insight = makeInsight({
        type: 'circular-imports',
        severity: 'critical',
        entities: [
          { id: 'mod-a', kind: 'module', name: 'moduleA.ts' },
          { id: 'mod-b', kind: 'module', name: 'moduleB.ts' },
        ],
      });
      const result = enrichWithSuggestions([insight], graph);

      const suggestions = result[0]!.suggestions;
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      expect(suggestions.some((s) => s.action === 'Break cycle')).toBe(true);
      expect(suggestions.some((s) => s.action === 'Extract shared types')).toBe(true);
      expect(suggestions.some((s) => s.action === 'Use dependency injection')).toBe(true);
      expect(suggestions.every((s) => s.effort === 'high')).toBe(true);
    });
  });

  describe('orphaned-modules', () => {
    it('suggests deletion or re-export', () => {
      const insight = makeInsight({
        type: 'orphaned-modules',
        entities: [{ id: 'm1', kind: 'module', name: 'orphan.ts' }],
      });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toHaveLength(1);
      expect(result[0]!.suggestions[0]!.effort).toBe('low');
      expect(result[0]!.suggestions[0]!.description).toContain('Delete if unused');
    });
  });

  describe('leaky-encapsulation', () => {
    it('suggests restricting visibility', () => {
      const insight = makeInsight({ type: 'leaky-encapsulation' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toHaveLength(1);
      expect(result[0]!.suggestions[0]!.action).toBe('Restrict visibility');
      expect(result[0]!.suggestions[0]!.effort).toBe('medium');
    });
  });

  describe('import-fan-in', () => {
    it('suggests stability and splitting', () => {
      const insight = makeInsight({ type: 'import-fan-in' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toHaveLength(2);
      expect(result[0]!.suggestions.some((s) => s.action === 'Ensure stability')).toBe(true);
      expect(result[0]!.suggestions.some((s) => s.action === 'Split module')).toBe(true);
    });
  });

  describe('import-fan-out', () => {
    it('suggests SRP and facade', () => {
      const insight = makeInsight({ type: 'import-fan-out' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toHaveLength(2);
      expect(result[0]!.suggestions.every((s) => s.effort === 'high')).toBe(true);
    });
  });

  describe('module-size', () => {
    it('suggests splitting', () => {
      const insight = makeInsight({ type: 'module-size' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toHaveLength(1);
      expect(result[0]!.suggestions[0]!.effort).toBe('medium');
    });
  });

  describe('deep-inheritance', () => {
    it('suggests composition over inheritance', () => {
      const insight = makeInsight({ type: 'deep-inheritance' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toHaveLength(1);
      expect(result[0]!.suggestions[0]!.action).toBe('Prefer composition');
      expect(result[0]!.suggestions[0]!.effort).toBe('high');
    });
  });

  describe('hub-modules', () => {
    it('suggests minimizing API surface', () => {
      const insight = makeInsight({ type: 'hub-modules' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toHaveLength(1);
      expect(result[0]!.suggestions[0]!.effort).toBe('medium');
    });
  });

  describe('bridge-modules', () => {
    it('suggests adding redundancy', () => {
      const insight = makeInsight({ type: 'bridge-modules' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toHaveLength(1);
      expect(result[0]!.suggestions[0]!.effort).toBe('medium');
    });
  });

  describe('unknown insight types', () => {
    it('returns empty suggestions for types without specific generators', () => {
      const insight = makeInsight({ type: 'barrel-file-depth' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toEqual([]);
    });

    it('returns empty suggestions for type-only-dependencies', () => {
      const insight = makeInsight({ type: 'type-only-dependencies' });
      const result = enrichWithSuggestions([insight], emptyGraph());

      expect(result[0]!.suggestions).toEqual([]);
    });
  });

  describe('effort levels', () => {
    it('orphaned-modules has low effort', () => {
      const result = enrichWithSuggestions([makeInsight({ type: 'orphaned-modules' })], emptyGraph());
      expect(result[0]!.suggestions.every((s) => s.effort === 'low')).toBe(true);
    });

    it('circular-imports has high effort', () => {
      const result = enrichWithSuggestions([makeInsight({ type: 'circular-imports' })], emptyGraph());
      expect(result[0]!.suggestions.every((s) => s.effort === 'high')).toBe(true);
    });

    it('god-class has medium effort', () => {
      const result = enrichWithSuggestions([makeInsight({ type: 'god-class' })], emptyGraph());
      expect(result[0]!.suggestions.every((s) => s.effort === 'medium')).toBe(true);
    });

    it('deep-inheritance has high effort', () => {
      const result = enrichWithSuggestions([makeInsight({ type: 'deep-inheritance' })], emptyGraph());
      expect(result[0]!.suggestions.every((s) => s.effort === 'high')).toBe(true);
    });
  });

  it('handles multiple insights at once', () => {
    const insights = [
      makeInsight({ type: 'god-class' }),
      makeInsight({ type: 'orphaned-modules' }),
      makeInsight({ type: 'barrel-file-depth' }),
    ];
    const result = enrichWithSuggestions(insights, emptyGraph());

    expect(result).toHaveLength(3);
    expect(result[0]!.suggestions.length).toBeGreaterThan(0);
    expect(result[1]!.suggestions.length).toBeGreaterThan(0);
    expect(result[2]!.suggestions).toEqual([]);
  });
});
