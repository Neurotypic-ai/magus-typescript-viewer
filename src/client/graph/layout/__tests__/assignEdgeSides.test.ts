import { describe, expect, it } from 'vitest';

import { MODULE_HANDLE_IDS } from '../../handleRouting';
import { assignEdgeSides, dominantSide, handleIdForSide } from '../assignEdgeSides';

import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

function makeNode(id: string): DependencyNode {
  return {
    id,
    type: 'module',
    position: { x: 0, y: 0 },
    data: { label: id },
  } as DependencyNode;
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return {
    id,
    source,
    target,
    data: { type: 'import' },
  } as GraphEdge;
}

describe('dominantSide', () => {
  it.each([
    [10, 0, 'right'],
    [-10, 0, 'left'],
    [0, 10, 'bottom'],
    [0, -10, 'top'],
    [5, 3, 'right'], // |dx| >= |dy|
    [3, 5, 'bottom'], // |dx| < |dy|
    [-5, -3, 'left'],
    [-3, -5, 'top'],
    [5, 5, 'right'], // tie — horizontal wins
    [-5, -5, 'left'], // tie — horizontal wins (dx negative)
  ] as const)('dx=%s dy=%s → %s', (dx, dy, expected) => {
    expect(dominantSide(dx, dy)).toBe(expected);
  });
});

describe('handleIdForSide', () => {
  it('returns the canonical module handle id for every (role, side) pair', () => {
    expect(handleIdForSide('source', 'top')).toBe(MODULE_HANDLE_IDS.topOut);
    expect(handleIdForSide('source', 'right')).toBe(MODULE_HANDLE_IDS.rightOut);
    expect(handleIdForSide('source', 'bottom')).toBe(MODULE_HANDLE_IDS.bottomOut);
    expect(handleIdForSide('source', 'left')).toBe(MODULE_HANDLE_IDS.leftOut);
    expect(handleIdForSide('target', 'top')).toBe(MODULE_HANDLE_IDS.topIn);
    expect(handleIdForSide('target', 'right')).toBe(MODULE_HANDLE_IDS.rightIn);
    expect(handleIdForSide('target', 'bottom')).toBe(MODULE_HANDLE_IDS.bottomIn);
    expect(handleIdForSide('target', 'left')).toBe(MODULE_HANDLE_IDS.leftIn);
  });
});

describe('assignEdgeSides — cardinal configurations', () => {
  it('routes right-out → left-in when target is strictly to the right', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 0 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions);
    const [edge] = result;
    expect(edge?.sourceHandle).toBe(MODULE_HANDLE_IDS.rightOut);
    expect(edge?.targetHandle).toBe(MODULE_HANDLE_IDS.leftIn);
    expect(edge?.data?.edgeSourceSide).toBe('right');
    expect(edge?.data?.edgeSide).toBe('left');
  });

  it('routes left-out → right-in when target is strictly to the left', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map([
      ['a', { x: 100, y: 0 }],
      ['b', { x: 0, y: 0 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions);
    const [edge] = result;
    expect(edge?.sourceHandle).toBe(MODULE_HANDLE_IDS.leftOut);
    expect(edge?.targetHandle).toBe(MODULE_HANDLE_IDS.rightIn);
    expect(edge?.data?.edgeSourceSide).toBe('left');
    expect(edge?.data?.edgeSide).toBe('right');
  });

  it('routes bottom-out → top-in when target is strictly below source', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 0, y: 100 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions);
    const [edge] = result;
    expect(edge?.sourceHandle).toBe(MODULE_HANDLE_IDS.bottomOut);
    expect(edge?.targetHandle).toBe(MODULE_HANDLE_IDS.topIn);
    expect(edge?.data?.edgeSourceSide).toBe('bottom');
    expect(edge?.data?.edgeSide).toBe('top');
  });

  it('routes top-out → bottom-in when target is strictly above source', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map([
      ['a', { x: 0, y: 100 }],
      ['b', { x: 0, y: 0 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions);
    const [edge] = result;
    expect(edge?.sourceHandle).toBe(MODULE_HANDLE_IDS.topOut);
    expect(edge?.targetHandle).toBe(MODULE_HANDLE_IDS.bottomIn);
  });

  it('uses horizontal tiebreak when |dx| == |dy|', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 100 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions);
    const [edge] = result;
    expect(edge?.data?.edgeSourceSide).toBe('right');
    expect(edge?.data?.edgeSide).toBe('left');
  });

  it('uses horizontal axis when |dx| > |dy| (diagonal but horizontally dominant)', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 40 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions);
    const [edge] = result;
    expect(edge?.data?.edgeSourceSide).toBe('right');
    expect(edge?.data?.edgeSide).toBe('left');
  });

  it('uses vertical axis when |dy| > |dx| (diagonal but vertically dominant)', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 40, y: 100 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions);
    const [edge] = result;
    expect(edge?.data?.edgeSourceSide).toBe('bottom');
    expect(edge?.data?.edgeSide).toBe('top');
  });
});

describe('assignEdgeSides — non-positional edges', () => {
  it('leaves edges whose endpoints are missing from the position lookup untouched', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map<string, { x: number; y: number }>();
    const result = assignEdgeSides(edges, nodes, positions);
    expect(result[0]?.sourceHandle).toBeUndefined();
    expect(result[0]?.targetHandle).toBeUndefined();
    expect(result[0]?.data?.edgeSide).toBeUndefined();
  });

  it('does not remap folder-level edges (folder-*-out / folder-*-in)', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges: GraphEdge[] = [
      {
        id: 'trunk',
        source: 'a',
        target: 'b',
        sourceHandle: 'folder-right-out',
        targetHandle: 'folder-left-in',
        data: { type: 'import' },
      } as GraphEdge,
    ];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 0 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions);
    expect(result[0]?.sourceHandle).toBe('folder-right-out');
    expect(result[0]?.targetHandle).toBe('folder-left-in');
    expect(result[0]?.data?.edgeSide).toBeUndefined();
  });
});

describe('assignEdgeSides — hub distribution', () => {
  /**
   * 8 consumers arranged around a single hub (2 per quadrant). With
   * hubThreshold=8 the hub qualifies and should spread its incoming edges
   * across all four sides (~2 per side) instead of piling them onto one.
   */
  it('distributes 8 hub-incident edges approximately evenly across four sides', () => {
    const hub = makeNode('hub');
    const consumers = Array.from({ length: 8 }, (_, i) => makeNode(`c${String(i)}`));
    const nodes = [hub, ...consumers];

    // Two consumers per quadrant (NE, NW, SE, SW).
    const positions = new Map<string, { x: number; y: number }>();
    positions.set('hub', { x: 0, y: 0 });
    const quadrantPositions = [
      { x: 100, y: -60 }, // NE
      { x: 120, y: -40 },
      { x: -100, y: -60 }, // NW
      { x: -120, y: -40 },
      { x: 100, y: 60 }, // SE
      { x: 120, y: 40 },
      { x: -100, y: 60 }, // SW
      { x: -120, y: 40 },
    ];
    for (let i = 0; i < consumers.length; i += 1) {
      positions.set(`c${String(i)}`, quadrantPositions[i] ?? { x: 0, y: 0 });
    }

    const edges: GraphEdge[] = consumers.map((c, i) => makeEdge(`e${String(i)}`, c.id, 'hub'));

    const result = assignEdgeSides(edges, nodes, positions, 8);

    // Count how many edges land on each side of the hub.
    const sideCounts = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const edge of result) {
      const side = edge.data?.edgeSide;
      if (side) sideCounts[side] += 1;
    }

    // Every side should receive at least one edge (no 50-onto-one pathology).
    expect(sideCounts.top).toBeGreaterThan(0);
    expect(sideCounts.right).toBeGreaterThan(0);
    expect(sideCounts.bottom).toBeGreaterThan(0);
    expect(sideCounts.left).toBeGreaterThan(0);

    // No single side carries more than ceil(8/4)=2 edges (strict balance).
    expect(sideCounts.top).toBeLessThanOrEqual(2);
    expect(sideCounts.right).toBeLessThanOrEqual(2);
    expect(sideCounts.bottom).toBeLessThanOrEqual(2);
    expect(sideCounts.left).toBeLessThanOrEqual(2);

    // Total still equals 8.
    const total = sideCounts.top + sideCounts.right + sideCounts.bottom + sideCounts.left;
    expect(total).toBe(8);
  });

  it('does not treat low-degree nodes as hubs (hubThreshold default = 10)', () => {
    // Three satellites to the right of centre. Edges go satellite → centre
    // (source at x=100, target at x=0 → dx=-100 → source side 'left',
    // target side 'right'). Without hub balancing all three edges arrive on
    // the centre's right side.
    const center = makeNode('n');
    const satellites = Array.from({ length: 3 }, (_, i) => makeNode(`s${String(i)}`));
    const nodes = [center, ...satellites];
    const positions = new Map<string, { x: number; y: number }>();
    positions.set('n', { x: 0, y: 0 });
    positions.set('s0', { x: 100, y: 10 });
    positions.set('s1', { x: 101, y: 5 });
    positions.set('s2', { x: 99, y: 8 });
    const edges: GraphEdge[] = satellites.map((s, i) => makeEdge(`e${String(i)}`, s.id, 'n'));

    const result = assignEdgeSides(edges, nodes, positions);
    const sideCounts = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const edge of result) {
      const side = edge.data?.edgeSide;
      if (side) sideCounts[side] += 1;
    }
    // With hubThreshold=10 neither the centre (degree 3) nor any satellite
    // (degree 1) is treated as a hub, so purely geometric routing applies.
    expect(sideCounts.right).toBe(3);
    expect(sideCounts.top).toBe(0);
    expect(sideCounts.bottom).toBe(0);
    expect(sideCounts.left).toBe(0);
  });

  it('is deterministic — repeated runs produce identical side counts', () => {
    const hub = makeNode('hub');
    const consumers = Array.from({ length: 10 }, (_, i) => makeNode(`c${String(i)}`));
    const nodes = [hub, ...consumers];
    const positions = new Map<string, { x: number; y: number }>();
    positions.set('hub', { x: 0, y: 0 });
    for (let i = 0; i < consumers.length; i += 1) {
      const angle = (Math.PI * 2 * i) / consumers.length;
      positions.set(`c${String(i)}`, { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 });
    }
    const edges: GraphEdge[] = consumers.map((c, i) => makeEdge(`e${String(i)}`, c.id, 'hub'));

    const first = assignEdgeSides(edges, nodes, positions, 8);
    const second = assignEdgeSides(edges, nodes, positions, 8);

    const pluck = (res: GraphEdge[]) =>
      res.map((e) => ({
        id: e.id,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        sourceSide: e.data?.edgeSourceSide,
        targetSide: e.data?.edgeSide,
      }));

    expect(pluck(first)).toEqual(pluck(second));
  });
});

describe('assignEdgeSides — node sizes', () => {
  it('uses node centres (position + half-size) when sizes are provided', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    // Top-left positions: a at (0,0) with size 200x50, b at (300,0) with
    // size 200x50. Centres: a=(100, 25), b=(400, 25). b is strictly to the
    // right of a's centre, so routing is right-out / left-in.
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 300, y: 0 }],
    ]);
    const sizes = new Map([
      ['a', { width: 200, height: 50 }],
      ['b', { width: 200, height: 50 }],
    ]);
    const result = assignEdgeSides(edges, nodes, positions, 10, { sizes });
    const [edge] = result;
    expect(edge?.sourceHandle).toBe(MODULE_HANDLE_IDS.rightOut);
    expect(edge?.targetHandle).toBe(MODULE_HANDLE_IDS.leftIn);
  });
});
