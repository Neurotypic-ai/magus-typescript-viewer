import { describe, expect, it } from 'vitest';

import {
  buildEdgePriorityOrder,
  computeEdgeVirtualizationResult,
} from '../edgeVirtualizationCore';

import type { EdgeVirtualizationEdge, EdgeVirtualizationNode } from '../edgeVirtualizationCore';

describe('edgeVirtualizationCore', () => {
  const baseNodes: EdgeVirtualizationNode[] = [
    { id: 'a', position: { x: 0, y: 0 } },
    { id: 'b', position: { x: 160, y: 0 } },
    { id: 'c', position: { x: 2000, y: 0 } },
    { id: 'd', position: { x: 2200, y: 0 } },
  ];

  it('hides edges outside of viewport bounds', () => {
    const edges: EdgeVirtualizationEdge[] = [
      { id: 'edge-ab', source: 'a', target: 'b', data: { type: 'import' } },
      { id: 'edge-cd', source: 'c', target: 'd', data: { type: 'import' } },
    ];

    const result = computeEdgeVirtualizationResult({
      nodes: baseNodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerSize: { width: 900, height: 700 },
      edgePriorityOrder: buildEdgePriorityOrder(edges),
    });

    expect(result).toBeTruthy();
    expect(result?.hiddenEdgeIds.has('edge-ab')).toBe(false);
    expect(result?.hiddenEdgeIds.has('edge-cd')).toBe(true);
  });

  it('does not override user-hidden edges', () => {
    const edges: EdgeVirtualizationEdge[] = [
      { id: 'edge-ab', source: 'a', target: 'b', data: { type: 'import' } },
      { id: 'edge-cd', source: 'c', target: 'd', data: { type: 'import' } },
    ];

    const result = computeEdgeVirtualizationResult({
      nodes: baseNodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerSize: { width: 900, height: 700 },
      userHiddenEdgeIds: ['edge-ab'],
      edgePriorityOrder: buildEdgePriorityOrder(edges),
    });

    expect(result).toBeTruthy();
    expect(result?.hiddenEdgeIds.has('edge-ab')).toBe(false);
    expect(result?.hiddenEdgeIds.has('edge-cd')).toBe(true);
  });

  it('applies low-zoom budget using priority order', () => {
    const nodes: EdgeVirtualizationNode[] = [
      { id: 'a', position: { x: 0, y: 0 } },
      { id: 'b', position: { x: 160, y: 0 } },
      { id: 'c', position: { x: 320, y: 0 } },
      { id: 'd', position: { x: 480, y: 0 } },
    ];
    const edges: EdgeVirtualizationEdge[] = [
      { id: 'edge-high', source: 'a', target: 'b', data: { type: 'contains' } },
      { id: 'edge-mid', source: 'b', target: 'c', data: { type: 'inheritance' } },
      { id: 'edge-low', source: 'c', target: 'd', data: { type: 'import' } },
    ];

    const result = computeEdgeVirtualizationResult({
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 0.2 },
      containerSize: { width: 1600, height: 900 },
      edgePriorityOrder: ['edge-high', 'edge-mid', 'edge-low'],
      config: {
        lowZoomThreshold: 0.3,
        lowZoomBaseMaxEdges: 1,
        lowZoomMinBudget: 1,
        lowZoomMaxBudget: 1,
      },
    });

    expect(result).toBeTruthy();
    expect(result?.finalVisibleEdgeIds.size).toBe(1);
    expect(result?.finalVisibleEdgeIds.has('edge-high')).toBe(true);
    expect(result?.hiddenEdgeIds.has('edge-mid')).toBe(true);
    expect(result?.hiddenEdgeIds.has('edge-low')).toBe(true);
  });
});
