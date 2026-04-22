import { describe, expect, it } from 'vitest';

import { layoutSCCInternal } from '../sccInternalLayout';

import type { GraphEdge } from '../../../types/GraphEdge';

function edge(id: string, source: string, target: string): GraphEdge {
  return {
    id,
    source,
    target,
    hidden: false,
    data: { type: 'import' },
  } as GraphEdge;
}

describe('layoutSCCInternal', () => {
  it('returns empty positions for an empty SCC', () => {
    const result = layoutSCCInternal([], [], 'scc:empty:0');
    expect(result.positions.size).toBe(0);
    expect(result.parentSize.width).toBeGreaterThan(0);
    expect(result.parentSize.height).toBeGreaterThan(0);
  });

  it('uses circular layout for small SCCs (< 10 members)', () => {
    const members = ['a', 'b', 'c', 'd'];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')];
    const result = layoutSCCInternal(members, edges, 'scc:a:4');
    expect(result.positions.size).toBe(4);
    for (const m of members) {
      const pos = result.positions.get(m);
      expect(pos).toBeDefined();
      expect(typeof pos?.x).toBe('number');
      expect(typeof pos?.y).toBe('number');
    }
    // Circular layout produces a square bounding box.
    expect(result.parentSize.width).toBe(result.parentSize.height);
  });

  it('produces non-overlapping positions for circular layout', () => {
    const members = ['a', 'b', 'c', 'd', 'e'];
    const result = layoutSCCInternal(members, [], 'scc:a:5');
    const seen = new Set<string>();
    for (const [, pos] of result.positions) {
      const key = `${String(Math.round(pos.x))}|${String(Math.round(pos.y))}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('is deterministic across runs for small SCCs', () => {
    const members = ['b', 'a', 'c'];
    const r1 = layoutSCCInternal(members, [], 'scc:a:3');
    const r2 = layoutSCCInternal(members, [], 'scc:a:3');
    for (const m of ['a', 'b', 'c']) {
      expect(r1.positions.get(m)?.x).toBe(r2.positions.get(m)?.x);
      expect(r1.positions.get(m)?.y).toBe(r2.positions.get(m)?.y);
    }
  });

  it('uses force-directed layout for large SCCs (>= 10 members)', () => {
    const members = Array.from({ length: 12 }, (_, i) => `m${String(i)}`);
    const edges = members.slice(0, -1).map((src, i) => edge(`e${String(i)}`, src, members[i + 1] ?? ''));
    const result = layoutSCCInternal(members, edges, 'scc:m0:12');
    expect(result.positions.size).toBe(12);
    // Parent size must be large enough to contain all positions.
    for (const [, pos] of result.positions) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThanOrEqual(result.parentSize.width);
      expect(pos.y).toBeLessThanOrEqual(result.parentSize.height);
    }
  });

  it('is deterministic across runs for large SCCs', () => {
    const members = Array.from({ length: 11 }, (_, i) => `m${String(i)}`);
    const edges = members.slice(0, -1).map((src, i) => edge(`e${String(i)}`, src, members[i + 1] ?? ''));
    const r1 = layoutSCCInternal(members, edges, 'scc:m0:11');
    const r2 = layoutSCCInternal(members, edges, 'scc:m0:11');
    for (const m of members) {
      expect(r1.positions.get(m)?.x).toBe(r2.positions.get(m)?.x);
      expect(r1.positions.get(m)?.y).toBe(r2.positions.get(m)?.y);
    }
  });

  it('scales the circle radius with the number of members', () => {
    const small = layoutSCCInternal(['a', 'b'], [], 'scc:a:2');
    const large = layoutSCCInternal(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], [], 'scc:a:9');
    expect(large.parentSize.width).toBeGreaterThan(small.parentSize.width);
  });
});
