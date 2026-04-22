/**
 * layoutExternalBand — place external-package nodes in a peripheral band
 * below the internal graph (plan §8.2, Phase 1).
 *
 * The algorithm:
 *   1. For each external, compute the consumer centroid X from the already
 *      positioned internal nodes (we pass in the Sugiyama output).  If there
 *      are no visible consumers the external is stacked alphabetically at
 *      the band's left edge.
 *   2. Assign each external to one of three tiers by consumer count.  Tier 0
 *      is the top of the band (nearest to the internal graph); higher tiers
 *      drift toward the bottom rail.  Using quintiles as described in the
 *      plan would be over-specified for three buckets — we use the
 *      tercile-thirds of the sorted-degree list instead.
 *   3. Refine the tier-0/1/2 X positions by calling `placeHubAnchors` in
 *      unconstrained mode, then clamp X back into the band rectangle and
 *      re-assert the tier Y.
 *   4. Collision resolution: inside each tier, if two externals end up
 *      within one node-width of each other, separate them horizontally.
 *
 * Design decisions documented in code comments where the plan left open
 * questions (§10):
 *   - Band orientation: bottom (below internal graph)
 *   - Tier count: 3
 *   - Hub threshold: externals are always hubs (no per-external degree gate)
 *   - Band gap from internal graph: 240px
 *   - Tier height: 320px (node height + gap)
 */

import { placeHubAnchors } from './placeHubAnchors';

import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

/** Rectangular band below (or alongside) the internal graph. */
export interface BandRect {
  /** Left edge X — externals won't be placed to the left of this. */
  left: number;
  /** Right edge X — externals won't be placed to the right of this. */
  right: number;
  /** Top Y of the first (closest-to-internal) tier. */
  top: number;
  /** Total height of all tiers. */
  height: number;
}

export interface ExternalBandOptions {
  /** Default width of an external node — used for horizontal collision resolution. */
  nodeWidth?: number;
  /** Distance between tier centers. */
  tierHeight?: number;
  /** Number of tiers. Plan §10 fixes this to 3 for Phase 1. */
  tierCount?: number;
}

const DEFAULT_EXTERNAL_NODE_WIDTH = 220;
const DEFAULT_TIER_HEIGHT = 320;
const DEFAULT_TIER_COUNT = 3;

export type Positions = Map<string, { x: number; y: number }>;

function countConsumers(externalId: string, edges: GraphEdge[]): number {
  let count = 0;
  for (const edge of edges) {
    if (edge.target === externalId) count += 1;
  }
  return count;
}

/**
 * Assign each external to a tier by degree, using degree quantiles so that
 * externals with the same degree always land in the same tier.
 *
 * Tier 0 is the highest-degree third (closest to the internal area).
 * Tier 2 is the lowest-degree third.
 *
 * With fewer externals than tiers, the highest-degree externals cluster at
 * tier 0 and the remaining tiers stay empty — which is the intuitive
 * behaviour for sparse external sets.
 */
function assignTiers(externals: DependencyNode[], edges: GraphEdge[], tierCount: number): Map<string, number> {
  if (externals.length === 0) return new Map();
  const degrees = externals.map((n) => ({ id: n.id, deg: countConsumers(n.id, edges) }));
  degrees.sort((a, b) => b.deg - a.deg || a.id.localeCompare(b.id));

  // Unique degree values (descending). Map each degree value to a tier index
  // proportional to its position in the unique-degree sequence.
  const uniqueDegreesDesc = [...new Set(degrees.map((d) => d.deg))];
  const tiers = new Map<string, number>();
  const uniqueCount = uniqueDegreesDesc.length;
  if (uniqueCount === 0) return tiers;

  const degreeToTier = new Map<number, number>();
  if (uniqueCount === 1) {
    const onlyDegree = uniqueDegreesDesc[0];
    if (onlyDegree !== undefined) degreeToTier.set(onlyDegree, 0);
  } else {
    uniqueDegreesDesc.forEach((deg, index) => {
      // Map the uniqueDegreesDesc index (0 = highest deg, uniqueCount-1 = lowest deg)
      // into [0, tierCount - 1] proportionally.
      const ratio = index / (uniqueCount - 1);
      const tier = Math.min(tierCount - 1, Math.round(ratio * (tierCount - 1)));
      degreeToTier.set(deg, tier);
    });
  }

  for (const { id, deg } of degrees) {
    tiers.set(id, degreeToTier.get(deg) ?? tierCount - 1);
  }
  return tiers;
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return value;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Compute positions for external-package nodes.
 *
 * `internalPositions` is the positions map from
 * `computeSimpleHierarchicalLayout` — it must be supplied because consumer
 * centroids can only be computed from already-positioned internal nodes.
 *
 * Returns a fresh map keyed by external id. The caller merges these with
 * the internal positions before writing to Vue Flow.
 */
export function layoutExternalBand(
  externals: DependencyNode[],
  externalEdges: GraphEdge[],
  internalPositions: Positions,
  bandRect: BandRect,
  options: ExternalBandOptions = {}
): Positions {
  if (externals.length === 0) return new Map();

  const nodeWidth = options.nodeWidth ?? DEFAULT_EXTERNAL_NODE_WIDTH;
  const tierHeight = options.tierHeight ?? DEFAULT_TIER_HEIGHT;
  const tierCount = options.tierCount ?? DEFAULT_TIER_COUNT;

  // Track which externals have *any* consumer that appears in the internal
  // position map.  Externals whose consumers are all filtered out fall back
  // to the alphabetical stack described in the plan.
  const externalIds = new Set(externals.map((n) => n.id));
  const consumersByExternal = new Map<string, string[]>();
  for (const ext of externals) consumersByExternal.set(ext.id, []);
  for (const edge of externalEdges) {
    // For module → external edges the external is the target. We also accept
    // the reverse direction to be safe, since future phases may introduce
    // external-to-internal edges (Phase 5 / SCCs).
    if (externalIds.has(edge.target) && !externalIds.has(edge.source)) {
      consumersByExternal.get(edge.target)?.push(edge.source);
    } else if (externalIds.has(edge.source) && !externalIds.has(edge.target)) {
      consumersByExternal.get(edge.source)?.push(edge.target);
    }
  }

  const tiers = assignTiers(externals, externalEdges, tierCount);

  // Fallback stacking order: alphabetical, placed at the band left.
  const fallbackSorted = [...externals].sort((a, b) => a.id.localeCompare(b.id));

  // Starting positions: centroid X (or fallback) + assigned tier Y.
  const seed: Positions = new Map();
  let stackIndex = 0;
  for (const ext of fallbackSorted) {
    const tier = tiers.get(ext.id) ?? 0;
    const tierY = bandRect.top + tier * tierHeight;
    const consumers = consumersByExternal.get(ext.id) ?? [];
    const visibleConsumerPositions = consumers
      .map((id) => internalPositions.get(id))
      .filter((p): p is { x: number; y: number } => p !== undefined);

    if (visibleConsumerPositions.length === 0) {
      // No visible consumers → stack alphabetically at bandRect.left.
      const x = bandRect.left + stackIndex * nodeWidth;
      seed.set(ext.id, { x, y: tierY });
      stackIndex += 1;
    } else {
      const mean =
        visibleConsumerPositions.reduce((sum, p) => sum + p.x, 0) / visibleConsumerPositions.length;
      const x = clamp(mean, bandRect.left, bandRect.right);
      seed.set(ext.id, { x, y: tierY });
    }
  }

  // Refine using the shared hub-anchor abstraction.  We feed it a positions
  // map that contains both internal positions and the seed external
  // positions so that the centroid computation has the right data to pull
  // externals toward their consumers.
  const combined: Positions = new Map(internalPositions);
  for (const [id, pos] of seed) combined.set(id, pos);

  const refined = placeHubAnchors(externals, externalEdges, combined, { mode: 'unconstrained' });

  // Re-clamp X back into the band and re-assert the tier Y.  Hub-anchor
  // refinement in unconstrained mode would otherwise move externals off the
  // band vertically (since the centroid Y of consumers is above the band).
  const result: Positions = new Map();
  for (const ext of externals) {
    const refinedPos = refined.get(ext.id);
    const seeded = seed.get(ext.id);
    if (!seeded) continue;
    const rawX = refinedPos?.x ?? seeded.x;
    const x = clamp(rawX, bandRect.left, bandRect.right);
    result.set(ext.id, { x, y: seeded.y });
  }

  // Within-tier collision resolution: if two externals in the same tier are
  // within one nodeWidth of each other, push the rightmost one further
  // right.  This is O(n log n) per tier, n = externals in tier.
  const byTier = new Map<number, string[]>();
  for (const [id] of result) {
    const tier = tiers.get(id) ?? 0;
    const list = byTier.get(tier) ?? [];
    list.push(id);
    byTier.set(tier, list);
  }

  for (const ids of byTier.values()) {
    ids.sort((a, b) => {
      const ax = result.get(a)?.x ?? 0;
      const bx = result.get(b)?.x ?? 0;
      return ax - bx || a.localeCompare(b);
    });
    for (let i = 1; i < ids.length; i++) {
      const prevId = ids[i - 1];
      const curId = ids[i];
      if (!prevId || !curId) continue;
      const prevPos = result.get(prevId);
      const curPos = result.get(curId);
      if (!prevPos || !curPos) continue;
      const minNextX = prevPos.x + nodeWidth;
      if (curPos.x < minNextX) {
        result.set(curId, { x: minNextX, y: curPos.y });
      }
    }
  }

  return result;
}
