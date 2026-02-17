import { describe, expect, it } from 'vitest';

import {
  createDefaultStrategyOptionsById,
  getRenderingStrategies,
  getRenderingStrategy,
  RENDERING_STRATEGIES,
} from '../rendering/strategyRegistry';

import type { RenderingStrategyId } from '../rendering/RenderingStrategy';

describe('rendering strategy registry', () => {
  it('contains exactly three strategies', () => {
    expect(RENDERING_STRATEGIES.size).toBe(3);
    expect(getRenderingStrategies().map((strategy) => strategy.id)).toEqual([
      'canvas',
      'vueflow',
      'folderDistributor',
    ]);
  });

  it('defines required metadata for each strategy', () => {
    const strategyIds: RenderingStrategyId[] = ['canvas', 'vueflow', 'folderDistributor'];
    for (const strategyId of strategyIds) {
      const strategy = getRenderingStrategy(strategyId);
      expect(strategy.id).toBe(strategyId);
      expect(strategy.label.length).toBeGreaterThan(0);
      expect(strategy.description.length).toBeGreaterThan(0);
      expect(strategy.runtime).toBeDefined();
      expect(Array.isArray(strategy.options)).toBe(true);
    }
  });

  it('falls back to canvas for unknown ids', () => {
    const strategy = getRenderingStrategy('not-a-strategy-id');
    expect(strategy.id).toBe('canvas');
  });

  it('builds default options keyed by all strategy ids', () => {
    const defaults = createDefaultStrategyOptionsById();
    expect(defaults).toHaveProperty('canvas');
    expect(defaults).toHaveProperty('vueflow');
    expect(defaults).toHaveProperty('folderDistributor');
  });
});
