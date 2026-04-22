import { describe, expect, it } from 'vitest';

import { bundleFanInTrunks } from '../bundleFanInTrunks';

import type { GraphEdgeData, GraphEdgeSide } from '../../../../shared/types/graph/GraphEdgeData';
import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string): DependencyNode {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { label: id },
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  data: Partial<GraphEdgeData> = {}
): GraphEdge {
  return {
    id,
    source,
    target,
    data: { type: 'import', ...data },
  };
}

function sourcesFanningInto(target: string, count: number, side?: GraphEdgeSide): GraphEdge[] {
  return Array.from({ length: count }, (_, i) =>
    makeEdge(
      `e-${target}-${String(i)}`,
      `src-${target}-${String(i)}`,
      target,
      side !== undefined ? { edgeSide: side } : {}
    )
  );
}

function allNodesFor(edges: GraphEdge[]): DependencyNode[] {
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.source);
    ids.add(e.target);
  }
  return [...ids].map(makeNode);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bundleFanInTrunks', () => {
  describe('threshold gate', () => {
    it('leaves edges unchanged when count is below default threshold (K=6)', () => {
      const edges = sourcesFanningInto('hub', 5);
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      expect(result).toHaveLength(5);
      expect(result.every((e) => !e.hidden)).toBe(true);
      expect(result.some((e) => e.data?.type === 'fanInTrunk')).toBe(false);
      expect(result.some((e) => e.data?.type === 'fanInStub')).toBe(false);
    });

    it('bundles edges when count meets default threshold (K=6)', () => {
      const edges = sourcesFanningInto('hub', 6);
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      const originals = result.filter((e) => e.id.startsWith('e-'));
      const trunks = result.filter((e) => e.data?.type === 'fanInTrunk');
      const stubs = result.filter((e) => e.data?.type === 'fanInStub');

      expect(originals).toHaveLength(6);
      expect(originals.every((e) => e.hidden === true)).toBe(true);
      expect(trunks).toHaveLength(1);
      expect(stubs).toHaveLength(6);
    });

    it('honours custom threshold', () => {
      const edges = sourcesFanningInto('hub', 3);
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes, undefined, { threshold: 3 });

      expect(result.filter((e) => e.data?.type === 'fanInTrunk')).toHaveLength(1);
      expect(result.filter((e) => e.data?.type === 'fanInStub')).toHaveLength(3);
    });
  });

  describe('per-side grouping', () => {
    it('creates separate trunks per side when edges converge on different sides', () => {
      // 6 edges on left side, 6 edges on top — two trunks expected.
      const leftEdges = sourcesFanningInto('hub', 6, 'left').map((e) => ({
        ...e,
        id: `${e.id}-left`,
        source: `${e.source}-left`,
      }));
      const topEdges = sourcesFanningInto('hub', 6, 'top').map((e) => ({
        ...e,
        id: `${e.id}-top`,
        source: `${e.source}-top`,
      }));
      const edges = [...leftEdges, ...topEdges];
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      const trunks = result.filter((e) => e.data?.type === 'fanInTrunk');
      const stubs = result.filter((e) => e.data?.type === 'fanInStub');
      expect(trunks).toHaveLength(2);
      expect(stubs).toHaveLength(12);

      const trunkIds = trunks.map((t) => t.id).sort();
      expect(trunkIds).toEqual(['trunk:hub:left', 'trunk:hub:top']);
    });

    it('does not combine sides that each fall below threshold', () => {
      // 3 edges on left, 3 on top — neither side meets K=6, no bundling.
      const leftEdges = sourcesFanningInto('hub', 3, 'left').map((e) => ({
        ...e,
        id: `${e.id}-left`,
        source: `${e.source}-left`,
      }));
      const topEdges = sourcesFanningInto('hub', 3, 'top').map((e) => ({
        ...e,
        id: `${e.id}-top`,
        source: `${e.source}-top`,
      }));
      const edges = [...leftEdges, ...topEdges];
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      expect(result.filter((e) => e.data?.type === 'fanInTrunk')).toHaveLength(0);
      expect(result.every((e) => !e.hidden)).toBe(true);
    });
  });

  describe('fallback when edgeSide is undefined (pre-Phase-2)', () => {
    it('treats all edges as left-side and bundles when count >= K', () => {
      // No edgeSide on any edge — they should all be grouped under 'left'.
      const edges = sourcesFanningInto('hub', 6);
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      const trunks = result.filter((e) => e.data?.type === 'fanInTrunk');
      expect(trunks).toHaveLength(1);
      expect(trunks[0]?.id).toBe('trunk:hub:left');
      // The trunk edge itself should NOT carry edgeSide (it was inferred from
      // the fallback, not populated by Phase 2).
      expect(trunks[0]?.data?.edgeSide).toBeUndefined();
    });
  });

  describe('junction math', () => {
    it('offsets the junction from the target on the left side by trunkOffset', () => {
      const edges = sourcesFanningInto('hub', 6, 'left');
      const nodes = allNodesFor(edges);
      const positions = new Map<string, { x: number; y: number }>();
      positions.set('hub', { x: 1000, y: 500 });
      // Sources at varying y so we can check the orthogonal mean.
      const sourceYs = [100, 200, 300, 400, 500, 600];
      edges.forEach((e, i) => {
        positions.set(e.source, { x: 200, y: sourceYs[i] ?? 0 });
      });

      const result = bundleFanInTrunks(edges, nodes, positions, { trunkOffset: 40 });

      const trunk = result.find((e) => e.data?.type === 'fanInTrunk');
      expect(trunk).toBeDefined();
      // x = target.x - 40 = 960, y = mean(sourceYs) = 350
      expect(trunk?.data?.trunkJunctionX).toBe(960);
      expect(trunk?.data?.trunkJunctionY).toBe(350);
    });

    it('offsets the junction on the top side using the mean X of sources', () => {
      const edges = sourcesFanningInto('hub', 6, 'top');
      const nodes = allNodesFor(edges);
      const positions = new Map<string, { x: number; y: number }>();
      positions.set('hub', { x: 500, y: 1000 });
      const sourceXs = [100, 200, 300, 400, 500, 600];
      edges.forEach((e, i) => {
        positions.set(e.source, { x: sourceXs[i] ?? 0, y: 0 });
      });

      const result = bundleFanInTrunks(edges, nodes, positions, { trunkOffset: 40 });

      const trunk = result.find((e) => e.data?.type === 'fanInTrunk');
      expect(trunk).toBeDefined();
      // y = target.y - 40 = 960, x = mean(sourceXs) = 350
      expect(trunk?.data?.trunkJunctionX).toBe(350);
      expect(trunk?.data?.trunkJunctionY).toBe(960);
    });

    it('stores zero junction coordinates when positions are not supplied', () => {
      const edges = sourcesFanningInto('hub', 6, 'left');
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      const trunk = result.find((e) => e.data?.type === 'fanInTrunk');
      expect(trunk?.data?.trunkJunctionX).toBe(0);
      expect(trunk?.data?.trunkJunctionY).toBe(0);
    });

    it('propagates junction coordinates onto stub edges', () => {
      const edges = sourcesFanningInto('hub', 6, 'left');
      const nodes = allNodesFor(edges);
      const positions = new Map<string, { x: number; y: number }>();
      positions.set('hub', { x: 1000, y: 500 });
      edges.forEach((e, i) => {
        positions.set(e.source, { x: 200, y: 100 + i * 100 });
      });

      const result = bundleFanInTrunks(edges, nodes, positions, { trunkOffset: 40 });

      const stubs = result.filter((e) => e.data?.type === 'fanInStub');
      expect(stubs.length).toBeGreaterThan(0);
      for (const stub of stubs) {
        expect(stub.data?.trunkJunctionX).toBe(960);
        expect(stub.data?.trunkJunctionY).toBe(350);
      }
    });
  });

  describe('determinism', () => {
    it('produces the same edge order regardless of input order', () => {
      const edges = sourcesFanningInto('hub', 6, 'left');
      const nodes = allNodesFor(edges);
      const shuffled = [...edges].reverse();

      const a = bundleFanInTrunks(edges, nodes).map((e) => e.id);
      const b = bundleFanInTrunks(shuffled, nodes).map((e) => e.id);

      // Synthetic trunk + stub ids should be identical between runs.
      const trunksA = a.filter((id) => id.startsWith('trunk:'));
      const stubsA = a.filter((id) => id.startsWith('stub:')).sort();
      const trunksB = b.filter((id) => id.startsWith('trunk:'));
      const stubsB = b.filter((id) => id.startsWith('stub:')).sort();
      expect(trunksA).toEqual(trunksB);
      expect(stubsA).toEqual(stubsB);
    });

    it('orders trunks deterministically across multiple targets', () => {
      const hubA = sourcesFanningInto('hub-a', 6, 'left');
      const hubB = sourcesFanningInto('hub-b', 6, 'left');
      const edges = [...hubB, ...hubA]; // intentionally out of order
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);
      const trunkIds = result
        .filter((e) => e.data?.type === 'fanInTrunk')
        .map((e) => e.id);

      expect(trunkIds).toEqual(['trunk:hub-a:left', 'trunk:hub-b:left']);
    });
  });

  describe('stub identity and metadata', () => {
    it('creates one stub per unique source with the correct id shape', () => {
      const edges = sourcesFanningInto('hub', 6, 'right');
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      const stubs = result.filter((e) => e.data?.type === 'fanInStub');
      const stubIds = stubs.map((s) => s.id).sort();
      const expected = edges
        .map((e) => `stub:${e.source}:hub:right`)
        .sort();
      expect(stubIds).toEqual(expected);
    });

    it('sets trunkId and trunkRole correctly on every synthesized edge', () => {
      const edges = sourcesFanningInto('hub', 6, 'left');
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      const trunk = result.find((e) => e.data?.type === 'fanInTrunk');
      const stubs = result.filter((e) => e.data?.type === 'fanInStub');
      expect(trunk?.data?.trunkRole).toBe('trunk');
      expect(trunk?.data?.trunkId).toBe('trunk:hub:left');
      for (const stub of stubs) {
        expect(stub.data?.trunkRole).toBe('stub');
        expect(stub.data?.trunkId).toBe('trunk:hub:left');
      }
    });

    it('collapses duplicate source→target pairs into one stub', () => {
      // Two edges from same source — should collapse to a single stub.
      const extraSource = 'src-dup';
      const uniqueSources = Array.from({ length: 6 }, (_, i) => `src-${String(i)}`);
      const edges: GraphEdge[] = [
        ...uniqueSources.map((s) =>
          makeEdge(`e-${s}`, s, 'hub', { edgeSide: 'left' })
        ),
        makeEdge('e-dup-1', extraSource, 'hub', { edgeSide: 'left' }),
        makeEdge('e-dup-2', extraSource, 'hub', { edgeSide: 'left' }),
      ];
      const nodes = allNodesFor(edges);

      const result = bundleFanInTrunks(edges, nodes);

      const stubs = result.filter((e) => e.data?.type === 'fanInStub');
      // 6 unique sources + 1 duplicate source = 7 distinct sources => 7 stubs.
      expect(stubs).toHaveLength(7);
      const dupStubs = stubs.filter((s) => s.source === extraSource);
      expect(dupStubs).toHaveLength(1);
    });
  });

  describe('does not re-bundle synthetic edges', () => {
    it('skips existing fanInTrunk/fanInStub edges when re-run', () => {
      const edges = sourcesFanningInto('hub', 6, 'left');
      const nodes = allNodesFor(edges);

      const first = bundleFanInTrunks(edges, nodes);
      const second = bundleFanInTrunks(first, nodes);

      // Second pass should not add a second layer of trunks on top of the
      // synthetic ones we already created.
      const firstTrunks = first.filter((e) => e.data?.type === 'fanInTrunk').length;
      const secondTrunks = second.filter((e) => e.data?.type === 'fanInTrunk').length;
      const firstStubs = first.filter((e) => e.data?.type === 'fanInStub').length;
      const secondStubs = second.filter((e) => e.data?.type === 'fanInStub').length;
      expect(secondTrunks).toBe(firstTrunks);
      expect(secondStubs).toBe(firstStubs);
    });
  });

  describe('empty and minimal inputs', () => {
    it('returns an empty list for an empty edge set', () => {
      expect(bundleFanInTrunks([], [])).toEqual([]);
    });

    it('returns input unchanged when node count is zero and edges are below threshold', () => {
      const edges: GraphEdge[] = [makeEdge('e1', 'a', 'b')];
      const nodes = allNodesFor(edges);
      expect(bundleFanInTrunks(edges, nodes)).toEqual(edges);
    });
  });
});
