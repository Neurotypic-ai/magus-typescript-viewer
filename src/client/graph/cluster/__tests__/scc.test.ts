import { computeSccs, collapseSccs } from '../scc';

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

function depEdge(source: string, target: string, type: string = 'dependency'): GraphEdge {
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
    .sort((a, b) => a.memberIds[0]!.localeCompare(b.memberIds[0]!));
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
    expect(sccs[0]!.memberIds).toEqual(['A', 'B', 'C']);
  });

  it('finds one SCC for a 2-node cycle (A<->B)', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]!.memberIds).toEqual(['A', 'B']);
  });

  it('finds two separate SCCs for two disjoint cycles', () => {
    const nodes = [
      moduleNode('A'),
      moduleNode('B'),
      moduleNode('C'),
      moduleNode('X'),
      moduleNode('Y'),
    ];
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
    expect(sccs[0]!.memberIds).toEqual(['A', 'B', 'C']);
    expect(sccs[1]!.memberIds).toEqual(['X', 'Y']);
  });

  it('returns no components for a DAG with no cycles', () => {
    //    A
    //   / \
    //  B   C
    //   \ /
    //    D
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C'), moduleNode('D')];
    const edges = [
      depEdge('A', 'B'),
      depEdge('A', 'C'),
      depEdge('B', 'D'),
      depEdge('C', 'D'),
    ];

    const result = computeSccs(nodes, edges);
    expect(result).toEqual([]);
  });

  it('handles a fully-connected 4-node cycle', () => {
    // A->B->C->D->A (one big cycle)
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C'), moduleNode('D')];
    const edges = [
      depEdge('A', 'B'),
      depEdge('B', 'C'),
      depEdge('C', 'D'),
      depEdge('D', 'A'),
    ];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]!.memberIds).toEqual(['A', 'B', 'C', 'D']);
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
    expect(sccs[0]!.memberIds).toEqual(['A', 'B', 'C']);
  });

  it('SCC id is deterministic based on sorted member ids', () => {
    const nodes = [moduleNode('B'), moduleNode('A')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const sccs = computeSccs(nodes, edges);
    expect(sccs).toHaveLength(1);

    // The id format is `scc:` followed by sorted member ids joined by ','
    const scc = sccs[0]!;
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
    const edges = [
      depEdge('A', 'B'),
      depEdge('B', 'C'),
      depEdge('C', 'A'),
      depEdge('B', 'D'),
      depEdge('D', 'C'),
    ];

    const sccs = normalisedSccs(nodes, edges);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]!.memberIds).toEqual(['A', 'B', 'C', 'D']);
  });

  it('handles self-loops (no SCC since single member)', () => {
    // A self-loop forms a trivially "strongly connected" single node,
    // but the implementation drops singletons.
    const nodes = [moduleNode('A')];
    const edges = [depEdge('A', 'A')];

    expect(computeSccs(nodes, edges)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collapseSccs
// ---------------------------------------------------------------------------

describe('collapseSccs', () => {
  it('returns input unchanged when there are no cycles', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];
    const edges = [depEdge('A', 'B')];

    const result = collapseSccs(nodes, edges);
    expect(result.nodes).toBe(nodes); // same reference — no copy
    expect(result.edges).toBe(edges);
  });

  it('creates a group node for a cycle', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const result = collapseSccs(nodes, edges);
    const groupNodes = result.nodes.filter((n) => n.type === 'group');
    expect(groupNodes).toHaveLength(1);

    const group = groupNodes[0]!;
    expect(group.data.label).toBe('Cycle (2)');
    expect(group.id).toMatch(/^scc:/);
  });

  it('reparents SCC member nodes under the group node', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const result = collapseSccs(nodes, edges);
    const groupNodes = result.nodes.filter((n) => n.type === 'group');
    const groupId = groupNodes[0]!.id;

    const memberA = result.nodes.find((n) => n.id === 'A');
    const memberB = result.nodes.find((n) => n.id === 'B');

    expect(memberA).toBeDefined();
    expect(memberB).toBeDefined();
    expect(memberA!.parentNode).toBe(groupId);
    expect(memberB!.parentNode).toBe(groupId);
    expect((memberA as { extent?: string }).extent).toBe('parent');
    expect((memberB as { extent?: string }).extent).toBe('parent');
  });

  it('drops intra-SCC edges', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const result = collapseSccs(nodes, edges);
    // Both edges are within the same SCC, so all should be dropped
    expect(result.edges).toHaveLength(0);
  });

  it('redirects inter-SCC edges to group nodes', () => {
    // Cycle: A<->B, external node C with edge A->C
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C')];
    const edges = [
      depEdge('A', 'B'),
      depEdge('B', 'A'),
      depEdge('A', 'C'), // cross-SCC edge: A is in SCC, C is not
    ];

    const result = collapseSccs(nodes, edges);
    const groupNodes = result.nodes.filter((n) => n.type === 'group');
    expect(groupNodes).toHaveLength(1);

    const sccGroupId = groupNodes[0]!.id;

    // The edge from A->C should be redirected: source becomes the SCC group id
    const crossEdges = result.edges.filter((e) => e.target === 'C');
    expect(crossEdges).toHaveLength(1);
    expect(crossEdges[0]!.source).toBe(sccGroupId);
  });

  it('deduplicates edges that collapse to the same source/target/type', () => {
    // Cycle: A<->B, both A and B have edges to C
    const nodes = [moduleNode('A'), moduleNode('B'), moduleNode('C')];
    const edges = [
      depEdge('A', 'B'),
      depEdge('B', 'A'),
      depEdge('A', 'C'), // becomes sccGroup -> C
      depEdge('B', 'C'), // also becomes sccGroup -> C — should be deduped
    ];

    const result = collapseSccs(nodes, edges);
    const externalEdges = result.edges.filter((e) => e.target === 'C');
    expect(externalEdges).toHaveLength(1);
  });

  it('preserves non-module nodes unchanged', () => {
    const nodes = [moduleNode('A'), moduleNode('B'), classNode('CLS')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const result = collapseSccs(nodes, edges);
    const cls = result.nodes.find((n) => n.id === 'CLS');
    expect(cls).toBeDefined();
    expect(cls!.type).toBe('class');
    expect(cls!.parentNode).toBeUndefined();
  });

  it('handles two separate cycles creating two group nodes', () => {
    const nodes = [
      moduleNode('A'),
      moduleNode('B'),
      moduleNode('X'),
      moduleNode('Y'),
    ];
    const edges = [
      depEdge('A', 'B'),
      depEdge('B', 'A'),
      depEdge('X', 'Y'),
      depEdge('Y', 'X'),
    ];

    const result = collapseSccs(nodes, edges);
    const groupNodes = result.nodes.filter((n) => n.type === 'group');
    expect(groupNodes).toHaveLength(2);

    // Each group has label "Cycle (2)"
    expect(groupNodes.every((g) => g.data.label === 'Cycle (2)')).toBe(true);
  });

  it('sets expandParent on group nodes', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const result = collapseSccs(nodes, edges);
    const groupNodes = result.nodes.filter((n) => n.type === 'group');
    expect(groupNodes).toHaveLength(1);
    expect((groupNodes[0] as { expandParent?: boolean }).expandParent).toBe(true);
  });

  it('stores parentId in reparented node data', () => {
    const nodes = [moduleNode('A'), moduleNode('B')];
    const edges = [depEdge('A', 'B'), depEdge('B', 'A')];

    const result = collapseSccs(nodes, edges);
    const groupNodes = result.nodes.filter((n) => n.type === 'group');
    const sccGroupId = groupNodes[0]!.id;

    const memberA = result.nodes.find((n) => n.id === 'A');
    expect(memberA!.data).toHaveProperty('parentId', sccGroupId);
  });
});
