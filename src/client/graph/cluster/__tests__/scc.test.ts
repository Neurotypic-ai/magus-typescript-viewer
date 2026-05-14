import { assert, describe, expect, it } from 'vitest';

import { computeSccs } from '../scc';

import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function moduleNode(id: string): DependencyNode {
  return {
    id,
    type: 'module',
    position: { x: 0, y: 0 },
    data: { label: id },
  } as DependencyNode;
}

function classNode(id: string): DependencyNode {
  return {
    id,
    type: 'class',
    position: { x: 0, y: 0 },
    data: { label: id },
  } as DependencyNode;
}

function depEdge(source: string, target: string, type = 'dependency'): GraphEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    hidden: false,
    data: { type },
  } as GraphEdge;
}

/**
 * Sorts SCC results for deterministic comparison.
 * Each SCC's memberIds are sorted, then the list of SCCs is sorted
 * by their first member id.
 */
function normalisedSccs(nodes: DependencyNode[], edges: GraphEdge[]) {
  const sccs = computeSccs(nodes, edges);
  return sccs
    .map((scc) => ({ ...scc, memberIds: [...scc.memberIds].sort() }))
    .sort((a, b) => (a.memberIds[0] ?? '').localeCompare(b.memberIds[0] ?? ''));
}

// ---------------------------------------------------------------------------
// computeSccs
// ---------------------------------------------------------------------------

describe('computeSccs', () => {
  // Note: The implementation only returns SCCs with more than 1 member.
  // Singleton nodes are intentionally excluded.

  it('returns no components for an empty graph', () => {
    const result = computeSccs([], []);
    expect(result).toEqual([]);
  });

  it('returns no components for a single node (singleton is excluded)', () => {
    const result = computeSccs([moduleNode('A')], []);
    expect(result).toEqual([]);
  });

  it('returns no components for a linear chain (A->B->C) — all singletons', () => {
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'C')];

    const result = computeSccs(nodes, edges);
    expect(result).toEqual([]);
  });

  it('finds one SCC for a simple 3-node cycle (A->B->C->A)', () => {
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'C'), depEdge('C', 'A')];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]?.memberIds).toEqual(['A', 'B', 'C']);
  });

  it('finds one SCC for a 2-node cycle (A<->B)', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]?.memberIds).toEqual(['A', 'B']);
  });

  it('finds two separate SCCs for two disjoint cycles', () => {
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C'), moduleNode('X'), moduleNode('Y')];
    const edges = [
      // cycle 1: A->B->C->A
      depEdge('A', 'B'),
      depEdge('B', 'C'),
      depEdge('C', 'A'),
      // cycle 2: X->Y->X
      depEdge('X', 'Y'),
      depEdge('Y', 'X'),
    ];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(2);
    expect(sccs[0]?.memberIds).toEqual(['A', 'B', 'C']);
    expect(sccs[1]?.memberIds).toEqual(['X', 'Y']);
  });

  it('returns no components for a DAG with no cycles', () => {
    //    A
    //   / \
    //  B   C
    //   \ /
    //    D
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C'), moduleNode('D')];
    const edges = [depEdge('A', 'B'), depEdge('A', 'C'), depEdge('B', 'D'), depEdge('C', 'D')];

    const result = computeSccs(nodes, edges);
    expect(result).toEqual([]);
  });

  it('handles a fully-connected 4-node cycle', () => {
    // A->B->C->D->A (one big cycle)
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C'), moduleNode('D')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'C'), depEdge('C', 'D'), depEdge('D', 'A')];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]?.memberIds).toEqual(['A', 'B', 'C', 'D']);
  });

  it('separates a cycle from a linear tail (A->B->C->A, C->D)', () => {
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C'), moduleNode('D')];
    const edges = [
      depEdge('A', 'B'),
      depEdge('B', 'C'),
      depEdge('C', 'A'),
      depEdge('C', 'D'), // tail — D is not part of the cycle
    ];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]?.memberIds).toEqual(['A', 'B', 'C']);
  });

  it('SCC id is deterministic based on sorted member ids', () => {
    const nodes = [moduleNode('B'), moduleNode('A')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const sccs = computeSccs(nodes, edges);
    expect(sccs).toHaveLength(1);

    // The id format is `scc:` followed by sorted member ids joined by ','
    const scc = sccs[0];
    assert(scc !== undefined);
    const sortedMembers = [...scc.memberIds].sort().join(',');
    expect(scc.id).toBe(`scc:${sortedMembers}`);
  });

  // -------------------------------------------------------------------------
  // Edge type filtering
  // -------------------------------------------------------------------------

  describe('edge type filtering', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];

    it('considers edges with type "import"', () => {
      const edges = [depEdge('A', 'B', 'import'), depEdge('B', 'A', 'import')];
      expect(computeSccs(nodes, edges)).toHaveLength(1);
    });

    it('considers edges with type "export"', () => {
      const edges = [depEdge('A', 'B', 'export'), depEdge('B', 'A', 'export')];
      expect(computeSccs(nodes, edges)).toHaveLength(1);
    });

    it('considers edges with type "dependency"', () => {
      const edges = [depEdge('A', 'B', 'dependency'), depEdge('B', 'A', 'dependency')];
      expect(computeSccs(nodes, edges)).toHaveLength(1);
    });

    it('defaults to "dependency" when edge data.type is undefined', () => {
      const edges: GraphEdge[] = [
        { id: 'e1', source: 'A', target: 'B', hidden: false, data: {} } as GraphEdge,
        { id: 'e2', source: 'B', target: 'A', hidden: false, data: {} } as GraphEdge,
      ];
      expect(computeSccs(nodes, edges)).toHaveLength(1);
    });

    it('ignores edges with unsupported types (e.g. "implements")', () => {
      const edges = [depEdge('A', 'B', 'implements'), depEdge('B', 'A', 'implements')];
      expect(computeSccs(nodes, edges)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Node type filtering
  // -------------------------------------------------------------------------

  describe('node type filtering', () => {
    it('only considers module-type nodes', () => {
      // Class nodes form a cycle, but should be ignored by the adjacency builder
      const nodes = [classNode('A'), classNode('B')];
      const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

      expect(computeSccs(nodes, edges)).toEqual([]);
    });

    it('ignores edges that reference non-module nodes', () => {
      const nodes = [moduleNode('A'), classNode('B')];
      const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

      expect(computeSccs(nodes, edges)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Complex graph
  // -------------------------------------------------------------------------

  it('identifies overlapping cycles merged into one SCC', () => {
    // A->B->C->A and B->D->C form cycles that share nodes B and C
    // So A, B, C, D should all be in one SCC
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C'), moduleNode('D')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'C'), depEdge('C', 'A'), depEdge('B', 'D'), depEdge('D', 'C')];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]?.memberIds).toEqual(['A', 'B', 'C', 'D']);
  });

  it('handles self-loops (no SCC since single member)', () => {
    // A self-loop forms a trivially "strongly connected" single node,
    // but the implementation drops singletons.
    const nodes = [moduleNode('A')];
    const edges = [depEdge('A', 'A')];

    expect(computeSccs(nodes, edges)).toEqual([]);
  });
});

