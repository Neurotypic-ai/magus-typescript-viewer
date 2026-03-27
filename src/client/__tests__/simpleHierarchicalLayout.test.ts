import { describe, expect, it } from 'vitest';

import { computeSimpleHierarchicalLayout } from '../layout/simpleHierarchicalLayout';

import type { GraphEdge } from '../types/GraphEdge';
import type { DependencyNode } from '../types/DependencyNode';

const EMPTY_EDGES: GraphEdge[] = [];

const makeNode = (overrides: Partial<DependencyNode> & { id: string }): DependencyNode => {
  const { id, ...rest } = overrides;
  return {
    id,
    type: rest.type ?? 'module',
    position: { x: 0, y: 0 },
    data: { label: id },
    ...rest,
  } as DependencyNode;
};

describe('computeSimpleHierarchicalLayout', () => {
  it('accounts for folder chrome insets when computing parent size and child positions', () => {
    const parent = makeNode({ id: 'folder', type: 'group' });
    // Both have no layerIndex → same column, stacked vertically (ascending child sort by id)
    const childAlpha = makeNode({
      id: 'alpha',
      parentNode: 'folder',
      style: { width: '100px', height: '80px' },
    });
    const childBeta = makeNode({
      id: 'beta',
      parentNode: 'folder',
      style: { width: '240px', height: '120px' },
    });

    const layout = computeSimpleHierarchicalLayout([parent, childAlpha, childBeta], EMPTY_EDGES);

    // Same column (both layerIndex=0), stacked: alpha first (id 'alpha' < 'beta')
    expect(layout.positions.get('alpha')).toEqual({ x: 100, y: 100 });
    expect(layout.positions.get('beta')).toEqual({ x: 100, y: 380 });
    expect(layout.sizes.get('folder')).toEqual({ width: 440, height: 600 });
  });

  it('falls back to default estimates when child dimensions are missing', () => {
    const parent = makeNode({ id: 'folder', type: 'group' });
    const child = makeNode({
      id: 'child',
      parentNode: 'folder',
    });

    const layout = computeSimpleHierarchicalLayout([parent, child], EMPTY_EDGES);

    expect(layout.positions.get('child')).toEqual({ x: 100, y: 100 });
    expect(layout.sizes.get('folder')).toEqual({ width: 520, height: 460 });
  });

  it('uses the current root node spacing behavior', () => {
    const packageNode = makeNode({
      id: 'pkg-a',
      type: 'package',
      style: { width: '120px', height: '90px' },
    });
    const secondPackageNode = makeNode({
      id: 'pkg-b',
      type: 'package',
      style: { width: '200px', height: '110px' },
    });

    const layout = computeSimpleHierarchicalLayout([packageNode, secondPackageNode], EMPTY_EDGES);

    // Both have no layerIndex → same column. Root sort descending tiebreaks by id ascending.
    // 'pkg-a' < 'pkg-b' → pkg-a at y=0, pkg-b below at y=90+120=210
    expect(layout.positions.get('pkg-a')).toEqual({ x: 0, y: 0 });
    expect(layout.positions.get('pkg-b')).toEqual({ x: 0, y: 210 });
  });

  it('places consumer root nodes (high layerIndex) left of foundation root nodes (low layerIndex)', () => {
    const foundation = makeNode({ id: 'foundation', type: 'group', data: { label: 'foundation', layerIndex: 0 } });
    const balanced = makeNode({ id: 'balanced', type: 'group', data: { label: 'balanced', layerIndex: 1 } });
    const consumer = makeNode({ id: 'consumer', type: 'group', data: { label: 'consumer', layerIndex: 2 } });

    const layout = computeSimpleHierarchicalLayout([foundation, balanced, consumer], EMPTY_EDGES);

    const xFoundation = layout.positions.get('foundation')?.x ?? Infinity;
    const xBalanced = layout.positions.get('balanced')?.x ?? Infinity;
    const xConsumer = layout.positions.get('consumer')?.x ?? Infinity;

    // Reversed column sort: consumer (layerIndex=2) is leftmost, foundation (layerIndex=0) is rightmost
    expect(xConsumer).toBeLessThan(xBalanced);
    expect(xBalanced).toBeLessThan(xFoundation);
  });

  it('places consumer child modules (high layerIndex) left within their folder', () => {
    const parent = makeNode({ id: 'folder', type: 'group' });
    const foundation = makeNode({ id: 'child-foundation', parentNode: 'folder', data: { label: 'foundation', layerIndex: 0 } });
    const consumer = makeNode({ id: 'child-consumer', parentNode: 'folder', data: { label: 'consumer', layerIndex: 2 } });

    const layout = computeSimpleHierarchicalLayout([parent, foundation, consumer], EMPTY_EDGES);

    const xFoundation = layout.positions.get('child-foundation')?.x ?? Infinity;
    const xConsumer = layout.positions.get('child-consumer')?.x ?? Infinity;

    // Reversed child column sort: consumer (layerIndex=2) is leftmost
    expect(xConsumer).toBeLessThan(xFoundation);
  });
});
