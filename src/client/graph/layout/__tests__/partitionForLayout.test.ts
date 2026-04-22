import { describe, expect, it } from 'vitest';

import { partitionForLayout } from '../partitionForLayout';

import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

function makeNode(id: string, type: DependencyNode['type']): DependencyNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id },
  } as DependencyNode;
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return {
    id,
    source,
    target,
    data: { type: 'import' },
  } as GraphEdge;
}

describe('partitionForLayout', () => {
  it('returns empty buckets for an empty graph', () => {
    const result = partitionForLayout([], []);

    expect(result.internal).toEqual([]);
    expect(result.external).toEqual([]);
    expect(result.internalEdges).toEqual([]);
    expect(result.externalIncidentEdges).toEqual([]);
  });

  it('classifies externalPackage nodes into external and everything else into internal', () => {
    const nodes = [
      makeNode('mod-a', 'module'),
      makeNode('ext-vue', 'externalPackage'),
      makeNode('cls-x', 'class'),
      makeNode('dir:app:src', 'group'),
    ];

    const result = partitionForLayout(nodes, []);

    expect(result.external.map((n) => n.id)).toEqual(['ext-vue']);
    expect(result.internal.map((n) => n.id).sort()).toEqual(['cls-x', 'dir:app:src', 'mod-a']);
  });

  it('excludes scc nodes from the internal bucket (forward-compatible with Phase 5)', () => {
    const nodes = [
      makeNode('mod-a', 'module'),
      makeNode('scc-cluster-1', 'scc' as DependencyNode['type']),
    ];

    const result = partitionForLayout(nodes, []);

    expect(result.internal.map((n) => n.id)).toEqual(['mod-a']);
    expect(result.external).toEqual([]);
  });

  it('routes edges touching an external into externalIncidentEdges', () => {
    const nodes = [
      makeNode('mod-a', 'module'),
      makeNode('mod-b', 'module'),
      makeNode('ext-vue', 'externalPackage'),
    ];
    const edges = [
      makeEdge('e-ab', 'mod-a', 'mod-b'),
      makeEdge('e-a-ext', 'mod-a', 'ext-vue'),
    ];

    const result = partitionForLayout(nodes, edges);

    expect(result.internalEdges.map((e) => e.id)).toEqual(['e-ab']);
    expect(result.externalIncidentEdges.map((e) => e.id)).toEqual(['e-a-ext']);
  });

  it('treats edges incident on either end (source or target) as external incident', () => {
    const nodes = [
      makeNode('mod-a', 'module'),
      makeNode('ext-vue', 'externalPackage'),
    ];
    const edges = [
      makeEdge('e-ext-to-mod', 'ext-vue', 'mod-a'),
      makeEdge('e-mod-to-ext', 'mod-a', 'ext-vue'),
    ];

    const result = partitionForLayout(nodes, edges);

    expect(result.internalEdges).toEqual([]);
    expect(result.externalIncidentEdges.map((e) => e.id).sort()).toEqual(['e-ext-to-mod', 'e-mod-to-ext']);
  });

  it('is O(V + E): handles many nodes without quadratic blowup', () => {
    const nodes: DependencyNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 1000; i++) nodes.push(makeNode(`mod-${String(i)}`, 'module'));
    for (let i = 0; i < 50; i++) nodes.push(makeNode(`ext-${String(i)}`, 'externalPackage'));
    for (let i = 0; i < 1000; i++) {
      edges.push(makeEdge(`e-${String(i)}`, `mod-${String(i)}`, `ext-${String(i % 50)}`));
    }

    const start = performance.now();
    const result = partitionForLayout(nodes, edges);
    const elapsed = performance.now() - start;

    expect(result.internal).toHaveLength(1000);
    expect(result.external).toHaveLength(50);
    expect(result.externalIncidentEdges).toHaveLength(1000);
    expect(elapsed).toBeLessThan(200); // generous — pure loops should be < 50ms
  });
});
