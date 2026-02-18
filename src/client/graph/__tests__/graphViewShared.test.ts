import {
  filterEdgesByNodeSet,
  bundleParallelEdges,
  applyEdgeVisibility,
} from '../graphViewShared';

import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string): DependencyNode {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { label: id },
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  type?: GraphEdge['data']['type'],
  extra?: Partial<GraphEdge['data']>,
): GraphEdge {
  return {
    id,
    source,
    target,
    data: { type, ...extra },
  };
}

/**
 * Generate N filler edges so the total count crosses the bundleParallelEdges
 * threshold of 50.  The filler edges use unique source/target pairs so they
 * don't interact with the edges under test.
 */
function makeFiller(count: number, startIndex = 0): GraphEdge[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = startIndex + i;
    return makeEdge(`filler-${idx}`, `filler-src-${idx}`, `filler-tgt-${idx}`, 'import');
  });
}

// ---------------------------------------------------------------------------
// filterEdgesByNodeSet
// ---------------------------------------------------------------------------

describe('filterEdgesByNodeSet', () => {
  it('returns edges whose source and target are both in the node set', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'c', 'import'),
      makeEdge('e3', 'c', 'a', 'import'),
    ];

    const result = filterEdgesByNodeSet(nodes, edges);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('e1');
  });

  it('returns an empty array when no edges match', () => {
    const nodes = [makeNode('x')];
    const edges = [makeEdge('e1', 'a', 'b', 'import')];
    expect(filterEdgesByNodeSet(nodes, edges)).toEqual([]);
  });

  it('returns an empty array when nodes are empty', () => {
    const edges = [makeEdge('e1', 'a', 'b', 'import')];
    expect(filterEdgesByNodeSet([], edges)).toEqual([]);
  });

  it('returns an empty array when edges are empty', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    expect(filterEdgesByNodeSet(nodes, [])).toEqual([]);
  });

  it('handles self-referencing edges', () => {
    const nodes = [makeNode('a')];
    const edges = [makeEdge('e1', 'a', 'a', 'uses')];
    const result = filterEdgesByNodeSet(nodes, edges);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('e1');
  });

  it('does not filter by edge type or data — only node membership', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge('e1', 'a', 'b'), // no type at all
      makeEdge('e2', 'a', 'b', 'dependency'),
    ];
    expect(filterEdgesByNodeSet(nodes, edges)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// bundleParallelEdges
// ---------------------------------------------------------------------------

describe('bundleParallelEdges', () => {
  it('returns edges unchanged when count is below 50', () => {
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', 'extends'),
    ];
    const result = bundleParallelEdges(edges);
    expect(result).toBe(edges); // exact same reference — early return
  });

  it('returns edges unchanged for exactly 49 edges', () => {
    const edges = makeFiller(49);
    const result = bundleParallelEdges(edges);
    expect(result).toBe(edges);
  });

  it('processes edges when count is exactly 50', () => {
    const edges = makeFiller(50);
    const result = bundleParallelEdges(edges);
    // All filler edges have unique source/target, so nothing gets bundled
    expect(result).toHaveLength(50);
    // But it should NOT be the same reference (it goes through the map path)
    expect(result).not.toBe(edges);
  });

  it('bundles parallel edges with the same source and target', () => {
    const parallelEdges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', 'extends'),
      makeEdge('e3', 'a', 'b', 'implements'),
    ];
    const edges = [...parallelEdges, ...makeFiller(47)];

    const result = bundleParallelEdges(edges);
    const bundled = result.find(
      (e) => e.source === 'a' && e.target === 'b',
    );

    expect(bundled).toBeDefined();
    expect(bundled!.data?.bundledCount).toBe(3);
    expect(bundled!.data?.bundledTypes).toEqual(
      expect.arrayContaining(['import', 'extends', 'implements']),
    );
    expect(bundled!.data?.bundledTypes).toHaveLength(3);
  });

  it('picks the highest-priority edge type as the representative', () => {
    // Priority: contains=5, inheritance=4, implements=3, import=1
    const parallelEdges = [
      makeEdge('e1', 'a', 'b', 'import'),      // priority 1
      makeEdge('e2', 'a', 'b', 'inheritance'),  // priority 4
      makeEdge('e3', 'a', 'b', 'implements'),   // priority 3
    ];
    const edges = [...parallelEdges, ...makeFiller(47)];

    const result = bundleParallelEdges(edges);
    const bundled = result.find(
      (e) => e.source === 'a' && e.target === 'b',
    );

    // Representative should be the highest-priority: 'inheritance'
    expect(bundled!.data?.type).toBe('inheritance');
  });

  it('does NOT bundle highway segment edges', () => {
    const highwayEdges = [
      makeEdge('h1', 'a', 'b', 'import', { highwaySegment: 'highway' }),
      makeEdge('h2', 'a', 'b', 'extends'),
    ];
    const edges = [...highwayEdges, ...makeFiller(48)];

    const result = bundleParallelEdges(edges);
    // Both highway edges should be preserved as separate entries
    const abEdges = result.filter(
      (e) => e.source === 'a' && e.target === 'b',
    );
    expect(abEdges).toHaveLength(2);
  });

  it('leaves single edges in a group untouched', () => {
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      ...makeFiller(49),
    ];

    const result = bundleParallelEdges(edges);
    const solo = result.find((e) => e.id === 'e1');
    expect(solo).toBeDefined();
    expect(solo!.data?.bundledCount).toBeUndefined();
  });

  it('sets hidden=false when any edge in the group is visible', () => {
    const parallelEdges: GraphEdge[] = [
      { ...makeEdge('e1', 'a', 'b', 'import'), hidden: true },
      { ...makeEdge('e2', 'a', 'b', 'extends'), hidden: false },
      { ...makeEdge('e3', 'a', 'b', 'implements'), hidden: true },
    ];
    const edges = [...parallelEdges, ...makeFiller(47)];

    const result = bundleParallelEdges(edges);
    const bundled = result.find(
      (e) => e.source === 'a' && e.target === 'b',
    );
    expect(bundled!.hidden).toBe(false);
  });

  it('sets hidden=true when all edges in the group are hidden', () => {
    const parallelEdges: GraphEdge[] = [
      { ...makeEdge('e1', 'a', 'b', 'import'), hidden: true },
      { ...makeEdge('e2', 'a', 'b', 'extends'), hidden: true },
    ];
    const edges = [...parallelEdges, ...makeFiller(48)];

    const result = bundleParallelEdges(edges);
    const bundled = result.find(
      (e) => e.source === 'a' && e.target === 'b',
    );
    expect(bundled!.hidden).toBe(true);
  });

  it('handles empty edge array', () => {
    const result = bundleParallelEdges([]);
    expect(result).toEqual([]);
  });

  it('deduplicates bundledTypes when multiple edges share the same type', () => {
    const parallelEdges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', 'import'),
      makeEdge('e3', 'a', 'b', 'extends'),
    ];
    const edges = [...parallelEdges, ...makeFiller(47)];

    const result = bundleParallelEdges(edges);
    const bundled = result.find(
      (e) => e.source === 'a' && e.target === 'b',
    );
    expect(bundled!.data?.bundledTypes).toEqual(
      expect.arrayContaining(['import', 'extends']),
    );
    expect(bundled!.data?.bundledTypes).toHaveLength(2);
    expect(bundled!.data?.bundledCount).toBe(3);
  });

  it('handles edges with undefined type in bundledTypes filtering', () => {
    const parallelEdges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', undefined), // no type
    ];
    const edges = [...parallelEdges, ...makeFiller(48)];

    const result = bundleParallelEdges(edges);
    const bundled = result.find(
      (e) => e.source === 'a' && e.target === 'b',
    );
    // undefined types should be filtered out of bundledTypes
    expect(bundled!.data?.bundledTypes).toEqual(['import']);
    expect(bundled!.data?.bundledCount).toBe(2);
  });

  it('bundles multiple independent groups separately', () => {
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', 'extends'),
      makeEdge('e3', 'c', 'd', 'implements'),
      makeEdge('e4', 'c', 'd', 'inheritance'),
      ...makeFiller(46),
    ];

    const result = bundleParallelEdges(edges);
    const abBundle = result.find((e) => e.source === 'a' && e.target === 'b');
    const cdBundle = result.find((e) => e.source === 'c' && e.target === 'd');

    expect(abBundle!.data?.bundledCount).toBe(2);
    expect(cdBundle!.data?.bundledCount).toBe(2);
  });

  it('does not bundle edges with same source but different target', () => {
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'c', 'import'),
      ...makeFiller(48),
    ];

    const result = bundleParallelEdges(edges);
    const ab = result.find((e) => e.source === 'a' && e.target === 'b');
    const ac = result.find((e) => e.source === 'a' && e.target === 'c');

    expect(ab).toBeDefined();
    expect(ac).toBeDefined();
    expect(ab!.data?.bundledCount).toBeUndefined();
    expect(ac!.data?.bundledCount).toBeUndefined();
  });

  it('treats edges a->b and b->a as different groups (direction matters)', () => {
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'b', 'a', 'import'),
      ...makeFiller(48),
    ];

    const result = bundleParallelEdges(edges);
    const ab = result.find((e) => e.source === 'a' && e.target === 'b');
    const ba = result.find((e) => e.source === 'b' && e.target === 'a');

    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
    // Both are solo edges, so no bundling metadata
    expect(ab!.data?.bundledCount).toBeUndefined();
    expect(ba!.data?.bundledCount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyEdgeVisibility
// ---------------------------------------------------------------------------

describe('applyEdgeVisibility', () => {
  it('shows edges whose type is in the enabled set', () => {
    const edges = [makeEdge('e1', 'a', 'b', 'import')];
    const result = applyEdgeVisibility(edges, ['import']);
    expect(result[0]!.hidden).toBe(false);
  });

  it('hides edges whose type is not in the enabled set', () => {
    const edges = [makeEdge('e1', 'a', 'b', 'import')];
    const result = applyEdgeVisibility(edges, ['extends']);
    expect(result[0]!.hidden).toBe(true);
  });

  it('always shows "uses" edges regardless of enabled types', () => {
    const edges = [makeEdge('e1', 'a', 'b', 'uses')];
    const result = applyEdgeVisibility(edges, []);
    expect(result[0]!.hidden).toBe(false);
  });

  it('always shows "contains" edges regardless of enabled types', () => {
    const edges = [makeEdge('e1', 'a', 'b', 'contains')];
    const result = applyEdgeVisibility(edges, []);
    expect(result[0]!.hidden).toBe(false);
  });

  it('shows edges with no type (undefined)', () => {
    const edges = [makeEdge('e1', 'a', 'b', undefined)];
    const result = applyEdgeVisibility(edges, []);
    expect(result[0]!.hidden).toBe(false);
  });

  it('handles an empty enabled list — only uses/contains/untyped remain visible', () => {
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', 'extends'),
      makeEdge('e3', 'a', 'b', 'uses'),
      makeEdge('e4', 'a', 'b', 'contains'),
      makeEdge('e5', 'a', 'b', undefined),
    ];
    const result = applyEdgeVisibility(edges, []);

    expect(result[0]!.hidden).toBe(true);   // import
    expect(result[1]!.hidden).toBe(true);   // extends
    expect(result[2]!.hidden).toBe(false);  // uses
    expect(result[3]!.hidden).toBe(false);  // contains
    expect(result[4]!.hidden).toBe(false);  // undefined type
  });

  it('handles empty edges array', () => {
    expect(applyEdgeVisibility([], ['import'])).toEqual([]);
  });

  it('returns new edge objects (does not mutate originals)', () => {
    const edges = [makeEdge('e1', 'a', 'b', 'import')];
    const result = applyEdgeVisibility(edges, ['import']);
    expect(result[0]).not.toBe(edges[0]);
  });

  it('handles multiple enabled types correctly', () => {
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', 'extends'),
      makeEdge('e3', 'a', 'b', 'implements'),
      makeEdge('e4', 'a', 'b', 'dependency'),
    ];
    const result = applyEdgeVisibility(edges, ['import', 'extends']);

    expect(result[0]!.hidden).toBe(false);  // import — enabled
    expect(result[1]!.hidden).toBe(false);  // extends — enabled
    expect(result[2]!.hidden).toBe(true);   // implements — not enabled
    expect(result[3]!.hidden).toBe(true);   // dependency — not enabled
  });

  it('preserves all other edge properties', () => {
    const edge = makeEdge('e1', 'a', 'b', 'import');
    edge.pathOptions = { offset: 10, borderRadius: 5 };
    const result = applyEdgeVisibility([edge], ['import']);

    expect(result[0]!.id).toBe('e1');
    expect(result[0]!.source).toBe('a');
    expect(result[0]!.target).toBe('b');
    expect(result[0]!.data?.type).toBe('import');
    expect(result[0]!.pathOptions).toEqual({ offset: 10, borderRadius: 5 });
  });
});
