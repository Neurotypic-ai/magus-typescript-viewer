/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';

import {
  createCollisionConfig,
  getActiveCollisionConfig,
  DEFAULT_COLLISION_CONFIG,
  COLLISION_MINIMUM_DISTANCE_OPTION_KEY,
  resolveCollisions,
  buildPositionMap,
} from '../collisionResolver';
import { GROUP_EXCLUSION_ZONE_PX } from '../edgeGeometryPolicy';

import type { CollisionConfig } from '../collisionResolver';
import type { BoundsNode } from '../geometryBounds';

const DEFAULTS = { defaultNodeWidth: 100, defaultNodeHeight: 60 };

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

describe('createCollisionConfig', () => {
  it('sets overlapGap and groupPadding from minimumDistancePx', () => {
    const config = createCollisionConfig(50);
    expect(config.overlapGap).toBe(50);
    expect(config.groupPadding).toEqual({
      horizontal: 50,
      top: 50,
      bottom: 50,
    });
  });

  it('preserves modulePadding and other defaults', () => {
    const config = createCollisionConfig(30);
    expect(config.modulePadding).toEqual(DEFAULT_COLLISION_CONFIG.modulePadding);
    expect(config.maxCycles).toBe(DEFAULT_COLLISION_CONFIG.maxCycles);
    expect(config.maxDisplacementPerCycle).toBe(DEFAULT_COLLISION_CONFIG.maxDisplacementPerCycle);
  });

  it('clamps negative values to 0', () => {
    const config = createCollisionConfig(-10);
    expect(config.overlapGap).toBe(0);
    expect(config.groupPadding.horizontal).toBe(0);
  });

  it('handles 0 correctly', () => {
    const config = createCollisionConfig(0);
    expect(config.overlapGap).toBe(0);
    expect(config.groupPadding).toEqual({ horizontal: 0, top: 0, bottom: 0 });
    expect(config.modulePadding).toEqual(DEFAULT_COLLISION_CONFIG.modulePadding);
  });

  it('produces config that affects resolveCollisions gap', () => {
    const nodes: BoundsNode[] = [
      makeNode('a', 0, 0, 200, 100),
      makeNode('b', 150, 50, 200, 100),
    ];
    const posMap = buildPositionMap(nodes, DEFAULTS);
    const customGap = 60;
    const config = createCollisionConfig(customGap);
    const result = resolveCollisions(nodes, posMap, new Set(['a']), config);

    expect(result.converged).toBe(true);
    const aBox = posMap.get('a');
    const bBox = posMap.get('b');
    if (aBox === undefined || bBox === undefined) {
      expect.fail('a and b should be in posMap');
    }
    expect(bBox.x >= aBox.x + aBox.width + customGap || bBox.y >= aBox.y + aBox.height + customGap).toBe(true);
  });
});

describe('getActiveCollisionConfig', () => {
  it('returns default when strategy has no options', () => {
    const config = getActiveCollisionConfig('folderDistributor', {});
    expect(config).toEqual(DEFAULT_COLLISION_CONFIG);
  });

  it('returns default when strategy has no minimumDistancePx option', () => {
    const config = getActiveCollisionConfig('folderDistributor', {
      folderDistributor: { otherOption: true },
    });
    expect(config).toEqual(DEFAULT_COLLISION_CONFIG);
  });

  it('uses minimumDistancePx from strategy options when present', () => {
    const config = getActiveCollisionConfig('folderDistributor', {
      folderDistributor: { [COLLISION_MINIMUM_DISTANCE_OPTION_KEY]: 55 },
    });
    expect(config.overlapGap).toBe(55);
    expect(config.groupPadding).toEqual({ horizontal: 55, top: 55, bottom: 55 });
    expect(config.modulePadding).toEqual(DEFAULT_COLLISION_CONFIG.modulePadding);
  });

  it('falls back to default when minimumDistancePx is invalid', () => {
    expect(getActiveCollisionConfig('folderDistributor', { folderDistributor: { [COLLISION_MINIMUM_DISTANCE_OPTION_KEY]: 'invalid' } })).toEqual(DEFAULT_COLLISION_CONFIG);
    expect(getActiveCollisionConfig('folderDistributor', { folderDistributor: { [COLLISION_MINIMUM_DISTANCE_OPTION_KEY]: NaN } })).toEqual(DEFAULT_COLLISION_CONFIG);
    expect(getActiveCollisionConfig('folderDistributor', { folderDistributor: { [COLLISION_MINIMUM_DISTANCE_OPTION_KEY]: -5 } })).toEqual(DEFAULT_COLLISION_CONFIG);
  });

  it('returns default when strategyId is missing from optionsById', () => {
    const config = getActiveCollisionConfig('nonexistent', {
      canvas: { [COLLISION_MINIMUM_DISTANCE_OPTION_KEY]: 80 },
    });
    expect(config).toEqual(DEFAULT_COLLISION_CONFIG);
  });

  it('uses correct strategy options for different strategy ids', () => {
    const optionsById = {
      canvas: { [COLLISION_MINIMUM_DISTANCE_OPTION_KEY]: 25 },
      vueflow: { [COLLISION_MINIMUM_DISTANCE_OPTION_KEY]: 70 },
      folderDistributor: { [COLLISION_MINIMUM_DISTANCE_OPTION_KEY]: 40 },
    };

    const canvasConfig = getActiveCollisionConfig('canvas', optionsById);
    expect(canvasConfig.overlapGap).toBe(25);

    const folderConfig = getActiveCollisionConfig('folderDistributor', optionsById);
    expect(folderConfig.overlapGap).toBe(40);
  });
});

describe('resolveCollisions', () => {
  const gap = DEFAULT_COLLISION_CONFIG.overlapGap;

  describe('drag overlap - repulsion pushes other nodes away', () => {
    it('pushes node B away when node A is anchored', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 200, 100),
        makeNode('b', 150, 50, 200, 100),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      const anchored = new Set(['a']);
      const result = resolveCollisions(nodes, posMap, anchored);

      expect(result.converged).toBe(true);
      expect(result.updatedPositions.has('a')).toBe(false);

      const aBox = posMap.get('a')!;
      const bBox = posMap.get('b')!;
      expect(aBox.x).toBe(0);
      expect(aBox.y).toBe(0);
      expect(result.updatedPositions.has('b')).toBe(true);

      const hClear = bBox.x >= aBox.x + aBox.width + gap;
      const vClear = bBox.y >= aBox.y + aBox.height + gap;
      expect(hClear || vClear).toBe(true);
    });

    it('pushes node B left when A is dragged from the right', () => {
      const nodes: BoundsNode[] = [
        makeNode('b', 0, 0, 200, 100),
        makeNode('a', 150, 0, 200, 100),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const originalBX = posMap.get('b')!.x;

      resolveCollisions(nodes, posMap, new Set(['a']));

      const bBox = posMap.get('b')!;
      expect(bBox.x).toBeLessThanOrEqual(originalBX);
    });

    it('pushes node B upward when A is dragged from below', () => {
      const nodes: BoundsNode[] = [
        makeNode('b', 0, 0, 200, 100),
        makeNode('a', 0, 60, 200, 100),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const originalBY = posMap.get('b')!.y;

      resolveCollisions(nodes, posMap, new Set(['a']));

      const bBox = posMap.get('b')!;
      expect(bBox.y).toBeLessThanOrEqual(originalBY);
    });

    it('does not move non-overlapping siblings', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 100, 60),
        makeNode('b', 500, 500, 100, 60),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, new Set(['a']));

      expect(result.updatedPositions.size).toBe(0);
      expect(result.converged).toBe(true);
    });
  });

  describe('expand and dimension collision push', () => {
    it('pushes sibling when one node expands and is anchored', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 300, 200),
        makeNode('b', 250, 100, 150, 80),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, new Set(['a']));

      expect(result.updatedPositions.has('a')).toBe(false);
      expect(result.updatedPositions.has('b')).toBe(true);

      const aBox = posMap.get('a')!;
      const bBox = posMap.get('b')!;
      expect(bBox.y >= aBox.y + aBox.height + gap || bBox.x >= aBox.x + aBox.width + gap).toBe(true);
    });
  });

  describe('group-vs-group push with ancestor propagation', () => {
    it('pushes sibling group nodes apart at root scope', () => {
      const nodes: BoundsNode[] = [
        makeTypedNode('g1', 0, 0, 400, 300, undefined, 'group'),
        makeTypedNode('g2', 350, 100, 400, 300, undefined, 'group'),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, new Set(['g1']));

      expect(result.converged).toBe(true);
      expect(result.updatedPositions.has('g1')).toBe(false);
      expect(result.updatedPositions.has('g2')).toBe(true);

      const g1 = posMap.get('g1')!;
      const g2 = posMap.get('g2')!;
      expect(g2.y >= g1.y + g1.height + gap || g2.x >= g1.x + g1.width + gap).toBe(true);
    });
  });

  describe('container growth and margin', () => {
    it('expands parent container to fit children with margin', () => {
      const parent = makeTypedNode('parent', 0, 0, 200, 150, undefined, 'module');
      const child = makeNode('child', 20, 42, 250, 80, 'parent');
      const nodes: BoundsNode[] = [parent, child];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      resolveCollisions(nodes, posMap, null);

      const parentBox = posMap.get('parent')!;
      const childBox = posMap.get('child')!;
      expect(parentBox.width).toBeGreaterThanOrEqual(childBox.x + childBox.width);
      expect(parentBox.height).toBeGreaterThanOrEqual(childBox.y + childBox.height);
    });

    it('does not shrink non-group containers when children already fit', () => {
      const parent = makeTypedNode('parent', 0, 0, 500, 400, undefined, 'module');
      const child = makeNode('child', 20, 42, 100, 60, 'parent');
      const nodes: BoundsNode[] = [parent, child];
      const posMap = buildPositionMap(nodes, DEFAULTS);

      resolveCollisions(nodes, posMap, null);

      const parentBox = posMap.get('parent')!;
      expect(parentBox.width).toBe(500);
      expect(parentBox.height).toBe(400);
    });
  });

  describe('group exclusion zone and anchored drag priority', () => {
    it('does not shift group origin when child is hard-anchored', () => {
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

    it('expands group toward top and left when anchored child pushes into inset bounds', () => {
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

    it('expands group size instead of moving anchored child near right and bottom edge', () => {
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
    it('produces identical results for the same input', () => {
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
        nodes.push(makeNode(`n${String(i)}`, i * 10, i * 5, 200, 100));
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
        makeNode('b', 50, 20, 200, 100),
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
      const dx = Math.abs(bBox.x - originalBX);
      const dy = Math.abs(bBox.y - originalBY);
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(50);
    });
  });

  describe('scoped resolution via anchoredNodeIds', () => {
    it('only resolves sibling scopes affected by anchored nodes', () => {
      const nodes: BoundsNode[] = [
        makeTypedNode('p1', 0, 0, 500, 400, undefined, 'module'),
        makeNode('a1', 20, 42, 200, 100, 'p1'),
        makeNode('a2', 100, 60, 200, 100, 'p1'),
        makeTypedNode('p2', 600, 0, 500, 400, undefined, 'module'),
        makeNode('b1', 20, 42, 200, 100, 'p2'),
        makeNode('b2', 100, 60, 200, 100, 'p2'),
      ];

      const posMap = buildPositionMap(nodes, DEFAULTS);
      const originalB2 = { ...posMap.get('b2')! };

      resolveCollisions(nodes, posMap, new Set(['a1']));

      expect(posMap.get('b2')!.x).toBe(originalB2.x);
      expect(posMap.get('b2')!.y).toBe(originalB2.y);
    });
  });

  describe('full resolve without anchored nodes', () => {
    it('resolves all overlaps when anchoredNodeIds is null', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 200, 100),
        makeNode('b', 150, 50, 200, 100),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, null);

      expect(result.converged).toBe(true);

      const aBox = posMap.get('a')!;
      const bBox = posMap.get('b')!;
      const hClear = bBox.x >= aBox.x + aBox.width + gap || aBox.x >= bBox.x + bBox.width + gap;
      const vClear = bBox.y >= aBox.y + aBox.height + gap || aBox.y >= bBox.y + bBox.height + gap;
      expect(hClear || vClear).toBe(true);
    });
  });

  describe('cascade collisions', () => {
    it('chain-pushes a line of overlapping nodes', () => {
      const nodes: BoundsNode[] = [
        makeNode('a', 0, 0, 200, 100),
        makeNode('b', 150, 0, 200, 100),
        makeNode('c', 300, 0, 200, 100),
      ];
      const posMap = buildPositionMap(nodes, DEFAULTS);
      const result = resolveCollisions(nodes, posMap, new Set(['a']));

      expect(result.converged).toBe(true);

      const aBox = posMap.get('a')!;
      const bBox = posMap.get('b')!;
      const cBox = posMap.get('c')!;
      expect(aBox.x).toBe(0);
      expect(aBox.y).toBe(0);
      expect(bBox.x >= aBox.x + aBox.width + gap || bBox.y >= aBox.y + aBox.height + gap).toBe(true);
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

describe('settle loop regressions', () => {
  it('does not overlap last child with second-to-last in a multi-child group', () => {
    const pad = GROUP_EXCLUSION_ZONE_PX;
    const parent = makeTypedNode('grp', 0, 0, 300, 500, undefined, 'group');
    const child1 = makeNode('c1', pad, pad, 120, 80, 'grp');
    const child2 = makeNode('c2', pad, pad + 60, 120, 80, 'grp');
    const child3 = makeNode('c3', pad, pad + 120, 120, 80, 'grp');
    const nodes: BoundsNode[] = [parent, child1, child2, child3];
    const posMap = buildPositionMap(nodes, DEFAULTS);

    const result = resolveCollisions(nodes, posMap, null);
    expect(result.converged).toBe(true);

    const c2Box = posMap.get('c2')!;
    const c3Box = posMap.get('c3')!;
    const gap = DEFAULT_COLLISION_CONFIG.overlapGap;
    expect(c3Box.y).toBeGreaterThanOrEqual(c2Box.y + c2Box.height + gap);
  });

  it('allows group nodes to shrink when children move closer together', () => {
    const pad = GROUP_EXCLUSION_ZONE_PX;
    const parent = makeTypedNode('grp', 0, 0, 400, 800, undefined, 'group');
    const child1 = makeNode('c1', pad, pad, 120, 80, 'grp');
    const child2 = makeNode('c2', pad, pad + 200, 120, 80, 'grp');
    const nodes: BoundsNode[] = [parent, child1, child2];
    const posMap = buildPositionMap(nodes, DEFAULTS);

    resolveCollisions(nodes, posMap, null);

    const parentBox = posMap.get('grp')!;
    expect(parentBox.height).toBeLessThan(800);
  });
});
