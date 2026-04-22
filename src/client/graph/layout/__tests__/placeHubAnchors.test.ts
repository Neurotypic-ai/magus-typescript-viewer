import { describe, expect, it } from 'vitest';

import { placeHubAnchors } from '../placeHubAnchors';

import type { HubAnchorConstraint } from '../placeHubAnchors';
import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

function makeNode(id: string, layerIndex?: number): DependencyNode {
  return {
    id,
    type: 'module',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      ...(layerIndex !== undefined ? { layerIndex } : {}),
    },
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

describe('placeHubAnchors — unconstrained mode', () => {
  it('positions a hub at the weighted mean of its neighbours', () => {
    const hub = makeNode('hub');
    const positions = new Map([
      ['hub', { x: 0, y: 0 }],
      ['a', { x: 100, y: 200 }],
      ['b', { x: 200, y: 400 }],
      ['c', { x: 300, y: 600 }],
    ]);
    const edges: GraphEdge[] = [
      makeEdge('a', 'hub'),
      makeEdge('b', 'hub'),
      makeEdge('c', 'hub'),
    ];

    const result = placeHubAnchors([hub], edges, positions, { mode: 'unconstrained' });

    expect(result.get('hub')).toEqual({ x: 200, y: 400 });
  });

  it('leaves hubs with no positioned neighbours at their existing position', () => {
    const hub = makeNode('hub');
    const positions = new Map([['hub', { x: 42, y: 84 }]]);

    const result = placeHubAnchors([hub], [], positions, { mode: 'unconstrained' });

    expect(result.get('hub')).toEqual({ x: 42, y: 84 });
  });

  it('treats bidirectional neighbours symmetrically (source or target)', () => {
    const hub = makeNode('hub');
    const positions = new Map([
      ['hub', { x: 0, y: 0 }],
      ['a', { x: 100, y: 100 }],
      ['b', { x: 300, y: 300 }],
    ]);
    const edges: GraphEdge[] = [
      makeEdge('a', 'hub'), // a → hub
      makeEdge('hub', 'b'), // hub → b
    ];

    const result = placeHubAnchors([hub], edges, positions, { mode: 'unconstrained' });

    expect(result.get('hub')).toEqual({ x: 200, y: 200 });
  });

  it('does not mutate the input positions map', () => {
    const hub = makeNode('hub');
    const positions = new Map([
      ['hub', { x: 0, y: 0 }],
      ['a', { x: 100, y: 100 }],
    ]);
    const edges: GraphEdge[] = [makeEdge('a', 'hub')];

    const result = placeHubAnchors([hub], edges, positions, { mode: 'unconstrained' });

    expect(positions.get('hub')).toEqual({ x: 0, y: 0 });
    expect(result).not.toBe(positions);
    expect(result.get('hub')).toEqual({ x: 100, y: 100 });
  });

  it('processes hubs in degree-descending order for stable collision resolution', () => {
    const hub1 = makeNode('h1'); // degree 3
    const hub2 = makeNode('h2'); // degree 2
    const positions = new Map([
      ['h1', { x: 0, y: 0 }],
      ['h2', { x: 0, y: 0 }],
      ['n1', { x: 100, y: 0 }],
      ['n2', { x: 100, y: 0 }],
      ['n3', { x: 100, y: 0 }],
    ]);
    const edges: GraphEdge[] = [
      makeEdge('n1', 'h1'),
      makeEdge('n2', 'h1'),
      makeEdge('n3', 'h1'),
      makeEdge('n1', 'h2'),
      makeEdge('n2', 'h2'),
    ];

    const result = placeHubAnchors([hub1, hub2], edges, positions, { mode: 'unconstrained' });

    // Both want x=100, y=0 → collision. One gets pushed down.
    const h1 = result.get('h1');
    const h2 = result.get('h2');
    expect(h1).toBeDefined();
    expect(h2).toBeDefined();
    expect(h1?.x).toBe(100);
    expect(h2?.x).toBe(100);
    // Exactly one must be offset.
    expect(Math.abs((h1?.y ?? 0) - (h2?.y ?? 0))).toBeGreaterThanOrEqual(40);
  });
});

describe('placeHubAnchors — layer-band mode (Phase 4 contract)', () => {
  it('keeps X at the existing position and clamps Y to the layer band', () => {
    const hub = makeNode('hub', 2);
    const positions = new Map([
      ['hub', { x: 500, y: 0 }],
      ['a', { x: 0, y: 2000 }], // very low consumer
      ['b', { x: 0, y: 2500 }],
    ]);
    const edges: GraphEdge[] = [
      makeEdge('a', 'hub'),
      makeEdge('b', 'hub'),
    ];
    const constraint: HubAnchorConstraint = {
      mode: 'layer-band',
      layerBands: new Map([[2, { yMin: 100, yMax: 400 }]]),
    };

    const result = placeHubAnchors([hub], edges, positions, constraint);

    const pos = result.get('hub');
    expect(pos?.x).toBe(500); // X preserved
    expect(pos?.y).toBe(400); // mean Y = 2250 clamped to yMax = 400
  });

  it('uses unclamped mean Y when no band is registered for the hubs layer', () => {
    const hub = makeNode('hub', 7);
    const positions = new Map([
      ['hub', { x: 500, y: 0 }],
      ['a', { x: 0, y: 200 }],
      ['b', { x: 0, y: 400 }],
    ]);
    const edges: GraphEdge[] = [makeEdge('a', 'hub'), makeEdge('b', 'hub')];
    const constraint: HubAnchorConstraint = {
      mode: 'layer-band',
      layerBands: new Map(), // no band for layer 7
    };

    const result = placeHubAnchors([hub], edges, positions, constraint);

    expect(result.get('hub')).toEqual({ x: 500, y: 300 });
  });
});
