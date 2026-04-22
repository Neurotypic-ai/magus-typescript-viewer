/**
 * relocateInternalHubs — Phase 4 of the hub-aware layout plan.
 *
 * See `/Users/khallmark/.claude/plans/you-are-inside-a-snug-ocean.md`
 * §3.A (edge length pathologies), §4.2 (hub anchor abstraction),
 * §6 Phase 4, §8.3 (`placeHubAnchors`).
 *
 * Goal: for every internal module with combined degree ≥ threshold, pull the
 * hub's Y coordinate toward the centroid of its neighbours while keeping X
 * pinned to the node's existing layer column. This shortens edges between
 * high-degree modules and their top-of-chain consumers (Phase 1 solved the
 * analogous problem for externals; Phase 4 handles the internal hubs that
 * Phase 1 doesn't touch).
 *
 * Phase 4 layers on top of Phase 1:
 *   1. `computeSimpleHierarchicalLayout` produces layer-aligned positions.
 *   2. Phase 1's `layoutExternalBand` settles externals into the peripheral
 *      band. After this step, external neighbours have their final Y.
 *   3. Phase 4 (this module) computes per-layer Y bands from the settled
 *      internal positions, identifies degree-≥-threshold internal hubs, and
 *      asks `placeHubAnchors` (layer-band mode) to pull each hub's Y toward
 *      its neighbour centroid clamped to the band.
 *
 * Key design choices:
 *   - "Internal" membership = `data.layoutBand === 'internal'`. Phase 1
 *     tags this during `buildOverviewGraph`; externals and SCC supernodes
 *     are excluded.
 *   - Combined degree counts every edge touching the hub (both directions),
 *     matching `placeHubAnchors`'s own degree computation.
 *   - Layer bands exclude children (any node with `parentNode`) so that
 *     hubs contained in folders or SCC supernodes don't leak into the
 *     root-level bands.
 *   - The caller receives a fresh positions map — the input is not mutated.
 */

import { placeHubAnchors } from './placeHubAnchors';

import type { LayerBand, Positions } from './placeHubAnchors';
import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

/** Default hub detection threshold (plan §6 Phase 4 — "degree ≥ 10"). */
export const DEFAULT_INTERNAL_HUB_THRESHOLD = 10;

/** Compute per-layer Y bands from the currently-placed root-level nodes.
 *
 * Plan §6 Phase 4: "internal modules with high degree (hubs) get pulled
 * toward the Y-centroid of their neighbours *within their assigned layer
 * column*." The Y-band is the min/max Y of the nodes already placed in that
 * layer — narrow enough that the hub's relocated Y stays in the same visual
 * row, wide enough to admit centroid-driven movement within the row.
 *
 * Children (`parentNode` set) are excluded: they live in relative coords
 * under their parent and do not define the root-level Y extent. SCC member
 * nodes fall under this rule automatically (parented to supernodes).
 */
export function computeLayerBands(
  nodes: DependencyNode[],
  positions: Positions
): Map<number, LayerBand> {
  const bands = new Map<number, { yMin: number; yMax: number }>();
  for (const node of nodes) {
    if (node.parentNode) continue;
    const layerIndex = node.data?.layerIndex;
    if (typeof layerIndex !== 'number') continue;
    const pos = positions.get(node.id);
    if (!pos) continue;
    const existing = bands.get(layerIndex);
    if (existing === undefined) {
      bands.set(layerIndex, { yMin: pos.y, yMax: pos.y });
    } else {
      if (pos.y < existing.yMin) existing.yMin = pos.y;
      if (pos.y > existing.yMax) existing.yMax = pos.y;
    }
  }
  return bands;
}

/** Count incident edges at a single node (treating every edge as +1 per endpoint). */
function combinedDegree(nodeId: string, edges: GraphEdge[]): number {
  let degree = 0;
  for (const edge of edges) {
    if (edge.source === nodeId) degree += 1;
    if (edge.target === nodeId) degree += 1;
  }
  return degree;
}

/**
 * Pull high-degree internal hubs toward the Y-centroid of their neighbours.
 *
 * Threshold defaults to `DEFAULT_INTERNAL_HUB_THRESHOLD` (10) — the plan's
 * §6 Phase 4 recommendation. Tests and callers may lower it to exercise the
 * code with small synthetic graphs.
 *
 * Returns a new positions map; the input is not mutated. Non-hub positions
 * and hubs without enough positioned neighbours retain their existing values.
 */
export function relocateInternalHubs(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  positions: Positions,
  threshold: number = DEFAULT_INTERNAL_HUB_THRESHOLD
): Positions {
  // Identify internal hubs: nodes Phase 1 tagged as 'internal' whose combined
  // degree (over the full edge set passed in) meets the threshold. We do not
  // require the degree to come from layering-kind edges specifically — the
  // visual congestion pathology applies to any edge the user actually sees.
  const hubs: DependencyNode[] = [];
  for (const node of nodes) {
    if (node.data?.layoutBand !== 'internal') continue;
    // Children live in relative coordinates; Phase 4 is about the root-level
    // column where Sugiyama places the internal backbone.
    if (node.parentNode) continue;
    const degree = combinedDegree(node.id, edges);
    if (degree >= threshold) {
      hubs.push(node);
    }
  }

  if (hubs.length === 0) {
    // No hubs to relocate: return the original map unchanged (but still a new
    // Map, matching placeHubAnchors's contract of never mutating the input).
    return new Map(positions);
  }

  const layerBands = computeLayerBands(nodes, positions);
  return placeHubAnchors(hubs, edges, positions, {
    mode: 'layer-band',
    layerBands,
  });
}
