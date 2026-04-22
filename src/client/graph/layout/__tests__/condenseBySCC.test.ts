import { describe, expect, it } from 'vitest';

import { computeStronglyConnectedComponents, condenseBySCC } from '../condenseBySCC';

import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

function node(id: string): DependencyNode {
  return {
    id,
    type: 'module',
    position: { x: 0, y: 0 },
    data: { label: id },
  } as DependencyNode;
}

function edge(id: string, source: string, target: string): GraphEdge {
  return {
    id,
    source,
    target,
    hidden: false,
    data: { type: 'import' },
  } as GraphEdge;
}

describe('computeStronglyConnectedComponents', () => {
  it('returns no components for an empty graph', () => {
    const { components, sccBackEdges } = computeStronglyConnectedComponents([], []);
    expect(components).toEqual([]);
    expect(sccBackEdges.size).toBe(0);
  });

  it('returns trivial components for a graph of isolated nodes', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const { components, sccBackEdges } = computeStronglyConnectedComponents(nodes, []);
    // Three singletons
    expect(components).toHaveLength(3);
    for (const c of components) expect(c.length).toBe(1);
    expect(sccBackEdges.size).toBe(0);
  });

  it('returns trivial components for a DAG (no cycles)', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    const { components, sccBackEdges } = computeStronglyConnectedComponents(nodes, edges);
    expect(components).toHaveLength(3);
    for (const c of components) expect(c.length).toBe(1);
    expect(sccBackEdges.size).toBe(0);
  });

  it('detects a 2-cycle as a single non-trivial component', () => {
    const nodes = [node('a'), node('b')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')];
    const { components, sccBackEdges } = computeStronglyConnectedComponents(nodes, edges);
    expect(components).toHaveLength(1);
    expect(components[0]).toEqual(['a', 'b']);
    expect(sccBackEdges.size).toBe(2);
    expect(sccBackEdges.has('e1')).toBe(true);
    expect(sccBackEdges.has('e2')).toBe(true);
  });

  it('detects a 3-cycle as a single non-trivial component', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'a')];
    const { components, sccBackEdges } = computeStronglyConnectedComponents(nodes, edges);
    expect(components).toHaveLength(1);
    expect(components[0]).toEqual(['a', 'b', 'c']);
    expect(sccBackEdges.size).toBe(3);
  });

  it('detects two disjoint 2-cycles as two independent components', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'b', 'a'),
      edge('e3', 'c', 'd'),
      edge('e4', 'd', 'c'),
    ];
    const { components, sccBackEdges } = computeStronglyConnectedComponents(nodes, edges);
    expect(components).toHaveLength(2);
    const sorted = components.map((c) => c.join(','));
    expect(sorted).toContain('a,b');
    expect(sorted).toContain('c,d');
    expect(sccBackEdges.size).toBe(4);
  });

  it('keeps a cycle and a singleton separate when the singleton has just one outgoing edge to the cycle', () => {
    // x → a ↔ b. x is a singleton (no path back from the cycle to x).
    const nodes = [node('x'), node('a'), node('b')];
    const edges = [edge('e1', 'x', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')];
    const { components, sccBackEdges } = computeStronglyConnectedComponents(nodes, edges);
    // One singleton (x) + one 2-member SCC (a, b)
    expect(components).toHaveLength(2);
    const sorted = components.map((c) => c.join(','));
    expect(sorted).toContain('x');
    expect(sorted).toContain('a,b');
    // e1 is from x (singleton) into a (member of non-trivial SCC) — NOT intra-SCC.
    expect(sccBackEdges.has('e1')).toBe(false);
    // e2 and e3 are intra-SCC.
    expect(sccBackEdges.has('e2')).toBe(true);
    expect(sccBackEdges.has('e3')).toBe(true);
  });

  it('produces deterministic output across repeated runs', () => {
    const nodes = [node('c'), node('a'), node('b'), node('d'), node('e')];
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'b', 'a'),
      edge('e3', 'c', 'd'),
      edge('e4', 'd', 'c'),
      edge('e5', 'a', 'c'),
    ];
    const r1 = computeStronglyConnectedComponents(nodes, edges);
    const r2 = computeStronglyConnectedComponents(nodes, edges);
    expect(r1.components).toEqual(r2.components);
    expect([...r1.sccBackEdges].sort()).toEqual([...r2.sccBackEdges].sort());
  });

  it('treats self-loops as trivial SCCs (size 1)', () => {
    // A single node with a self-loop — in classic SCC semantics this is still
    // a component of size 1 (reachability from itself requires no edge). Our
    // implementation marks intra-SCC only for size > 1 components, so a
    // self-loop will not be flagged as a back-edge.
    const nodes = [node('a')];
    const edges = [edge('loop', 'a', 'a')];
    const { components, sccBackEdges } = computeStronglyConnectedComponents(nodes, edges);
    expect(components).toHaveLength(1);
    expect(components[0]).toEqual(['a']);
    expect(sccBackEdges.size).toBe(0);
  });
});

describe('condenseBySCC', () => {
  it('returns input unchanged when there are no cycles', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    const result = condenseBySCC(nodes, edges);
    expect(result.supernodes).toHaveLength(0);
    expect(result.condensedNodes).toHaveLength(3);
    expect(result.condensedEdges).toHaveLength(2);
    expect(result.memberToSupernode.size).toBe(0);
  });

  it('creates a supernode for a 2-cycle and drops intra-SCC edges', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a'), edge('e3', 'b', 'c')];
    const result = condenseBySCC(nodes, edges);
    expect(result.supernodes).toHaveLength(1);
    const supernodeId = result.supernodes[0]?.id ?? '';
    expect(supernodeId).toBe('scc:a:2');
    expect(result.supernodes[0]?.members).toEqual(['a', 'b']);

    // Members (a, b) replaced by supernode.
    const condensedIds = result.condensedNodes.map((n) => n.id).sort();
    expect(condensedIds).toEqual(['c', 'scc:a:2']);

    // e1 and e2 are intra-SCC → dropped. e3 is rewritten from b → c to supernode → c.
    expect(result.condensedEdges).toHaveLength(1);
    expect(result.condensedEdges[0]?.id).toBe('e3');
    expect(result.condensedEdges[0]?.source).toBe('scc:a:2');
    expect(result.condensedEdges[0]?.target).toBe('c');
  });

  it('attaches sccMembers metadata to the supernode', () => {
    const nodes = [node('x'), node('y')];
    const edges = [edge('e1', 'x', 'y'), edge('e2', 'y', 'x')];
    const result = condenseBySCC(nodes, edges);
    expect(result.supernodes).toHaveLength(1);
    const supernode = result.condensedNodes.find((n) => n.type === 'scc');
    expect(supernode).toBeDefined();
    expect(supernode?.data?.sccMembers).toEqual(['x', 'y']);
  });

  it('rewrites edges when only the source is a member', () => {
    const nodes = [node('a'), node('b'), node('target')];
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'b', 'a'),
      edge('e3', 'a', 'target'),
    ];
    const result = condenseBySCC(nodes, edges);
    // e3: a → target becomes scc → target.
    const rewritten = result.condensedEdges.find((e) => e.id === 'e3');
    expect(rewritten?.source).toBe('scc:a:2');
    expect(rewritten?.target).toBe('target');
  });

  it('rewrites edges when only the target is a member', () => {
    const nodes = [node('a'), node('b'), node('source')];
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'b', 'a'),
      edge('e3', 'source', 'a'),
    ];
    const result = condenseBySCC(nodes, edges);
    const rewritten = result.condensedEdges.find((e) => e.id === 'e3');
    expect(rewritten?.source).toBe('source');
    expect(rewritten?.target).toBe('scc:a:2');
  });

  it('handles multiple disjoint SCCs independently', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'b', 'a'),
      edge('e3', 'c', 'd'),
      edge('e4', 'd', 'c'),
    ];
    const result = condenseBySCC(nodes, edges);
    expect(result.supernodes).toHaveLength(2);
    const ids = result.supernodes.map((s) => s.id).sort();
    expect(ids).toEqual(['scc:a:2', 'scc:c:2']);
    expect(result.condensedEdges).toHaveLength(0);
  });

  it('is deterministic across repeated runs', () => {
    const nodes = [node('b'), node('a'), node('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a'), edge('e3', 'b', 'c')];
    const r1 = condenseBySCC(nodes, edges);
    const r2 = condenseBySCC(nodes, edges);
    expect(r1.supernodes).toEqual(r2.supernodes);
    expect(r1.condensedNodes.map((n) => n.id)).toEqual(r2.condensedNodes.map((n) => n.id));
    expect(r1.condensedEdges.map((e) => e.id)).toEqual(r2.condensedEdges.map((e) => e.id));
  });
});
