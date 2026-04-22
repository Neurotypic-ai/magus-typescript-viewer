/**
 * Internal layout for SCC supernodes.
 *
 * An SCC supernode is a compound-like container; its members need positions
 * relative to the parent's top-left corner (0, 0). Two strategies:
 *
 *   - members.length < 10: circular layout. Members are placed evenly on
 *     a circle; predictable and readable for small cycles.
 *   - members.length >= 10: Fruchterman-Reingold force-directed pass with
 *     a fixed iteration budget. Good enough for rare large SCCs.
 *
 * The algorithm is deterministic: initial circular placement and sorted
 * inputs make F-R converge to the same positions across runs.
 */

import type { GraphEdge } from '../../types/GraphEdge';

export interface SccLayoutResult {
  /** memberId → {x, y} relative to the supernode's top-left (0, 0). */
  positions: Map<string, { x: number; y: number }>;
  /** Bounding box of the supernode's contents, including padding. */
  parentSize: { width: number; height: number };
}

/** Space reserved around the members for the supernode's chrome (header + border + inset). */
const PADDING = 60;
/** Typical rendered size of a module node; used to compute safe spacing. */
const NODE_RADIUS = 80;
/** F-R iteration count. */
const FORCE_ITERATIONS = 30;

function circularLayout(members: readonly string[]): {
  positions: Map<string, { x: number; y: number }>;
  radius: number;
} {
  const positions = new Map<string, { x: number; y: number }>();
  const sorted = [...members].sort((a, b) => a.localeCompare(b));
  const n = sorted.length;
  const radius = Math.max(80, 30 + 12 * n);
  const centerX = radius + PADDING;
  const centerY = radius + PADDING;
  for (let i = 0; i < n; i += 1) {
    const id = sorted[i];
    if (id === undefined) continue;
    const angle = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
    positions.set(id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  }
  return { positions, radius };
}

function forceDirectedLayout(
  members: readonly string[],
  intraEdges: readonly GraphEdge[]
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const sorted = [...members].sort((a, b) => a.localeCompare(b));
  const n = sorted.length;
  // Start from circular layout for a deterministic initial configuration.
  const { positions: initial, radius } = circularLayout(sorted);
  const width = 2 * radius + 2 * PADDING;
  const height = 2 * radius + 2 * PADDING;
  const area = width * height;
  const k = Math.sqrt(area / Math.max(1, n)) * 0.7;

  // Copy into mutable state.
  const xs = new Map<string, number>();
  const ys = new Map<string, number>();
  for (const id of sorted) {
    const p = initial.get(id);
    if (!p) continue;
    xs.set(id, p.x);
    ys.set(id, p.y);
  }

  // Build undirected adjacency from intra-SCC edges.
  const memberSet = new Set(sorted);
  const adj = new Map<string, Set<string>>();
  for (const id of sorted) adj.set(id, new Set());
  for (const e of intraEdges) {
    if (!memberSet.has(e.source) || !memberSet.has(e.target)) continue;
    if (e.source === e.target) continue;
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  let temperature = Math.min(width, height) / 4;
  const cooling = temperature / FORCE_ITERATIONS;

  for (let iter = 0; iter < FORCE_ITERATIONS; iter += 1) {
    const dispX = new Map<string, number>();
    const dispY = new Map<string, number>();
    for (const id of sorted) {
      dispX.set(id, 0);
      dispY.set(id, 0);
    }

    // Repulsion (O(n^2) — small SCCs only).
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i];
      if (a === undefined) continue;
      const ax = xs.get(a) ?? 0;
      const ay = ys.get(a) ?? 0;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j];
        if (b === undefined) continue;
        const bx = xs.get(b) ?? 0;
        const by = ys.get(b) ?? 0;
        const dx = ax - bx;
        const dy = ay - by;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        dispX.set(a, (dispX.get(a) ?? 0) + fx);
        dispY.set(a, (dispY.get(a) ?? 0) + fy);
        dispX.set(b, (dispX.get(b) ?? 0) - fx);
        dispY.set(b, (dispY.get(b) ?? 0) - fy);
      }
    }

    // Attraction (along edges).
    for (const [src, tgts] of adj) {
      for (const tgt of tgts) {
        if (tgt <= src) continue; // undirected, process once
        const ax = xs.get(src) ?? 0;
        const ay = ys.get(src) ?? 0;
        const bx = xs.get(tgt) ?? 0;
        const by = ys.get(tgt) ?? 0;
        const dx = ax - bx;
        const dy = ay - by;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (dist * dist) / k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        dispX.set(src, (dispX.get(src) ?? 0) - fx);
        dispY.set(src, (dispY.get(src) ?? 0) - fy);
        dispX.set(tgt, (dispX.get(tgt) ?? 0) + fx);
        dispY.set(tgt, (dispY.get(tgt) ?? 0) + fy);
      }
    }

    // Apply displacement (clamped by temperature).
    for (const id of sorted) {
      const dx = dispX.get(id) ?? 0;
      const dy = dispY.get(id) ?? 0;
      const mag = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const nx = (xs.get(id) ?? 0) + (dx / mag) * Math.min(mag, temperature);
      const ny = (ys.get(id) ?? 0) + (dy / mag) * Math.min(mag, temperature);
      // Keep members inside the bounding box (with PADDING slack).
      xs.set(id, Math.max(PADDING, Math.min(width - PADDING, nx)));
      ys.set(id, Math.max(PADDING, Math.min(height - PADDING, ny)));
    }
    temperature = Math.max(0.01, temperature - cooling);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const id of sorted) {
    positions.set(id, { x: xs.get(id) ?? 0, y: ys.get(id) ?? 0 });
  }
  return { positions, width, height };
}

/**
 * Compute internal positions for an SCC supernode's members.
 *
 * @param members   Ordered member ids (will be sorted internally for determinism).
 * @param intraEdges Edges whose both endpoints are members; used for force layout.
 * @param _parentId Supernode id (currently informational; could be used for caching).
 */
export function layoutSCCInternal(
  members: readonly string[],
  intraEdges: readonly GraphEdge[],
  _parentId: string
): SccLayoutResult {
  if (members.length === 0) {
    return {
      positions: new Map(),
      parentSize: { width: 2 * PADDING + NODE_RADIUS, height: 2 * PADDING + NODE_RADIUS },
    };
  }

  if (members.length < 10) {
    const { positions, radius } = circularLayout(members);
    const size = 2 * radius + 2 * PADDING;
    return {
      positions,
      parentSize: { width: size, height: size },
    };
  }

  const { positions, width, height } = forceDirectedLayout(members, intraEdges);
  return { positions, parentSize: { width, height } };
}
