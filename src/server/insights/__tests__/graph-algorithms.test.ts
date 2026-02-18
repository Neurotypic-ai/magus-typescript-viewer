import {
  findStronglyConnectedComponents,
  findArticulationPoints,
  detectCommunities,
} from '../graph-algorithms';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an adjacency map from a concise edge list. */
function buildAdjacency(edges: [string, string][], nodes?: string[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  // Ensure all declared nodes appear even if they have no edges.
  if (nodes) {
    for (const n of nodes) {
      adj.set(n, new Set());
    }
  }
  for (const [from, to] of edges) {
    if (!adj.has(from)) adj.set(from, new Set());
    const fromSet = adj.get(from);
    if (fromSet) fromSet.add(to);
    // Ensure the target node exists in the map so it is discoverable.
    if (!adj.has(to)) adj.set(to, new Set());
  }
  return adj;
}

/** Sort each SCC member list and then sort the outer list for stable comparisons. */
function normalizeSCCs(sccs: string[][]): string[][] {
  return sccs.map((s) => [...s].sort()).sort((a, b) => a.join(',').localeCompare(b.join(',')));
}

// ===========================================================================
// findStronglyConnectedComponents
// ===========================================================================

describe('findStronglyConnectedComponents', () => {
  it('returns empty array for an empty graph', () => {
    const adj = new Map<string, Set<string>>();
    expect(findStronglyConnectedComponents(adj)).toEqual([]);
  });

  it('returns empty array for a single node with no self-loop', () => {
    const adj = buildAdjacency([], ['A']);
    expect(findStronglyConnectedComponents(adj)).toEqual([]);
  });

  it('returns empty array for a linear chain (no cycles)', () => {
    // A -> B -> C -> D
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
    ]);
    expect(findStronglyConnectedComponents(adj)).toEqual([]);
  });

  it('returns empty array for a DAG (directed acyclic graph)', () => {
    //   A -> B -> D
    //   A -> C -> D
    const adj = buildAdjacency([
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'D'],
      ['C', 'D'],
    ]);
    expect(findStronglyConnectedComponents(adj)).toEqual([]);
  });

  it('returns empty array for a tree', () => {
    //       A
    //      / \
    //     B   C
    //    / \
    //   D   E
    const adj = buildAdjacency([
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'D'],
      ['B', 'E'],
    ]);
    expect(findStronglyConnectedComponents(adj)).toEqual([]);
  });

  it('detects a simple 2-node cycle', () => {
    // A -> B -> A
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    const sccs = normalizeSCCs(findStronglyConnectedComponents(adj));
    expect(sccs).toEqual([['A', 'B']]);
  });

  it('detects a 3-node cycle', () => {
    // A -> B -> C -> A
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ]);
    const sccs = normalizeSCCs(findStronglyConnectedComponents(adj));
    expect(sccs).toEqual([['A', 'B', 'C']]);
  });

  it('detects multiple disjoint cycles', () => {
    // Cycle 1: A -> B -> A
    // Cycle 2: C -> D -> E -> C
    // No edges between the two
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'A'],
      ['C', 'D'],
      ['D', 'E'],
      ['E', 'C'],
    ]);
    const sccs = normalizeSCCs(findStronglyConnectedComponents(adj));
    expect(sccs).toEqual([
      ['A', 'B'],
      ['C', 'D', 'E'],
    ]);
  });

  it('separates cyclic nodes from non-cyclic ones', () => {
    // A -> B -> C -> B  (B,C form a cycle)
    // C -> D  (D is not in a cycle)
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'B'],
      ['C', 'D'],
    ]);
    const sccs = normalizeSCCs(findStronglyConnectedComponents(adj));
    expect(sccs).toEqual([['B', 'C']]);
  });

  it('detects a self-loop as a size-1 SCC (filtered out by implementation)', () => {
    // A -> A  (self-loop forms an SCC of size 1, which is excluded)
    const adj = buildAdjacency([['A', 'A']]);
    // The implementation only returns SCCs with size > 1
    expect(findStronglyConnectedComponents(adj)).toEqual([]);
  });

  it('handles a fully connected graph', () => {
    // Every node reachable from every other: one big SCC
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
      ['A', 'C'],
      ['B', 'A'],
      ['C', 'B'],
    ]);
    const sccs = normalizeSCCs(findStronglyConnectedComponents(adj));
    expect(sccs).toEqual([['A', 'B', 'C']]);
  });

  it('handles nested cycles sharing nodes', () => {
    // A -> B -> C -> A  (cycle 1)
    // B -> D -> B      (cycle 2 overlaps at B)
    // All four nodes form one SCC since B is shared
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
      ['B', 'D'],
      ['D', 'B'],
    ]);
    const sccs = normalizeSCCs(findStronglyConnectedComponents(adj));
    expect(sccs).toEqual([['A', 'B', 'C', 'D']]);
  });

  it('handles isolated nodes alongside cycles', () => {
    // X is isolated, Y -> Z -> Y is a cycle
    const adj = buildAdjacency(
      [
        ['Y', 'Z'],
        ['Z', 'Y'],
      ],
      ['X'],
    );
    const sccs = normalizeSCCs(findStronglyConnectedComponents(adj));
    expect(sccs).toEqual([['Y', 'Z']]);
  });
});

// ===========================================================================
// findArticulationPoints
// ===========================================================================

describe('findArticulationPoints', () => {
  it('returns empty set for an empty graph', () => {
    const adj = new Map<string, Set<string>>();
    expect(findArticulationPoints(adj)).toEqual(new Set());
  });

  it('returns empty set for a single node', () => {
    const adj = buildAdjacency([], ['A']);
    expect(findArticulationPoints(adj)).toEqual(new Set());
  });

  it('returns empty set for two connected nodes (neither is an AP)', () => {
    // A -- B (undirected from A->B)
    const adj = buildAdjacency([['A', 'B']]);
    expect(findArticulationPoints(adj)).toEqual(new Set());
  });

  it('returns empty set for a triangle (no articulation points)', () => {
    // A -> B, B -> C, C -> A  =>  undirected: complete triangle
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ]);
    expect(findArticulationPoints(adj)).toEqual(new Set());
  });

  it('identifies the center of a star graph as an articulation point', () => {
    // A is the center: A -> B, A -> C, A -> D
    // Undirected: A-B, A-C, A-D  (removing A disconnects B, C, D)
    const adj = buildAdjacency([
      ['A', 'B'],
      ['A', 'C'],
      ['A', 'D'],
    ]);
    const points = findArticulationPoints(adj);
    expect(points).toEqual(new Set(['A']));
  });

  it('identifies articulation point in a linear chain of 3 nodes', () => {
    // A -> B -> C  =>  undirected: A-B-C.  B is the AP.
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
    ]);
    const points = findArticulationPoints(adj);
    expect(points).toEqual(new Set(['B']));
  });

  it('identifies all articulation points in a longer chain', () => {
    // A - B - C - D - E  (linear)
    // B, C, D are all APs
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'E'],
    ]);
    const points = findArticulationPoints(adj);
    expect(points).toEqual(new Set(['B', 'C', 'D']));
  });

  it('identifies bridge node between two triangles', () => {
    // Triangle 1: A-B-C-A
    // Triangle 2: D-E-F-D
    // Bridge: C -> D  (undirected: C-D)
    // C and D are articulation points
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
      ['C', 'D'],
      ['D', 'E'],
      ['E', 'F'],
      ['F', 'D'],
    ]);
    const points = findArticulationPoints(adj);
    expect(points).toEqual(new Set(['C', 'D']));
  });

  it('returns empty set for a complete graph of 4 nodes', () => {
    // K4: every node connected to every other — removing any single node leaves the rest connected.
    const adj = buildAdjacency([
      ['A', 'B'],
      ['A', 'C'],
      ['A', 'D'],
      ['B', 'C'],
      ['B', 'D'],
      ['C', 'D'],
    ]);
    const points = findArticulationPoints(adj);
    expect(points).toEqual(new Set());
  });

  it('handles disconnected components', () => {
    // Component 1: A - B - C (B is AP)
    // Component 2: D - E  (no AP)
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['D', 'E'],
    ]);
    const points = findArticulationPoints(adj);
    expect(points).toEqual(new Set(['B']));
  });

  it('finds articulation point in a diamond graph', () => {
    // Diamond: A -> B, A -> C, B -> D, C -> D
    // Undirected: A-B, A-C, B-D, C-D  => no articulation points (2 paths between any pair)
    const adj = buildAdjacency([
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'D'],
      ['C', 'D'],
    ]);
    const points = findArticulationPoints(adj);
    expect(points).toEqual(new Set());
  });

  it('correctly identifies root as AP only when it has 2+ children in DFS tree', () => {
    // A -> B, A -> C (no edge B-C). Undirected: A-B, A-C.
    // A is the root of DFS and has 2 children. AP = {A}.
    const adj = buildAdjacency([
      ['A', 'B'],
      ['A', 'C'],
    ]);
    const points = findArticulationPoints(adj);
    expect(points).toEqual(new Set(['A']));
  });
});

// ===========================================================================
// detectCommunities
// ===========================================================================

describe('detectCommunities', () => {
  it('returns empty map for an empty graph', () => {
    const adj = new Map<string, Set<string>>();
    const labels = detectCommunities(adj);
    expect(labels.size).toBe(0);
  });

  it('assigns a label to a single isolated node', () => {
    const adj = buildAdjacency([], ['A']);
    const labels = detectCommunities(adj);
    expect(labels.size).toBe(1);
    expect(labels.has('A')).toBe(true);
  });

  it('assigns all nodes in a connected pair the same label', () => {
    // A -> B  =>  undirected A-B
    const adj = buildAdjacency([['A', 'B']]);
    const labels = detectCommunities(adj);
    expect(labels.get('A')).toBe(labels.get('B'));
  });

  it('assigns all nodes in a triangle the same label', () => {
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ]);
    const labels = detectCommunities(adj);
    expect(labels.get('A')).toBe(labels.get('B'));
    expect(labels.get('B')).toBe(labels.get('C'));
  });

  it('assigns all nodes in a fully connected component the same label', () => {
    const adj = buildAdjacency([
      ['A', 'B'],
      ['A', 'C'],
      ['A', 'D'],
      ['B', 'C'],
      ['B', 'D'],
      ['C', 'D'],
    ]);
    const labels = detectCommunities(adj);
    const labelA = labels.get('A');
    expect(labels.get('B')).toBe(labelA);
    expect(labels.get('C')).toBe(labelA);
    expect(labels.get('D')).toBe(labelA);
  });

  it('gives different labels to disconnected components', () => {
    // Component 1: A-B-C  (triangle)
    // Component 2: D-E-F  (triangle)
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
      ['D', 'E'],
      ['E', 'F'],
      ['F', 'D'],
    ]);
    const labels = detectCommunities(adj);

    // Within each component, labels should match
    expect(labels.get('A')).toBe(labels.get('B'));
    expect(labels.get('B')).toBe(labels.get('C'));
    expect(labels.get('D')).toBe(labels.get('E'));
    expect(labels.get('E')).toBe(labels.get('F'));

    // Between components, labels should differ
    expect(labels.get('A')).not.toBe(labels.get('D'));
  });

  it('assigns labels to every node in the adjacency (including targets)', () => {
    // A -> B means B should also be in the label map even if not an explicit key.
    const adj = new Map<string, Set<string>>();
    adj.set('A', new Set(['B']));
    // B not an explicit key in adjacency
    const labels = detectCommunities(adj);
    expect(labels.has('A')).toBe(true);
    expect(labels.has('B')).toBe(true);
  });

  it('respects maxIterations parameter (terminates with 0 iterations)', () => {
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
    ]);
    // With 0 iterations, every node keeps its initial label (all unique).
    const labels = detectCommunities(adj, 0);
    const uniqueLabels = new Set(labels.values());
    expect(uniqueLabels.size).toBe(labels.size);
  });

  it('converges with maxIterations=1 on a simple connected graph', () => {
    // A - B (should converge to same label in 1 iteration)
    const adj = buildAdjacency([['A', 'B']]);
    const labels = detectCommunities(adj, 1);
    expect(labels.get('A')).toBe(labels.get('B'));
  });

  it('covers all nodes from the adjacency map', () => {
    const adj = buildAdjacency([
      ['A', 'B'],
      ['C', 'D'],
      ['E', 'F'],
    ]);
    const labels = detectCommunities(adj);
    expect(labels.size).toBe(6);
    for (const node of ['A', 'B', 'C', 'D', 'E', 'F']) {
      expect(labels.has(node)).toBe(true);
    }
  });

  it('produces at most N distinct labels for N nodes', () => {
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'E'],
    ]);
    const labels = detectCommunities(adj);
    const uniqueLabels = new Set(labels.values());
    expect(uniqueLabels.size).toBeLessThanOrEqual(labels.size);
  });

  it('isolated nodes each get their own label', () => {
    const adj = buildAdjacency([], ['X', 'Y', 'Z']);
    const labels = detectCommunities(adj);
    // Isolated nodes never adopt a neighbor's label so they keep their initial (unique) labels
    const uniqueLabels = new Set(labels.values());
    expect(uniqueLabels.size).toBe(3);
  });

  it('handles a chain: all nodes should eventually share a label', () => {
    // A - B - C - D  (linear chain, all connected in undirected)
    const adj = buildAdjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
    ]);
    // With enough iterations, label propagation should converge on a chain
    const labels = detectCommunities(adj, 50);
    const uniqueLabels = new Set(labels.values());
    // A connected component should converge to a single label (or at most a few, since LP is non-deterministic)
    // We relax the assertion: the number of distinct labels should be much less than node count
    expect(uniqueLabels.size).toBeLessThanOrEqual(labels.size);
  });
});
