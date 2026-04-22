import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INTERNAL_HUB_THRESHOLD,
  computeLayerBands,
  relocateInternalHubs,
} from '../relocateInternalHubs';

import type { Positions } from '../placeHubAnchors';
import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

type NodeOverrides = Partial<Omit<DependencyNode, 'id' | 'type'>> & {
  data?: Partial<NonNullable<DependencyNode['data']>>;
};

function makeNode(
  id: string,
  opts: {
    layoutBand?: 'internal' | 'external' | 'scc';
    layerIndex?: number;
    parentNode?: string;
  } & NodeOverrides = {}
): DependencyNode {
  const { layoutBand, layerIndex, parentNode, data, ...rest } = opts;
  return {
    id,
    type: 'module',
    position: { x: 0, y: 0 },
    ...(parentNode !== undefined ? { parentNode } : {}),
    ...rest,
    data: {
      label: id,
      ...(layoutBand !== undefined ? { layoutBand } : {}),
      ...(layerIndex !== undefined ? { layerIndex } : {}),
      ...data,
    },
  } as DependencyNode;
}

function makeEdge(source: string, target: string): GraphEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    data: { type: 'import' },
  } as GraphEdge;
}

/** Helper: build an internal hub at layer 1 with six consumers at layer 2. */
function buildHubWithConsumers(): {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  positions: Positions;
} {
  const hub = makeNode('hub', { layoutBand: 'internal', layerIndex: 1 });
  const consumers: DependencyNode[] = [];
  const edges: GraphEdge[] = [];
  const positions: Positions = new Map();
  positions.set('hub', { x: 1000, y: 0 });
  // Six consumers at layer 2, spread vertically from y=0..y=500.
  const ys = [0, 100, 200, 300, 400, 500];
  for (let i = 0; i < ys.length; i++) {
    const id = `c${String(i)}`;
    const y = ys[i] ?? 0;
    consumers.push(makeNode(id, { layoutBand: 'internal', layerIndex: 2 }));
    positions.set(id, { x: 500, y });
    edges.push(makeEdge(id, 'hub'));
  }
  // Include one layer-1 companion so the hub's layer Y-band has a width.
  const companion = makeNode('comp', { layoutBand: 'internal', layerIndex: 1 });
  positions.set('comp', { x: 1000, y: 600 });
  return {
    nodes: [hub, companion, ...consumers],
    edges,
    positions,
  };
}

describe('computeLayerBands', () => {
  it('computes min/max Y per layer from root-level nodes only', () => {
    const nodes = [
      makeNode('a', { layerIndex: 0 }),
      makeNode('b', { layerIndex: 0 }),
      makeNode('c', { layerIndex: 1 }),
      makeNode('child', { layerIndex: 1, parentNode: 'c' }),
    ];
    const positions: Positions = new Map([
      ['a', { x: 0, y: 10 }],
      ['b', { x: 0, y: 90 }],
      ['c', { x: 0, y: 500 }],
      ['child', { x: 0, y: 9999 }], // should be ignored
    ]);

    const bands = computeLayerBands(nodes, positions);

    expect(bands.get(0)).toEqual({ yMin: 10, yMax: 90 });
    expect(bands.get(1)).toEqual({ yMin: 500, yMax: 500 });
  });

  it('skips nodes without a layerIndex or without a position', () => {
    const nodes = [
      makeNode('a'), // no layerIndex
      makeNode('b', { layerIndex: 0 }),
      makeNode('c', { layerIndex: 0 }),
    ];
    const positions: Positions = new Map([
      ['b', { x: 0, y: 100 }],
      // 'c' missing on purpose.
    ]);

    const bands = computeLayerBands(nodes, positions);

    expect(bands.size).toBe(1);
    expect(bands.get(0)).toEqual({ yMin: 100, yMax: 100 });
  });
});

describe('relocateInternalHubs — plan §6 Phase 4', () => {
  it('pulls a hub with 6 consumers toward the mean Y of consumers, clamped to the hub layer band', () => {
    // Single hub at y=0 with 6 consumers at ys 100..500 (mean 300). Hub's
    // layer band is [0, 600] so the centroid Y (~250) sits inside the band
    // and should move the hub from y=0 to y≈250.
    const { nodes, edges, positions } = buildHubWithConsumers();

    const result = relocateInternalHubs(nodes, edges, positions, /* threshold */ 5);

    const hub = result.get('hub');
    expect(hub).toBeDefined();
    expect(hub?.x).toBe(1000); // X preserved by layer-band mode
    // Mean of consumer ys = (0+100+200+300+400+500)/6 = 250. Layer band for
    // layer 1 is min 0, max 600 (hub y=0 + companion y=600), so 250 is
    // unclamped.
    expect(hub?.y).toBeCloseTo(250, 0);
  });

  it('visual-math check: hub at y=0 with neighbours at 100..500 lands near the mean (≈300 when mean=300)', () => {
    // Deliberately different fixture matching the task's verification step
    // (5 neighbours, not 6, ys=100..500 → mean 300).
    const hub = makeNode('hub', { layoutBand: 'internal', layerIndex: 1 });
    const companion = makeNode('comp', { layoutBand: 'internal', layerIndex: 1 });
    const positions: Positions = new Map([
      ['hub', { x: 1000, y: 0 }],
      ['comp', { x: 1000, y: 700 }], // widens the band so mean is not clamped
    ]);
    const edges: GraphEdge[] = [];
    const consumerIds = ['n1', 'n2', 'n3', 'n4', 'n5'];
    const ys = [100, 200, 300, 400, 500];
    const nodes: DependencyNode[] = [hub, companion];
    for (let i = 0; i < consumerIds.length; i++) {
      const id = consumerIds[i] ?? `n${String(i)}`;
      const y = ys[i] ?? 0;
      nodes.push(makeNode(id, { layoutBand: 'internal', layerIndex: 2 }));
      positions.set(id, { x: 500, y });
      edges.push(makeEdge(id, 'hub'));
    }

    const result = relocateInternalHubs(nodes, edges, positions, /* threshold */ 5);

    const hub1 = result.get('hub');
    expect(hub1?.x).toBe(1000);
    // Mean of 100..500 is 300; the layer 1 Y-band here is [0, 700] so no clamp.
    expect(hub1?.y).toBeCloseTo(300, 0);
  });

  it('clamps the hub Y to the layer band when the centroid lies outside', () => {
    // Hub at layer 1 with consumers far below any sibling in the hub's layer.
    // Band = [y(hub)=0, y(companion)=200]. Consumers all at y=2000 → mean
    // 2000 → clamp to yMax=200.
    const hub = makeNode('hub', { layoutBand: 'internal', layerIndex: 1 });
    const companion = makeNode('comp', { layoutBand: 'internal', layerIndex: 1 });
    const positions: Positions = new Map([
      ['hub', { x: 1000, y: 0 }],
      ['comp', { x: 1000, y: 200 }],
    ]);
    const edges: GraphEdge[] = [];
    const nodes: DependencyNode[] = [hub, companion];
    for (let i = 0; i < 6; i++) {
      const id = `c${String(i)}`;
      nodes.push(makeNode(id, { layoutBand: 'internal', layerIndex: 2 }));
      positions.set(id, { x: 500, y: 2000 });
      edges.push(makeEdge(id, 'hub'));
    }

    const result = relocateInternalHubs(nodes, edges, positions, 5);

    expect(result.get('hub')?.y).toBe(200); // clamped to yMax
  });

  it('resolves collisions by pushing the second hub when two hubs want the same Y', () => {
    // Two hubs h1 and h2, both in layer 1. Each has 6 consumers at identical
    // positions so both want the same centroid. Collision resolution should
    // push one vertically by at least 40 px (the default tolerance — see
    // placeHubAnchors COLLISION_TOLERANCE_PX).
    const h1 = makeNode('h1', { layoutBand: 'internal', layerIndex: 1 });
    const h2 = makeNode('h2', { layoutBand: 'internal', layerIndex: 1 });
    const positions: Positions = new Map([
      ['h1', { x: 1000, y: 0 }],
      ['h2', { x: 1000, y: 0 }],
    ]);
    const edges: GraphEdge[] = [];
    const nodes: DependencyNode[] = [h1, h2];
    // 6 consumers at identical y (centroid = 250) for both hubs.
    for (let i = 0; i < 6; i++) {
      const id = `cons${String(i)}`;
      nodes.push(makeNode(id, { layoutBand: 'internal', layerIndex: 2 }));
      positions.set(id, { x: 500, y: 250 });
      edges.push(makeEdge(id, 'h1'));
      edges.push(makeEdge(id, 'h2'));
    }
    // Widen the hub layer band so 250 is in-band for both.
    const companion = makeNode('comp', { layoutBand: 'internal', layerIndex: 1 });
    nodes.push(companion);
    positions.set('comp', { x: 1000, y: 800 });

    const result = relocateInternalHubs(nodes, edges, positions, 5);

    const p1 = result.get('h1');
    const p2 = result.get('h2');
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1?.x).toBe(1000);
    expect(p2?.x).toBe(1000);
    // Exactly one must be offset relative to the other.
    const dy = Math.abs((p1?.y ?? 0) - (p2?.y ?? 0));
    expect(dy).toBeGreaterThanOrEqual(40);
  });

  it('collision resolution is deterministic across repeated invocations', () => {
    // Same fixture as above; run twice and assert identical output. Proves
    // the byDegree + byId tiebreak in placeHubAnchors yields stable ordering.
    const build = () => {
      const h1 = makeNode('h1', { layoutBand: 'internal', layerIndex: 1 });
      const h2 = makeNode('h2', { layoutBand: 'internal', layerIndex: 1 });
      const positions: Positions = new Map([
        ['h1', { x: 1000, y: 0 }],
        ['h2', { x: 1000, y: 0 }],
      ]);
      const edges: GraphEdge[] = [];
      const nodes: DependencyNode[] = [h1, h2];
      for (let i = 0; i < 6; i++) {
        const id = `cons${String(i)}`;
        nodes.push(makeNode(id, { layoutBand: 'internal', layerIndex: 2 }));
        positions.set(id, { x: 500, y: 250 });
        edges.push(makeEdge(id, 'h1'));
        edges.push(makeEdge(id, 'h2'));
      }
      const companion = makeNode('comp', { layoutBand: 'internal', layerIndex: 1 });
      nodes.push(companion);
      positions.set('comp', { x: 1000, y: 800 });
      return { nodes, edges, positions };
    };

    const run1 = relocateInternalHubs(build().nodes, build().edges, build().positions, 5);
    const run2 = relocateInternalHubs(build().nodes, build().edges, build().positions, 5);

    expect(run1.get('h1')).toEqual(run2.get('h1'));
    expect(run1.get('h2')).toEqual(run2.get('h2'));
  });

  it('leaves low-degree internal modules untouched', () => {
    // Threshold = 10 (default). A module with degree 3 should not move even
    // though it has internal tag.
    const nonHub = makeNode('non-hub', { layoutBand: 'internal', layerIndex: 1 });
    const nodes: DependencyNode[] = [nonHub];
    const edges: GraphEdge[] = [];
    const positions: Positions = new Map([['non-hub', { x: 1000, y: 42 }]]);
    for (let i = 0; i < 3; i++) {
      const id = `n${String(i)}`;
      nodes.push(makeNode(id, { layoutBand: 'internal', layerIndex: 2 }));
      positions.set(id, { x: 500, y: 2000 });
      edges.push(makeEdge(id, 'non-hub'));
    }

    const result = relocateInternalHubs(nodes, edges, positions);

    // degree < default threshold 10 → untouched.
    expect(result.get('non-hub')).toEqual({ x: 1000, y: 42 });
  });

  it('ignores external-band nodes even if they have degree ≥ threshold', () => {
    // Externals are Phase 1's problem. Phase 4 must never move them.
    const ext = makeNode('ext', { layoutBand: 'external', layerIndex: 0 });
    const nodes: DependencyNode[] = [ext];
    const edges: GraphEdge[] = [];
    const positions: Positions = new Map([['ext', { x: 9999, y: 5000 }]]);
    for (let i = 0; i < 10; i++) {
      const id = `c${String(i)}`;
      nodes.push(makeNode(id, { layoutBand: 'internal', layerIndex: 1 }));
      positions.set(id, { x: 500, y: i * 100 });
      edges.push(makeEdge(id, 'ext'));
    }

    const result = relocateInternalHubs(nodes, edges, positions);

    expect(result.get('ext')).toEqual({ x: 9999, y: 5000 });
  });

  it('ignores SCC-band nodes', () => {
    const scc = makeNode('scc', { layoutBand: 'scc', layerIndex: 0 });
    const nodes: DependencyNode[] = [scc];
    const edges: GraphEdge[] = [];
    const positions: Positions = new Map([['scc', { x: 1000, y: 500 }]]);
    for (let i = 0; i < 10; i++) {
      const id = `c${String(i)}`;
      nodes.push(makeNode(id, { layoutBand: 'internal', layerIndex: 1 }));
      positions.set(id, { x: 500, y: i * 100 });
      edges.push(makeEdge(id, 'scc'));
    }

    const result = relocateInternalHubs(nodes, edges, positions);

    expect(result.get('scc')).toEqual({ x: 1000, y: 500 });
  });

  it('ignores internal nodes with a parentNode (they are children of a folder or supernode)', () => {
    const child = makeNode('child', {
      layoutBand: 'internal',
      layerIndex: 1,
      parentNode: 'folder',
    });
    const nodes: DependencyNode[] = [child];
    const edges: GraphEdge[] = [];
    const positions: Positions = new Map([['child', { x: 100, y: 77 }]]);
    for (let i = 0; i < 10; i++) {
      const id = `c${String(i)}`;
      nodes.push(makeNode(id, { layoutBand: 'internal', layerIndex: 2 }));
      positions.set(id, { x: 200, y: i * 100 });
      edges.push(makeEdge(id, 'child'));
    }

    const result = relocateInternalHubs(nodes, edges, positions);

    expect(result.get('child')).toEqual({ x: 100, y: 77 });
  });

  it('returns a new map even when there are no hubs to relocate', () => {
    const nodes: DependencyNode[] = [makeNode('a', { layoutBand: 'internal', layerIndex: 0 })];
    const positions: Positions = new Map([['a', { x: 0, y: 0 }]]);

    const result = relocateInternalHubs(nodes, [], positions);

    expect(result).not.toBe(positions);
    expect(result.get('a')).toEqual({ x: 0, y: 0 });
  });

  it('with flag OFF (simulated: degree threshold higher than any degree) positions are identical', () => {
    // The caller gate in useGraphLayout is a module-local constant, so the
    // meaningful "flag off" test is: raise the threshold so no node qualifies,
    // verify the output matches the input verbatim.
    const { nodes, edges, positions } = buildHubWithConsumers();
    const before = new Map(positions);

    const result = relocateInternalHubs(nodes, edges, positions, 9999);

    for (const [id, pos] of before) {
      expect(result.get(id)).toEqual(pos);
    }
  });

  it('exposes a sensible default threshold constant', () => {
    // Plan §6 Phase 4 recommends threshold = 10.
    expect(DEFAULT_INTERNAL_HUB_THRESHOLD).toBe(10);
  });
});
