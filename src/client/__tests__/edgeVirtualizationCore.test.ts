import { describe, expect, it } from 'vitest';

import {
  buildEdgePriorityOrder,
  computeEdgeVirtualizationResult,
} from '../composables/edgeVirtualizationCore';

import type { EdgeVirtualizationEdge, EdgeVirtualizationNode } from '../composables/edgeVirtualizationCore';

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

  it('uses side-specific relational handles when computing edge anchors', () => {
    const nodes: EdgeVirtualizationNode[] = [
      {
        id: 'a',
        position: { x: -700, y: 0 },
        style: { width: 600, height: 100 },
      },
      {
        id: 'b',
        position: { x: -650, y: 0 },
        style: { width: 600, height: 100 },
      },
    ];
    const edges: EdgeVirtualizationEdge[] = [
      {
        id: 'edge-handle-anchors',
        source: 'a',
        target: 'b',
        sourceHandle: 'relational-out-right',
        targetHandle: 'relational-in-right',
        data: { type: 'import' },
      },
    ];

    const result = computeEdgeVirtualizationResult({
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerSize: { width: 900, height: 700 },
      edgePriorityOrder: buildEdgePriorityOrder(edges),
    });

    expect(result).toBeTruthy();
    expect(result?.hiddenEdgeIds.has('edge-handle-anchors')).toBe(false);
  });

  it('supports inner folder handle anchors for padded internal routing', () => {
    const nodes: EdgeVirtualizationNode[] = [
      {
        id: 'folder',
        position: { x: -700, y: 0 },
        style: { width: 600, height: 300 },
      },
      {
        id: 'child',
        position: { x: 40, y: 80 },
        parentNode: 'folder',
        style: { width: 200, height: 100 },
      },
    ];
    const edges: EdgeVirtualizationEdge[] = [
      {
        id: 'edge-folder-inner',
        source: 'folder',
        target: 'child',
        sourceHandle: 'folder-right-in-inner',
        targetHandle: 'relational-in-right',
        data: { type: 'import' },
      },
    ];

    const result = computeEdgeVirtualizationResult({
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerSize: { width: 900, height: 700 },
      edgePriorityOrder: buildEdgePriorityOrder(edges),
    });

    expect(result).toBeTruthy();
    expect(result?.hiddenEdgeIds.has('edge-folder-inner')).toBe(false);
  });

  it('keeps edges visible when perpendicular approach segments enter viewport', () => {
    const nodes: EdgeVirtualizationNode[] = [
      {
        id: 'group-src',
        type: 'group',
        position: { x: 1210, y: 0 },
        style: { width: 200, height: 200 },
      },
      {
        id: 'target',
        type: 'module',
        position: { x: 1500, y: 0 },
        style: { width: 200, height: 200 },
      },
    ];
    const edges: EdgeVirtualizationEdge[] = [
      {
        id: 'edge-perp-visible',
        source: 'group-src',
        target: 'target',
        sourceHandle: 'folder-left-out',
        targetHandle: 'relational-in-left',
        data: { type: 'import' },
      },
    ];

    const result = computeEdgeVirtualizationResult({
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerSize: { width: 900, height: 700 },
      edgePriorityOrder: buildEdgePriorityOrder(edges),
    });

    expect(result).toBeTruthy();
    expect(result?.hiddenEdgeIds.has('edge-perp-visible')).toBe(false);
  });
});
