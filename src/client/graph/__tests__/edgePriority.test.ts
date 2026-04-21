import { describe, expect, it } from 'vitest';

import { EDGE_KIND_PRIORITY } from '../edgePriority';

import type { DependencyEdgeKind } from '../../../shared/types/graph/DependencyEdgeKind';

describe('EDGE_KIND_PRIORITY', () => {
  it('assigns a numeric priority to every DependencyEdgeKind', () => {
    const allKinds: DependencyEdgeKind[] = [
      'contains',
      'uses',
      'implements',
      'extends',
      'dependency',
      'import',
      'devDependency',
      'peerDependency',
      'export',
    ];

    for (const kind of allKinds) {
      expect(EDGE_KIND_PRIORITY[kind]).toBeDefined();
      expect(typeof EDGE_KIND_PRIORITY[kind]).toBe('number');
    }
  });

  it('has exactly 9 entries matching all DependencyEdgeKind values', () => {
    expect(Object.keys(EDGE_KIND_PRIORITY)).toHaveLength(9);
  });

  // ── Tier verification ─────────────────────────────────────────────────

  it('gives "contains" and "uses" the highest priority (5)', () => {
    expect(EDGE_KIND_PRIORITY.contains).toBe(5);
    expect(EDGE_KIND_PRIORITY.uses).toBe(5);
  });

  it('gives "extends" the second-highest priority (4)', () => {
    expect(EDGE_KIND_PRIORITY.extends).toBe(4);
  });

  it('gives "implements" priority 3', () => {
    expect(EDGE_KIND_PRIORITY.implements).toBe(3);
  });

  it('gives "dependency" priority 2', () => {
    expect(EDGE_KIND_PRIORITY.dependency).toBe(2);
  });

  it('gives "import" priority 1', () => {
    expect(EDGE_KIND_PRIORITY.import).toBe(1);
  });

  it('gives "devDependency", "peerDependency", and "export" the lowest priority (0)', () => {
    expect(EDGE_KIND_PRIORITY.devDependency).toBe(0);
    expect(EDGE_KIND_PRIORITY.peerDependency).toBe(0);
    expect(EDGE_KIND_PRIORITY.export).toBe(0);
  });

  // ── Relative ordering ─────────────────────────────────────────────────

  it('ranks structural edges (contains/uses) above type-relationship edges', () => {
    expect(EDGE_KIND_PRIORITY.contains).toBeGreaterThan(EDGE_KIND_PRIORITY.extends);
    expect(EDGE_KIND_PRIORITY.uses).toBeGreaterThan(EDGE_KIND_PRIORITY.implements);
    expect(EDGE_KIND_PRIORITY.uses).toBeGreaterThan(EDGE_KIND_PRIORITY.extends);
  });

  it('ranks extends above implements', () => {
    expect(EDGE_KIND_PRIORITY.extends).toBeGreaterThan(EDGE_KIND_PRIORITY.implements);
  });

  it('ranks implements/extends above dependency', () => {
    expect(EDGE_KIND_PRIORITY.implements).toBeGreaterThan(EDGE_KIND_PRIORITY.dependency);
    expect(EDGE_KIND_PRIORITY.extends).toBeGreaterThan(EDGE_KIND_PRIORITY.dependency);
  });

  it('ranks dependency above import', () => {
    expect(EDGE_KIND_PRIORITY.dependency).toBeGreaterThan(EDGE_KIND_PRIORITY.import);
  });

  it('ranks import above devDependency/peerDependency/export', () => {
    expect(EDGE_KIND_PRIORITY.import).toBeGreaterThan(EDGE_KIND_PRIORITY.devDependency);
    expect(EDGE_KIND_PRIORITY.import).toBeGreaterThan(EDGE_KIND_PRIORITY.peerDependency);
    expect(EDGE_KIND_PRIORITY.import).toBeGreaterThan(EDGE_KIND_PRIORITY.export);
  });

  // ── Sorting behavior ──────────────────────────────────────────────────

  it('sorts edge kinds by descending priority', () => {
    const kinds: DependencyEdgeKind[] = [
      'export',
      'import',
      'contains',
      'dependency',
      'extends',
      'uses',
      'devDependency',
      'implements',
      'peerDependency',
    ];

    const sorted = [...kinds].sort((a, b) => EDGE_KIND_PRIORITY[b] - EDGE_KIND_PRIORITY[a]);

    // Map to priorities for easier assertion
    const sortedPriorities = sorted.map((k) => EDGE_KIND_PRIORITY[k]);

    // First two should be the priority-5 kinds (contains/uses)
    expect(sortedPriorities[0]).toBe(5);
    expect(sortedPriorities[1]).toBe(5);

    // Next should be extends (4)
    expect(sorted[2]).toBe('extends');
    expect(sortedPriorities[2]).toBe(4);

    // Then implements (3)
    expect(sorted[3]).toBe('implements');
    expect(sortedPriorities[3]).toBe(3);

    // Then dependency (2)
    expect(sorted[4]).toBe('dependency');
    expect(sortedPriorities[4]).toBe(2);

    // Then import (1)
    expect(sorted[5]).toBe('import');
    expect(sortedPriorities[5]).toBe(1);

    // Remaining three all have priority 0
    expect(sortedPriorities[6]).toBe(0);
    expect(sortedPriorities[7]).toBe(0);
    expect(sortedPriorities[8]).toBe(0);
  });

  it('can select the highest-priority edge from a mixed set', () => {
    const edgeKinds: DependencyEdgeKind[] = ['import', 'dependency', 'extends', 'export'];

    const best = edgeKinds.reduce((a, b) => (EDGE_KIND_PRIORITY[a] >= EDGE_KIND_PRIORITY[b] ? a : b));

    expect(best).toBe('extends');
  });

  it('can select the highest-priority edge when multiple share top rank', () => {
    const edgeKinds: DependencyEdgeKind[] = ['contains', 'uses', 'import'];

    const best = edgeKinds.reduce((a, b) => (EDGE_KIND_PRIORITY[a] >= EDGE_KIND_PRIORITY[b] ? a : b));

    // Both contains and uses have priority 5; reduce with >= keeps the first one found
    expect(best).toBe('contains');
    expect(EDGE_KIND_PRIORITY[best]).toBe(5);
  });

  // ── Non-negative priorities ────────────────────────────────────────────

  it('has no negative priority values', () => {
    for (const value of Object.values(EDGE_KIND_PRIORITY)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
