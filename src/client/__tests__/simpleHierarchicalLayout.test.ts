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

    expect(layout.positions.get('alpha')).toEqual({ x: 14, y: 44 });
    expect(layout.positions.get('beta')).toEqual({ x: 126, y: 44 });
    expect(layout.sizes.get('folder')).toEqual({ width: 384, height: 180 });
  });

  it('falls back to default estimates when child dimensions are missing', () => {
    const parent = makeNode({ id: 'folder', type: 'group' });
    const child = makeNode({
      id: 'child',
      parentNode: 'folder',
    });

    const layout = computeSimpleHierarchicalLayout([parent, child], EMPTY_EDGES);

    expect(layout.positions.get('child')).toEqual({ x: 14, y: 44 });
    expect(layout.sizes.get('folder')).toEqual({ width: 352, height: 320 });
  });

  it('uses explicit root node dimensions for horizontal spacing', () => {
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

    expect(layout.positions.get('pkg-a')).toEqual({ x: 0, y: 0 });
    expect(layout.positions.get('pkg-b')).toEqual({ x: 160, y: 0 });
  });
});
