import { describe, expect, it } from 'vitest';

import {
  createDefaultStrategyOptionsById,
  getRenderingStrategies,
  getRenderingStrategy,
  RENDERING_STRATEGIES,
  sanitizeStrategyOptionsById,
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
      const view = getRenderingStrategy(strategyId);
      expect(view.id).toBe(strategyId);
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.description.length).toBeGreaterThan(0);
      expect(view.runtime).toBeDefined();
      expect(view.runtime).toHaveProperty('forcesClusterByFolder');
      expect(Array.isArray(view.options)).toBe(true);
    }
  });

  it('sets forcesClusterByFolder true for folderDistributor, false for canvas/vueflow', () => {
    expect(getRenderingStrategy('canvas').runtime.forcesClusterByFolder).toBe(false);
    expect(getRenderingStrategy('vueflow').runtime.forcesClusterByFolder).toBe(false);
    expect(getRenderingStrategy('folderDistributor').runtime.forcesClusterByFolder).toBe(true);
  });

  it('falls back to canvas for unknown ids', () => {
    const view = getRenderingStrategy('not-a-strategy-id');
    expect(view.id).toBe('canvas');
  });

  it('builds default options keyed by all strategy ids', () => {
    const defaults = createDefaultStrategyOptionsById();
    expect(defaults).toHaveProperty('canvas');
    expect(defaults).toHaveProperty('vueflow');
    expect(defaults).toHaveProperty('folderDistributor');
  });

  it('defaults contain degreeWeightedLayers for canvas and vueflow', () => {
    const defaults = createDefaultStrategyOptionsById();
    expect(defaults.canvas['degreeWeightedLayers']).toBe(false);
    expect(defaults.vueflow['degreeWeightedLayers']).toBe(false);
  });

  it('defaults contain minimumDistancePx for folderDistributor', () => {
    const defaults = createDefaultStrategyOptionsById();
    expect(defaults.folderDistributor['minimumDistancePx']).toBe(40);
  });

  it('sanitizeStrategyOptionsById clamps minimumDistancePx to min/max', () => {
    const sanitized = sanitizeStrategyOptionsById({
      canvas: {},
      vueflow: {},
      folderDistributor: { minimumDistancePx: 5 },
    });
    expect(sanitized.folderDistributor['minimumDistancePx']).toBe(20);

    const sanitizedMax = sanitizeStrategyOptionsById({
      canvas: {},
      vueflow: {},
      folderDistributor: { minimumDistancePx: 200 },
    });
    expect(sanitizedMax.folderDistributor['minimumDistancePx']).toBe(100);
  });

  it('sanitizeStrategyOptionsById preserves valid degreeWeightedLayers', () => {
    const sanitized = sanitizeStrategyOptionsById({
      canvas: { degreeWeightedLayers: true },
      vueflow: {},
      folderDistributor: {},
    });
    expect(sanitized.canvas['degreeWeightedLayers']).toBe(true);
  });
});
