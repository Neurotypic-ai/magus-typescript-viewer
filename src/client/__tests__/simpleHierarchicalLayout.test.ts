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

    expect(layout.positions.get('alpha')).toEqual({ x: 10, y: 44 });
    expect(layout.positions.get('beta')).toEqual({ x: 230, y: 44 });
    expect(layout.sizes.get('folder')).toEqual({ width: 660, height: 340 });
  });

  it('falls back to default estimates when child dimensions are missing', () => {
    const parent = makeNode({ id: 'folder', type: 'group' });
    const child = makeNode({
      id: 'child',
      parentNode: 'folder',
    });

    const layout = computeSimpleHierarchicalLayout([parent, child], EMPTY_EDGES);

    expect(layout.positions.get('child')).toEqual({ x: 10, y: 44 });
    expect(layout.sizes.get('folder')).toEqual({ width: 520, height: 480 });
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

    expect(layout.positions.get('pkg-a')).toEqual({ x: 0, y: 0 });
    expect(layout.positions.get('pkg-b')).toEqual({ x: 240, y: 0 });
  });

  it('places import-heavy root nodes left of consumer-heavy root nodes', () => {
    const producer = makeNode({ id: 'producer', type: 'group', data: { label: 'producer', layoutWeight: 5 } });
    const balanced = makeNode({ id: 'balanced', type: 'group', data: { label: 'balanced', layoutWeight: 0 } });
    const consumer = makeNode({ id: 'consumer', type: 'group', data: { label: 'consumer', layoutWeight: -5 } });

    const layout = computeSimpleHierarchicalLayout([producer, balanced, consumer], EMPTY_EDGES);

    const xProducer = layout.positions.get('producer')?.x ?? Infinity;
    const xBalanced = layout.positions.get('balanced')?.x ?? Infinity;
    const xConsumer = layout.positions.get('consumer')?.x ?? Infinity;

    expect(xProducer).toBeLessThan(xBalanced);
    expect(xBalanced).toBeLessThan(xConsumer);
  });

  it('places import-heavy child modules left within their folder', () => {
    const parent = makeNode({ id: 'folder', type: 'group' });
    const producer = makeNode({ id: 'child-producer', parentNode: 'folder', data: { label: 'producer', layoutWeight: 3 } });
    const consumer = makeNode({ id: 'child-consumer', parentNode: 'folder', data: { label: 'consumer', layoutWeight: -3 } });

    const layout = computeSimpleHierarchicalLayout([parent, producer, consumer], EMPTY_EDGES);

    const xProducer = layout.positions.get('child-producer')?.x ?? Infinity;
    const xConsumer = layout.positions.get('child-consumer')?.x ?? Infinity;

    expect(xProducer).toBeLessThan(xConsumer);
  });
});
