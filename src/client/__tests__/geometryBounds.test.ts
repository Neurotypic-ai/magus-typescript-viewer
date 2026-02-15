import { describe, it, expect } from 'vitest';

import {
  parseDimension,
  resolveNodeDimensions,
  buildAbsoluteNodeBoundsMap,
} from '../layout/geometryBounds';

import type { BoundsDefaults, BoundsNode } from '../layout/geometryBounds';

const DEFAULTS: BoundsDefaults = { defaultNodeWidth: 260, defaultNodeHeight: 100 };

describe('parseDimension', () => {
  it('returns finite numbers as-is', () => {
    expect(parseDimension(42)).toBe(42);
    expect(parseDimension(0)).toBe(0);
    expect(parseDimension(-10)).toBe(-10);
  });

  it('parses numeric strings', () => {
    expect(parseDimension('280px')).toBe(280);
    expect(parseDimension('3.5rem')).toBe(3.5);
  });

  it('returns undefined for non-parseable input', () => {
    expect(parseDimension(undefined)).toBeUndefined();
    expect(parseDimension(null)).toBeUndefined();
    expect(parseDimension('auto')).toBeUndefined();
    expect(parseDimension(NaN)).toBeUndefined();
    expect(parseDimension(Infinity)).toBeUndefined();
  });
});

describe('resolveNodeDimensions', () => {
  it('prefers style over measured over defaults', () => {
    const node: BoundsNode = {
      id: 'n1',
      position: { x: 0, y: 0 },
      style: { width: '400px', height: '200px' },
      measured: { width: 300, height: 150 },
    };
    const { width, height } = resolveNodeDimensions(node, DEFAULTS);
    expect(width).toBe(400);
    expect(height).toBe(200);
  });

  it('falls back to measured when style missing', () => {
    const node: BoundsNode = {
      id: 'n2',
      position: { x: 0, y: 0 },
      measured: { width: 350, height: 180 },
    };
    const { width, height } = resolveNodeDimensions(node, DEFAULTS);
    expect(width).toBe(350);
    expect(height).toBe(180);
  });

  it('falls back to defaults when nothing else is available', () => {
    const node: BoundsNode = { id: 'n3', position: { x: 0, y: 0 } };
    const { width, height } = resolveNodeDimensions(node, DEFAULTS);
    expect(width).toBe(260);
    expect(height).toBe(100);
  });

  it('clamps to minimum of 1', () => {
    const node: BoundsNode = {
      id: 'n4',
      position: { x: 0, y: 0 },
      measured: { width: 0, height: -5 },
    };
    const { width, height } = resolveNodeDimensions(node, { defaultNodeWidth: 0, defaultNodeHeight: 0 });
    expect(width).toBe(1);
    expect(height).toBe(1);
  });
});

describe('buildAbsoluteNodeBoundsMap', () => {
  it('converts relative positions to absolute through parentNode chain', () => {
    const nodes: BoundsNode[] = [
      { id: 'parent', position: { x: 100, y: 50 }, style: { width: '600px', height: '400px' } },
      { id: 'child', position: { x: 20, y: 30 }, parentNode: 'parent', measured: { width: 200, height: 80 } },
    ];
    const map = buildAbsoluteNodeBoundsMap(nodes, DEFAULTS);

    expect(map.get('parent')).toEqual({ x: 100, y: 50, width: 600, height: 400 });
    expect(map.get('child')).toEqual({ x: 120, y: 80, width: 200, height: 80 });
  });

  it('handles deeply nested parent chains', () => {
    const nodes: BoundsNode[] = [
      { id: 'root', position: { x: 10, y: 10 }, measured: { width: 100, height: 100 } },
      { id: 'mid', position: { x: 5, y: 5 }, parentNode: 'root', measured: { width: 80, height: 80 } },
      { id: 'leaf', position: { x: 3, y: 3 }, parentNode: 'mid', measured: { width: 50, height: 50 } },
    ];
    const map = buildAbsoluteNodeBoundsMap(nodes, DEFAULTS);

    // leaf absolute: 10 + 5 + 3 = 18, 10 + 5 + 3 = 18
    expect(map.get('leaf')).toEqual({ x: 18, y: 18, width: 50, height: 50 });
  });

  it('survives cycles gracefully (returns null for cyclic node)', () => {
    const nodes: BoundsNode[] = [
      { id: 'a', position: { x: 0, y: 0 }, parentNode: 'b', measured: { width: 100, height: 100 } },
      { id: 'b', position: { x: 0, y: 0 }, parentNode: 'a', measured: { width: 100, height: 100 } },
    ];
    // Should not throw
    const map = buildAbsoluteNodeBoundsMap(nodes, DEFAULTS);
    // At least one of them should still resolve (the first visited gets resolved
    // before the cycle guard kicks in for the second)
    expect(map.size).toBeGreaterThanOrEqual(1);
  });

  it('skips nodes without position', () => {
    const nodes: BoundsNode[] = [
      { id: 'n1', measured: { width: 100, height: 100 } }, // no position
      { id: 'n2', position: { x: 5, y: 5 }, measured: { width: 100, height: 100 } },
    ];
    const map = buildAbsoluteNodeBoundsMap(nodes, DEFAULTS);
    expect(map.has('n1')).toBe(false);
    expect(map.has('n2')).toBe(true);
  });
});

