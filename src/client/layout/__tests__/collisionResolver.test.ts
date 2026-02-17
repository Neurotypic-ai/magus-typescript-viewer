import { describe, it, expect } from 'vitest';

import {
  createCollisionConfig,
  getActiveCollisionConfig,
  DEFAULT_COLLISION_CONFIG,
  COLLISION_MINIMUM_DISTANCE_OPTION_KEY,
  resolveCollisions,
  buildPositionMap,
} from '../collisionResolver';

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
