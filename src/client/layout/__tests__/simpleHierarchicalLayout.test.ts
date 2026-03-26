import { describe, expect, it } from 'vitest';

import { computeSimpleHierarchicalLayout } from '../simpleHierarchicalLayout';

import type { DependencyData } from '../../../shared/types/graph/DependencyData';
import type { DependencyNode } from '../../types/DependencyNode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Partial<DependencyData> & { label: string },
  parentNode?: string
): DependencyNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: data as DependencyData,
    ...(parentNode ? { parentNode } : {}),
  } as DependencyNode;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeSimpleHierarchicalLayout', () => {
  describe('layer-based columnar arrangement', () => {
    it('places root nodes in columns by layerIndex — layer 0 leftmost', () => {
      const nodes = [
        makeNode('g-a', 'group', { label: 'A', layerIndex: 0, sortOrder: 0 }),
        makeNode('g-b', 'group', { label: 'B', layerIndex: 1, sortOrder: 0 }),
        makeNode('g-c', 'group', { label: 'C', layerIndex: 2, sortOrder: 0 }),
      ];

      const { positions } = computeSimpleHierarchicalLayout(nodes, []);

      const xA = positions.get('g-a')?.x ?? 0;
      const xB = positions.get('g-b')?.x ?? 0;
      const xC = positions.get('g-c')?.x ?? 0;
      // Columns should go left-to-right by layer index
      expect(xA).toBeLessThan(xB);
      expect(xB).toBeLessThan(xC);
    });

    it('stacks multiple nodes in the same layer column vertically', () => {
      const nodes = [
        makeNode('g-a', 'group', { label: 'A', layerIndex: 0, sortOrder: 0 }),
        makeNode('g-b', 'group', { label: 'B', layerIndex: 0, sortOrder: 1 }),
        makeNode('g-c', 'group', { label: 'C', layerIndex: 0, sortOrder: 2 }),
      ];

      const { positions } = computeSimpleHierarchicalLayout(nodes, []);

      // All in the same column (same X)
      expect(positions.get('g-a')?.x).toBe(positions.get('g-b')?.x);
      expect(positions.get('g-b')?.x).toBe(positions.get('g-c')?.x);

      // Stacked vertically by sortOrder
      const yA = positions.get('g-a')?.y ?? 0;
      const yB = positions.get('g-b')?.y ?? 0;
      const yC = positions.get('g-c')?.y ?? 0;
      expect(yA).toBeLessThan(yB);
      expect(yB).toBeLessThan(yC);
    });

    it('orders nodes within a column by sortOrder (barycenter)', () => {
      // sortOrder 5 should be below sortOrder 2
      const nodes = [
        makeNode('g-high', 'group', { label: 'High', layerIndex: 1, sortOrder: 5 }),
        makeNode('g-low', 'group', { label: 'Low', layerIndex: 1, sortOrder: 2 }),
      ];

      const { positions } = computeSimpleHierarchicalLayout(nodes, []);

      const yHigh = positions.get('g-high')?.y ?? 0;
      const yLow = positions.get('g-low')?.y ?? 0;
      // Lower sortOrder should be higher up (smaller Y)
      expect(yLow).toBeLessThan(yHigh);
    });
  });

  describe('child layout within parents', () => {
    it('positions children relative to parent', () => {
      const nodes = [
        makeNode('folder', 'group', { label: 'Folder', layerIndex: 0, sortOrder: 0 }),
        makeNode('mod-a', 'module', { label: 'a.ts', layoutWeight: 0, sortOrder: 0 }, 'folder'),
        makeNode('mod-b', 'module', { label: 'b.ts', layoutWeight: -1, sortOrder: 1 }, 'folder'),
      ];

      const { positions, sizes } = computeSimpleHierarchicalLayout(nodes, []);

      // Parent should have a computed size
      const folderSize = sizes.get('folder');
      expect(folderSize).toBeDefined();
      expect(folderSize?.width).toBeGreaterThan(0);
      expect(folderSize?.height).toBeGreaterThan(0);

      // Children should have positions
      expect(positions.get('mod-a')).toBeDefined();
      expect(positions.get('mod-b')).toBeDefined();
    });

    it('arranges children in layer-based sub-columns within a folder', () => {
      const nodes = [
        makeNode('folder', 'group', { label: 'Folder', layerIndex: 0, sortOrder: 0 }),
        // Layer 0 foundation, layer 2 consumer — should be in different sub-columns
        makeNode('foundation', 'module', { label: 'foundation.ts', layerIndex: 0, sortOrder: 0 }, 'folder'),
        makeNode('mid', 'module', { label: 'mid.ts', layerIndex: 1, sortOrder: 0 }, 'folder'),
        makeNode('consumer', 'module', { label: 'consumer.ts', layerIndex: 2, sortOrder: 0 }, 'folder'),
      ];

      const { positions } = computeSimpleHierarchicalLayout(nodes, []);

      const xFoundation = positions.get('foundation')?.x ?? 0;
      const xMid = positions.get('mid')?.x ?? 0;
      const xConsumer = positions.get('consumer')?.x ?? 0;
      // Children should be in sub-columns by layer: foundation leftmost, consumer rightmost
      expect(xFoundation).toBeLessThan(xMid);
      expect(xMid).toBeLessThan(xConsumer);
    });

    it('stacks same-layer children vertically by sortOrder within a folder', () => {
      const nodes = [
        makeNode('folder', 'group', { label: 'Folder', layerIndex: 0, sortOrder: 0 }),
        makeNode('child-a', 'module', { label: 'a.ts', layerIndex: 0, sortOrder: 0 }, 'folder'),
        makeNode('child-b', 'module', { label: 'b.ts', layerIndex: 0, sortOrder: 1 }, 'folder'),
      ];

      const { positions } = computeSimpleHierarchicalLayout(nodes, []);

      // Same layer → same X, stacked vertically
      expect(positions.get('child-a')?.x).toBe(positions.get('child-b')?.x);
      expect((positions.get('child-a')?.y ?? 0)).toBeLessThan(positions.get('child-b')?.y ?? 0);
    });
  });

  describe('empty and edge cases', () => {
    it('handles empty node list', () => {
      const { positions, sizes } = computeSimpleHierarchicalLayout([], []);
      expect(positions.size).toBe(0);
      expect(sizes.size).toBe(0);
    });

    it('handles single root node', () => {
      const nodes = [makeNode('only', 'group', { label: 'Only', layerIndex: 0, sortOrder: 0 })];
      const { positions } = computeSimpleHierarchicalLayout(nodes, []);
      expect(positions.get('only')).toEqual({ x: 0, y: 0 });
    });
  });
});
