/**
 * placeHubAnchors — the unified hub-placement abstraction shared by Phase 1
 * (external band, unconstrained) and Phase 4 (internal hub relocation,
 * layer-constrained).
 *
 * See plan §4.2 and §8.3. The core idea: a hub's ideal rendered position is
 * the weighted centroid of its neighbours' positions. The only difference
 * between the two populations is the constraint regime — externals have
 * free X and Y; internal hubs must stay in their layer's X band and are only
 * free to move within the layer's Y extents.
 *
 * Phase 1 only exercises the `unconstrained` mode. The `layer-band` mode is
 * implemented here so that Phase 4 can call the same function without having
 * to add a constraint branch.
 *
 * Collision resolution: after all hubs are placed, a single-pass sweep checks
 * whether any two hubs share ≈ the same pixel neighborhood and separates them
 * vertically. This is intentionally simple — the plan notes that hub collisions
 * are rare enough that a more sophisticated energy minimisation is not yet
 * warranted.
 */

import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

/** Pixel tolerance below which two hubs are considered to collide. */
const COLLISION_TOLERANCE_PX = 40;

/** Vertical separation applied when resolving a collision. */
const COLLISION_SEPARATION_PX = 60;

export interface LayerBand {
  /** Inclusive min Y for the layer. */
  yMin: number;
  /** Inclusive max Y for the layer. */
  yMax: number;
}

export type HubAnchorConstraint =
  | { mode: 'unconstrained' }
  | {
      mode: 'layer-band';
      /** Map from layerIndex to its Y extents. */
      layerBands: Map<number, LayerBand>;
    };

export interface HubAnchorOptions {
  /**
   * Tie-breakers for collision resolution and neighbour weighting can be
   * added here in future.  Kept as an options struct so the public shape is
   * stable across Phase 1/4/5.
   */
  collisionTolerance?: number;
  collisionSeparation?: number;
}

/** Result mirrors the input positions map; new Map is returned, input is not mutated. */
export type Positions = Map<string, { x: number; y: number }>;

function weightedMean(values: { value: number; weight: number }[]): number | null {
  let sum = 0;
  let totalWeight = 0;
  for (const { value, weight } of values) {
    sum += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? sum / totalWeight : null;
}

function getNeighbourIds(hubId: string, edges: GraphEdge[]): string[] {
  const neighbours: string[] = [];
  for (const edge of edges) {
    if (edge.source === hubId && edge.target !== hubId) {
      neighbours.push(edge.target);
    } else if (edge.target === hubId && edge.source !== hubId) {
      neighbours.push(edge.source);
    }
  }
  return neighbours;
}

function getDegree(hubId: string, edges: GraphEdge[]): number {
  let degree = 0;
  for (const edge of edges) {
    if (edge.source === hubId) degree += 1;
    if (edge.target === hubId) degree += 1;
  }
  return degree;
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return value; // degenerate band; return unclamped
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Place hubs at the weighted centroid of their neighbours.
 *
 * `hubs` are processed in descending-degree order so that the strongest
 * pressure "wins" on collisions — higher-degree hubs anchor first, and
 * lower-degree hubs are then pushed away to avoid stacking on top of them.
 *
 * Returns a new positions Map containing the input positions plus overrides
 * for every hub for which neighbour positions were available.  Hubs with no
 * positioned neighbours keep whatever position they had in the input map
 * (or are omitted entirely, in which case the caller will fall back to the
 * band/grid defaults).
 */
export function placeHubAnchors(
  hubs: DependencyNode[],
  edges: GraphEdge[],
  positions: Positions,
  constraint: HubAnchorConstraint,
  options: HubAnchorOptions = {}
): Positions {
  const tolerance = options.collisionTolerance ?? COLLISION_TOLERANCE_PX;
  const separation = options.collisionSeparation ?? COLLISION_SEPARATION_PX;

  // Copy the input map so we never mutate the caller's state.
  const next: Positions = new Map(positions);

  // Sort hubs by degree (desc) so the most-constrained placements happen
  // first; ties broken by id for determinism.
  const byDegreeDesc = [...hubs].sort((a, b) => {
    const da = getDegree(a.id, edges);
    const db = getDegree(b.id, edges);
    if (da !== db) return db - da;
    return a.id.localeCompare(b.id);
  });

  for (const hub of byDegreeDesc) {
    const neighbourIds = getNeighbourIds(hub.id, edges);

    // Weight = 1 per edge (dedup happens implicitly if there are multi-edges;
    // we intentionally count parallel edges as extra weight since they
    // represent stronger coupling).
    const xSamples: { value: number; weight: number }[] = [];
    const ySamples: { value: number; weight: number }[] = [];
    for (const neighbourId of neighbourIds) {
      const pos = next.get(neighbourId);
      if (!pos) continue;
      xSamples.push({ value: pos.x, weight: 1 });
      ySamples.push({ value: pos.y, weight: 1 });
    }

    const meanY = weightedMean(ySamples);
    let targetX: number;
    let targetY: number;

    if (constraint.mode === 'layer-band') {
      // Layer-constrained mode (Phase 4): X is pinned to the hub's layer
      // column, Y is the centroid clamped to the layer's band.
      const existing = next.get(hub.id);
      targetX = existing?.x ?? 0;
      const layerIndex = typeof hub.data?.layerIndex === 'number' ? hub.data.layerIndex : 0;
      const band = constraint.layerBands.get(layerIndex);
      if (meanY === null) {
        targetY = existing?.y ?? band?.yMin ?? 0;
      } else {
        targetY = band ? clamp(meanY, band.yMin, band.yMax) : meanY;
      }
    } else {
      // Unconstrained mode (Phase 1): free X and Y at the centroid.
      const meanX = weightedMean(xSamples);
      const existing = next.get(hub.id);
      targetX = meanX ?? existing?.x ?? 0;
      targetY = meanY ?? existing?.y ?? 0;
    }

    next.set(hub.id, { x: targetX, y: targetY });
  }

  // One-pass collision resolution. Hubs sorted by (x, y) so adjacent pairs
  // in the sorted order are spatially close — which is where real collisions
  // cluster. O(n log n).
  const hubIdList = byDegreeDesc.map((h) => h.id);
  const placed = hubIdList
    .map((id) => ({ id, pos: next.get(id) }))
    .filter((entry): entry is { id: string; pos: { x: number; y: number } } => entry.pos !== undefined)
    .sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y || a.id.localeCompare(b.id));

  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1];
    const cur = placed[i];
    if (!prev || !cur) continue;
    const dx = Math.abs(cur.pos.x - prev.pos.x);
    const dy = Math.abs(cur.pos.y - prev.pos.y);
    if (dx < tolerance && dy < tolerance) {
      // Push the current hub down by `separation`.
      const pushedY = cur.pos.y + separation;
      const updated: { x: number; y: number } = { x: cur.pos.x, y: pushedY };
      cur.pos = updated;
      next.set(cur.id, updated);
    }
  }

  return next;
}
