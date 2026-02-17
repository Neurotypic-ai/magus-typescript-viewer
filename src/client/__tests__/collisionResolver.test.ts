import { describe, it, expect } from 'vitest';

import {
  resolveCollisions,
  buildPositionMap,
  DEFAULT_COLLISION_CONFIG,
} from '../layout/collisionResolver';
import { GROUP_EXCLUSION_ZONE_PX } from '../layout/edgeGeometryPolicy';

import type { CollisionConfig } from '../layout/collisionResolver';
import type { BoundsNode } from '../layout/geometryBounds';

const DEFAULTS = { defaultNodeWidth: 100, defaultNodeHeight: 60 };

/**
 * Helper to create a simple node with explicit size
 */
function makeNode(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentNode?: string
): BoundsNode {
  return {
    id,
    position: { x, y },
    measured: { width, height },
    parentNode,
  } as BoundsNode;
}

// Helper that also sets node type for container padding selection
function makeTypedNode(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentNode: string | undefined,
  type: string
): BoundsNode & { type: string } {
  return {
    id,
    position: { x, y },
    measured: { width, height },
    parentNode,
    type,
  } as BoundsNode & { type: string };
}

describe('resolveCollisions', () => {
  const gap = DEFAULT_COLLISION_CONFIG.overlapGap; // 40

  describe('drag overlap — repulsion pushes OTHER nodes away', () => {
    it('pushes node B away when node A (anchored) is dragged into it', () => {
      // A is at origin, B is nearby and overlapping
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 200, 100),
        makeNode('b', 150, 50, 200, 100), // overlaps A
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      // A is being dragged (anchored) — B should be pushed away, not A
      const anchored = new Set(['a']);
      const result = resolveCollisions(nodes, posMap, anchored);

      expect(result.converged).toBe(true);

      // A should NOT have moved (it's anchored / dragged by user)
      expect(result.updatedPositions.has('a')).toBe(false);
      const aBox = posMap.get('a')!;
      expect(aBox.x).toBe(0);
      expect(aBox.y).toBe(0);

      // B SHOULD have moved away from A
      expect(result.updatedPositions.has('b')).toBe(true);
      const bBox = posMap.get('b')!;
      // B should be pushed so it doesn't overlap A + gap
      const hClear = bBox.x >= aBox.x + aBox.width + gap;
      const vClear = bBox.y >= aBox.y + aBox.height + gap;
      expect(hClear || vClear).toBe(true);
    });

    it('pushes node B to the LEFT when A is dragged from the right', () => {
      // B is at origin, A is to the right overlapping B
      // A's center is RIGHT of B's center, so B should be pushed LEFT
      const nodes: BoundsNode[] = [
        makeNode('b', 0, 0, 200, 100),
        makeNode('a', 150, 0, 200, 100), // A overlaps B from the right
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const originalBX = posMap.get('b')!.x;

      // A is anchored
      const anchored = new Set(['a']);
      resolveCollisions(nodes, posMap, anchored);

      const bBox = posMap.get('b')!;
      // B should have been pushed left (negative X direction) or up/down
      // Since B's center (100,50) is left of A's center (250,50),
      // B should be pushed left
      expect(bBox.x).toBeLessThanOrEqual(originalBX);
    });

    it('pushes node B UPWARD when A is dragged from below', () => {
      // B is on top, A comes from below and overlaps
      const nodes: BoundsNode[] = [
        makeNode('b', 0, 0, 200, 100),
        makeNode('a', 0, 60, 200, 100), // A overlaps B from below
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const originalBY = posMap.get('b')!.y;

      const anchored = new Set(['a']);
      resolveCollisions(nodes, posMap, anchored);

      const bBox = posMap.get('b')!;
      // B's center (100,50) is above A's center (100,110)
      // So B should be pushed up (negative Y)
      expect(bBox.y).toBeLessThanOrEqual(originalBY);
    });

    it('does not move non-overlapping siblings', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 100, 60),
        makeNode('b', 500, 500, 100, 60), // far away
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, new Set(['a']));

      expect(result.updatedPositions.size).toBe(0);
      expect(result.converged).toBe(true);
    });
  });

  describe('expand/dimension collision push', () => {
    it('pushes sibling when one node expands (anchored)', () => {
      // Node A has grown large and now overlaps B
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 300, 200), // large (just expanded)
        makeNode('b', 250, 100, 150, 80), // overlaps A
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const anchored = new Set(['a']); // A triggered the change
      const result = resolveCollisions(nodes, posMap, anchored);

      // A should stay put, B should move
      expect(result.updatedPositions.has('a')).toBe(false);
      expect(result.updatedPositions.has('b')).toBe(true);

      const bBox = posMap.get('b')!;
      const aBox = posMap.get('a')!;
      expect(bBox.y >= aBox.y + aBox.height + gap || bBox.x >= aBox.x + aBox.width + gap).toBe(true);
    });
  });

  describe('group-vs-group push with ancestor propagation', () => {
    it('pushes sibling group nodes apart at root scope', () => {
      const nodes: BoundsNode[] = [
        makeTypedNode('g1', 0, 0, 400, 300, undefined, 'group'),
        makeTypedNode('g2', 350, 100, 400, 300, undefined, 'group'), // overlaps g1
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      // g1 is anchored (e.g. it was just expanded)
      const result = resolveCollisions(nodes, posMap, new Set(['g1']));

      expect(result.converged).toBe(true);
      expect(result.updatedPositions.has('g1')).toBe(false);
      expect(result.updatedPositions.has('g2')).toBe(true);

      const g2 = posMap.get('g2')!;
      const g1 = posMap.get('g1')!;
      expect(g2.y >= g1.y + g1.height + gap || g2.x >= g1.x + g1.width + gap).toBe(true);
    });
  });

  describe('container growth and margin', () => {
    it('expands parent container to fit children with margin', () => {
      const parent = makeTypedNode('parent', 0, 0, 200, 150, undefined, 'module');
      const child = makeNode('child', 20, 42, 250, 80, 'parent'); // wider than parent

      const nodes: BoundsNode[] = [parent, child];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      resolveCollisions(nodes, posMap, null);

      const parentBox = posMap.get('parent')!;
      const childBox = posMap.get('child')!;
      expect(parentBox.width).toBeGreaterThanOrEqual(childBox.x + childBox.width);
      expect(parentBox.height).toBeGreaterThanOrEqual(childBox.y + childBox.height);
    });
  });

  describe('group exclusion zone and anchored drag priority', () => {
    it('does not clamp an anchored child inside group exclusion padding', () => {
      const parent = makeTypedNode('group-parent', 0, 0, 320, 220, undefined, 'group');
      const anchoredChild = makeNode('anchored-child', 8, 8, 120, 80, 'group-parent');
      const nodes: BoundsNode[] = [parent, anchoredChild];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      const result = resolveCollisions(
        nodes,
        posMap,
        new Set(['anchored-child']),
        DEFAULT_COLLISION_CONFIG,
        new Set(['anchored-child'])
      );
      const childBox = posMap.get('anchored-child')!;
      const parentBox = posMap.get('group-parent')!;

      expect(childBox.x).toBe(8);
      expect(childBox.y).toBe(8);
      expect(parentBox.x).toBe(0);
      expect(parentBox.y).toBe(0);
      expect(result.updatedPositions.has('anchored-child')).toBe(false);
    });

    it('expands group toward top/left when settled anchored child pushes into inset bounds', () => {
      const parent = makeTypedNode('group-parent', 0, 0, 320, 220, undefined, 'group');
      const anchoredChild = makeNode('anchored-child', 8, 8, 120, 80, 'group-parent');
      const nodes: BoundsNode[] = [parent, anchoredChild];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      const originalAbsoluteX = 8;
      const originalAbsoluteY = 8;

      resolveCollisions(nodes, posMap, new Set(['anchored-child']));

      const childBox = posMap.get('anchored-child')!;
      const parentBox = posMap.get('group-parent')!;
      expect(parentBox.x).toBeLessThan(0);
      expect(parentBox.y).toBeLessThan(0);
      expect(parentBox.x + childBox.x).toBeCloseTo(originalAbsoluteX, 3);
      expect(parentBox.y + childBox.y).toBeCloseTo(originalAbsoluteY, 3);
      expect(parentBox.width).toBeGreaterThanOrEqual(childBox.x + childBox.width + GROUP_EXCLUSION_ZONE_PX);
      expect(parentBox.height).toBeGreaterThanOrEqual(childBox.y + childBox.height + GROUP_EXCLUSION_ZONE_PX);
    });

    it('clamps non-anchored children to all group exclusion boundaries', () => {
      const parent = makeTypedNode('group-parent', 0, 0, 300, 220, undefined, 'group');
      const child = makeNode('child', 260, 200, 80, 60, 'group-parent');
      const nodes: BoundsNode[] = [parent, child];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      resolveCollisions(nodes, posMap, null);
      const childBox = posMap.get('child')!;
      const maxX = 300 - GROUP_EXCLUSION_ZONE_PX - 80;
      const maxY = 220 - GROUP_EXCLUSION_ZONE_PX - 60;

      expect(childBox.x).toBeLessThanOrEqual(maxX);
      expect(childBox.y).toBeLessThanOrEqual(maxY);
      expect(childBox.x).toBeGreaterThanOrEqual(GROUP_EXCLUSION_ZONE_PX);
      expect(childBox.y).toBeGreaterThanOrEqual(GROUP_EXCLUSION_ZONE_PX);
    });

    it('collapses an oversized group so children rest at inset limits', () => {
      const parent = makeTypedNode('group-parent', 0, 0, 640, 420, undefined, 'group');
      const child = makeNode('child', 180, 160, 120, 90, 'group-parent');
      const nodes: BoundsNode[] = [parent, child];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      const originalAbsoluteX = 180;
      const originalAbsoluteY = 160;
      resolveCollisions(nodes, posMap, null);

      const childBox = posMap.get('child')!;
      const parentBox = posMap.get('group-parent')!;
      expect(parentBox.width).toBe(childBox.x + childBox.width + GROUP_EXCLUSION_ZONE_PX);
      expect(parentBox.height).toBe(childBox.y + childBox.height + GROUP_EXCLUSION_ZONE_PX);
      expect(childBox.x).toBe(GROUP_EXCLUSION_ZONE_PX);
      expect(childBox.y).toBe(GROUP_EXCLUSION_ZONE_PX);
      expect(parentBox.x + childBox.x).toBeCloseTo(originalAbsoluteX, 3);
      expect(parentBox.y + childBox.y).toBeCloseTo(originalAbsoluteY, 3);
    });

    it('expands group size instead of moving anchored child near right/bottom edge', () => {
      const parent = makeTypedNode('group-parent', 0, 0, 220, 160, undefined, 'group');
      const anchoredChild = makeNode('anchored-child', 200, 140, 100, 80, 'group-parent');
      const nodes: BoundsNode[] = [parent, anchoredChild];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      resolveCollisions(nodes, posMap, new Set(['anchored-child']));

      const childBox = posMap.get('anchored-child')!;
      const parentBox = posMap.get('group-parent')!;
      expect(childBox.x).toBe(200);
      expect(childBox.y).toBe(140);
      expect(parentBox.width).toBeGreaterThanOrEqual(childBox.x + childBox.width + GROUP_EXCLUSION_ZONE_PX);
      expect(parentBox.height).toBeGreaterThanOrEqual(childBox.y + childBox.height + GROUP_EXCLUSION_ZONE_PX);
    });
  });

  describe('deterministic output under fixed input ordering', () => {
    it('produces identical results for same input', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 200, 100),
        makeNode('b', 100, 50, 200, 100),
        makeNode('c', 50, 25, 200, 100),
      ];

      const posMap1 = buildPositionMap(nodes, DEFAULTS);
      const result1 = resolveCollisions(nodes, posMap1, new Set(['a']));

      const posMap2 = buildPositionMap(nodes, DEFAULTS);
      const result2 = resolveCollisions(nodes, posMap2, new Set(['a']));

      expect(Array.from(result1.updatedPositions.entries())).toEqual(
        Array.from(result2.updatedPositions.entries())
      );
      expect(result1.cyclesUsed).toBe(result2.cyclesUsed);
    });
  });

  describe('bounded settle cycles', () => {
    it('terminates within maxCycles even for pathological input', () => {
      const nodes: BoundsNode[] = [];
      for (let i = 0; i < 20; i++) {
        nodes.push(makeNode(`n${i}`, i * 10, i * 5, 200, 100));
      }

      const config: CollisionConfig = {
        ...DEFAULT_COLLISION_CONFIG,
        maxCycles: 5,
      };

      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, new Set(['n0']), config);

      expect(result.cyclesUsed).toBeLessThanOrEqual(5);
    });
  });

  describe('maxDisplacementPerCycle', () => {
    it('limits per-cycle movement when configured', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 200, 100),
        makeNode('b', 50, 20, 200, 100), // heavily overlapping
      ];

      const config: CollisionConfig = {
        ...DEFAULT_COLLISION_CONFIG,
        maxDisplacementPerCycle: 50,
        maxCycles: 1,
      };

      const posMap = buildPositionMap(nodes, DEFAULTS);
      const originalBX = posMap.get('b')!.x;
      const originalBY = posMap.get('b')!.y;
      resolveCollisions(nodes, posMap, new Set(['a']), config);

      const bBox = posMap.get('b')!;
      // Displacement should be capped at 50 on whichever axis was pushed
      const dx = Math.abs(bBox.x - originalBX);
      const dy = Math.abs(bBox.y - originalBY);
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(50);
    });
  });

  describe('scoped resolution via anchoredNodeIds', () => {
    it('only resolves sibling scopes affected by anchored nodes', () => {
      // Two independent sibling groups under different parents
      const nodes: BoundsNode[] = [
        makeTypedNode('p1', 0, 0, 500, 400, undefined, 'module'),
        makeNode('a1', 20, 42, 200, 100, 'p1'),
        makeNode('a2', 100, 60, 200, 100, 'p1'), // overlaps a1

        makeTypedNode('p2', 600, 0, 500, 400, undefined, 'module'),
        makeNode('b1', 20, 42, 200, 100, 'p2'),
        makeNode('b2', 100, 60, 200, 100, 'p2'), // overlaps b1
      ];

      const posMap = buildPositionMap(nodes, DEFAULTS);
      const originalB2 = { ...posMap.get('b2')! };

      // Only resolve scope of a1 (parent p1) — b2 under p2 should NOT be touched
      const anchored = new Set(['a1']);
      resolveCollisions(nodes, posMap, anchored);

      expect(posMap.get('b2')!.x).toBe(originalB2.x);
      expect(posMap.get('b2')!.y).toBe(originalB2.y);
    });
  });

  describe('full resolve (no anchored nodes)', () => {
    it('resolves all overlaps when anchoredNodeIds is null', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 200, 100),
        makeNode('b', 150, 50, 200, 100),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, null);

      expect(result.converged).toBe(true);

      // Both nodes may move since neither is anchored
      const aBox = posMap.get('a')!;
      const bBox = posMap.get('b')!;
      const hClear = bBox.x >= aBox.x + aBox.width + gap || aBox.x >= bBox.x + bBox.width + gap;
      const vClear = bBox.y >= aBox.y + aBox.height + gap || aBox.y >= bBox.y + bBox.height + gap;
      expect(hClear || vClear).toBe(true);
    });
  });

  describe('cascade: pushed nodes push their own neighbors', () => {
    it('chain-pushes a line of overlapping nodes', () => {
      // Three nodes in a row, all overlapping. A is anchored.
      // A pushes B, then B (as displaced) pushes C.
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 200, 100),
        makeNode('b', 150, 0, 200, 100), // overlaps A
        makeNode('c', 300, 0, 200, 100), // overlaps B
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, new Set(['a']));

      expect(result.converged).toBe(true);

      const aBox = posMap.get('a')!;
      const bBox = posMap.get('b')!;
      const cBox = posMap.get('c')!;

      // A didn't move
      expect(aBox.x).toBe(0);
      expect(aBox.y).toBe(0);

      // B is clear of A
      expect(bBox.x >= aBox.x + aBox.width + gap || bBox.y >= aBox.y + aBox.height + gap).toBe(true);

      // C is clear of B
      expect(cBox.x >= bBox.x + bBox.width + gap || cBox.y >= bBox.y + bBox.height + gap).toBe(true);
    });
  });
});

describe('buildPositionMap', () => {
  it('creates mutable boxes from node positions', () => {
    const nodes: BoundsNode[] = [
      { id: 'n1', position: { x: 10, y: 20 }, measured: { width: 200, height: 100 } },
      { id: 'n2', position: { x: 30, y: 40 }, style: { width: '300px', height: '150px' } },
    ];

    const map = buildPositionMap(nodes, DEFAULTS);
    expect(map.get('n1')).toEqual({ x: 10, y: 20, width: 200, height: 100 });
    expect(map.get('n2')).toEqual({ x: 30, y: 40, width: 300, height: 150 });
  });

  it('skips nodes without position', () => {
    const nodes: BoundsNode[] = [{ id: 'n1', measured: { width: 200, height: 100 } }];
    const map = buildPositionMap(nodes, DEFAULTS);
    expect(map.size).toBe(0);
  });
});
