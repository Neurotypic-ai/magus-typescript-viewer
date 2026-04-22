import { describe, expect, it } from 'vitest';

import { layoutExternalBand } from '../layoutExternalBand';

import type { BandRect } from '../layoutExternalBand';
import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

function makeExternal(id: string): DependencyNode {
  return {
    id,
    type: 'externalPackage',
    position: { x: 0, y: 0 },
    data: { label: id },
  } as DependencyNode;
}

function makeEdge(source: string, target: string): GraphEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    data: { type: 'import' },
  } as GraphEdge;
}

const DEFAULT_BAND: BandRect = { left: 0, right: 2000, top: 1000, height: 960 };

describe('layoutExternalBand', () => {
  it('returns an empty map when there are no externals', () => {
    const result = layoutExternalBand([], [], new Map(), DEFAULT_BAND);
    expect(result.size).toBe(0);
  });

  it('places an external at (or clamped to) the mean X of its consumers', () => {
    const ext = makeExternal('external:vue');
    const consumers = new Map([
      ['mod-a', { x: 100, y: 0 }],
      ['mod-b', { x: 300, y: 0 }],
      ['mod-c', { x: 500, y: 0 }],
    ]);
    const edges: GraphEdge[] = [
      makeEdge('mod-a', 'external:vue'),
      makeEdge('mod-b', 'external:vue'),
      makeEdge('mod-c', 'external:vue'),
    ];

    const result = layoutExternalBand([ext], edges, consumers, DEFAULT_BAND);

    const pos = result.get('external:vue');
    expect(pos?.x).toBe(300); // exact mean (all within band)
    expect(pos?.y).toBe(DEFAULT_BAND.top); // tier 0 (single external → highest degree)
  });

  it('stacks externals alphabetically at bandRect.left when they have no visible consumers', () => {
    const extA = makeExternal('external:alpha');
    const extB = makeExternal('external:beta');
    const extC = makeExternal('external:gamma');

    // No consumer positions — everything falls back to the alphabetical stack.
    const result = layoutExternalBand([extC, extA, extB], [], new Map(), DEFAULT_BAND);

    // Expected order (alphabetical): alpha at left, beta at left+220, gamma at left+440
    expect(result.get('external:alpha')?.x).toBe(DEFAULT_BAND.left);
    expect(result.get('external:beta')?.x).toBe(DEFAULT_BAND.left + 220);
    expect(result.get('external:gamma')?.x).toBe(DEFAULT_BAND.left + 440);
  });

  it('clamps the centroid X into the band rectangle', () => {
    const ext = makeExternal('external:offscreen');
    const consumers = new Map([
      ['mod-a', { x: -5000, y: 0 }],
    ]);
    const edges: GraphEdge[] = [makeEdge('mod-a', 'external:offscreen')];

    const band: BandRect = { left: 0, right: 1000, top: 500, height: 960 };
    const result = layoutExternalBand([ext], edges, consumers, band);

    const pos = result.get('external:offscreen');
    expect(pos?.x).toBe(0); // clamped to band.left
  });

  it('assigns externals to three tiers by consumer degree', () => {
    const extHigh = makeExternal('external:high');
    const extMid = makeExternal('external:mid');
    const extLow = makeExternal('external:low');

    const consumers = new Map<string, { x: number; y: number }>();
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 6; i++) {
      consumers.set(`c-h-${String(i)}`, { x: 100 * i, y: 0 });
      edges.push(makeEdge(`c-h-${String(i)}`, 'external:high'));
    }
    for (let i = 0; i < 3; i++) {
      consumers.set(`c-m-${String(i)}`, { x: 100 * i, y: 0 });
      edges.push(makeEdge(`c-m-${String(i)}`, 'external:mid'));
    }
    consumers.set('c-l-0', { x: 0, y: 0 });
    edges.push(makeEdge('c-l-0', 'external:low'));

    const band: BandRect = { left: 0, right: 2000, top: 1000, height: 960 };
    const result = layoutExternalBand([extHigh, extMid, extLow], edges, consumers, band);

    const tier0Y = band.top;
    const tier1Y = band.top + 320;
    const tier2Y = band.top + 640;

    expect(result.get('external:high')?.y).toBe(tier0Y);
    expect(result.get('external:mid')?.y).toBe(tier1Y);
    expect(result.get('external:low')?.y).toBe(tier2Y);
  });

  it('separates externals that land on overlapping X within the same tier', () => {
    // Three externals so the top tier holds more than one when tercile-bucketed.
    const extA = makeExternal('external:a');
    const extB = makeExternal('external:b');
    const extC = makeExternal('external:c');

    // A and B want the same centroid (both have degree 2 via the same
    // consumers); C has a single consumer so it lands in a lower tier.
    const consumers = new Map([
      ['mod-shared-1', { x: 400, y: 0 }],
      ['mod-shared-2', { x: 600, y: 0 }],
      ['mod-lonely', { x: 1800, y: 0 }],
    ]);
    const edges: GraphEdge[] = [
      makeEdge('mod-shared-1', 'external:a'),
      makeEdge('mod-shared-2', 'external:a'),
      makeEdge('mod-shared-1', 'external:b'),
      makeEdge('mod-shared-2', 'external:b'),
      makeEdge('mod-lonely', 'external:c'),
    ];

    const result = layoutExternalBand([extA, extB, extC], edges, consumers, DEFAULT_BAND);
    const posA = result.get('external:a');
    const posB = result.get('external:b');
    expect(posA).toBeDefined();
    expect(posB).toBeDefined();
    // A and B must share the same Y tier (both degree 2).
    expect(posA?.y).toBe(posB?.y);
    // And their X values must be separated by at least one nodeWidth (220px).
    expect(Math.abs((posA?.x ?? 0) - (posB?.x ?? 0))).toBeGreaterThanOrEqual(220);
  });

  it('honours a custom nodeWidth for fallback stacking', () => {
    const extA = makeExternal('external:a');
    const extB = makeExternal('external:b');

    const result = layoutExternalBand([extA, extB], [], new Map(), DEFAULT_BAND, {
      nodeWidth: 500,
    });
    expect(result.get('external:a')?.x).toBe(DEFAULT_BAND.left);
    expect(result.get('external:b')?.x).toBe(DEFAULT_BAND.left + 500);
  });
});
