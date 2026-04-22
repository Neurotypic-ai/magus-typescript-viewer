/**
 * Phase 2: per-edge side assignment.
 *
 * Given a set of positioned nodes, decides which cardinal side (top / right /
 * bottom / left) each edge attaches to at its source and at its target.
 * Edges are then stamped with the appropriate `MODULE_HANDLE_IDS.*` handle
 * IDs so Vue Flow renders them via the correct handle, and with
 * `data.edgeSide` / `data.edgeSourceSide` so downstream phases can read the
 * chosen sides without re-deriving them from handle strings.
 *
 * Two passes:
 *
 * 1. **Hub balancing pass.** Nodes whose combined (source + target) degree
 *    meets `hubThreshold` are treated as hubs. Their incident edges are
 *    partitioned across the four sides based on where the other endpoint
 *    sits geometrically, with a balance pass that redistributes overflow
 *    from dominant quadrants into neighbouring sides so a hub with 50
 *    incoming edges spreads them roughly evenly across four sides
 *    (~12 per side) rather than piling all 50 onto the left.
 *
 * 2. **Geometric pass.** Every edge not already pinned by a hub assignment
 *    picks its sides from `|dx|` vs `|dy|` — horizontal attachment when
 *    `|dx| >= |dy|`, vertical otherwise.
 *
 * The algorithm is deterministic: inputs are sorted by ID before iteration,
 * and ties in the quadrant-balance pass break by (degree, node id, edge id).
 */

import { MODULE_HANDLE_IDS } from '../handleRouting';

import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

export type HandleSide = 'top' | 'right' | 'bottom' | 'left';

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

/**
 * Collection of position lookups. Accepts either a Map<string, NodePosition>
 * (the shape produced by `computeSimpleHierarchicalLayout`) or a plain record
 * keyed by node id.
 */
export type NodePositionLookup = Map<string, NodePosition> | Readonly<Record<string, NodePosition>>;

interface AssignEdgeSidesOptions {
  /**
   * Combined degree (source + target) threshold at which a node is treated
   * as a hub for the balancing pass. Default 10 mirrors the plan's
   * recommendation. Nodes below this threshold use pure geometric routing.
   */
  hubThreshold?: number;
  /** Optional per-node size lookup. When provided, positions are treated as
   *  top-left corners (Vue Flow's convention) and we offset by half-size to
   *  compute the centre used for direction math. If omitted, positions are
   *  treated as node centres. Using the centre avoids artefacts when nodes
   *  of different widths sit in the same column. */
  sizes?: Map<string, NodeSize> | Readonly<Record<string, NodeSize>>;
}

type SideAssignment = {
  sourceSide: HandleSide;
  targetSide: HandleSide;
};

function readPosition(lookup: NodePositionLookup, id: string): NodePosition | undefined {
  if (lookup instanceof Map) {
    return lookup.get(id);
  }
  return lookup[id];
}

function readSize(
  lookup: Map<string, NodeSize> | Readonly<Record<string, NodeSize>> | undefined,
  id: string
): NodeSize | undefined {
  if (!lookup) return undefined;
  if (lookup instanceof Map) {
    return lookup.get(id);
  }
  return lookup[id];
}

function getCenter(
  id: string,
  positions: NodePositionLookup,
  sizes: Map<string, NodeSize> | Readonly<Record<string, NodeSize>> | undefined
): NodePosition | undefined {
  const pos = readPosition(positions, id);
  if (!pos) return undefined;
  const size = readSize(sizes, id);
  if (!size) return pos;
  return { x: pos.x + size.width * 0.5, y: pos.y + size.height * 0.5 };
}

/**
 * Given a vector from `from` to `to`, pick the dominant cardinal direction
 * (from the perspective of `from`): the side at `from` the vector exits via.
 * Ties go to the horizontal axis, matching Phase 2's tiebreak rule.
 */
export function dominantSide(dx: number, dy: number): HandleSide {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function opposite(side: HandleSide): HandleSide {
  switch (side) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'top':
      return 'bottom';
    case 'bottom':
    default:
      return 'top';
  }
}

/**
 * Map a (role, side) pair to the canonical module handle id.
 */
export function handleIdForSide(role: 'source' | 'target', side: HandleSide): string {
  if (role === 'source') {
    switch (side) {
      case 'top':
        return MODULE_HANDLE_IDS.topOut;
      case 'right':
        return MODULE_HANDLE_IDS.rightOut;
      case 'bottom':
        return MODULE_HANDLE_IDS.bottomOut;
      case 'left':
      default:
        return MODULE_HANDLE_IDS.leftOut;
    }
  }
  switch (side) {
    case 'top':
      return MODULE_HANDLE_IDS.topIn;
    case 'right':
      return MODULE_HANDLE_IDS.rightIn;
    case 'bottom':
      return MODULE_HANDLE_IDS.bottomIn;
    case 'left':
    default:
      return MODULE_HANDLE_IDS.leftIn;
  }
}

const SIDE_ORDER: readonly HandleSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * Balance `edges` across the four sides by taking the quadrant-natural side
 * as the starting point and then moving overflow from dominant sides to
 * under-used neighbours until the counts are as even as possible.
 *
 * Returns a Map from edge id to the chosen hub side.
 */
function balanceQuadrants(
  edges: { edgeId: string; natural: HandleSide }[]
): Map<string, HandleSide> {
  const assignment = new Map<string, HandleSide>();
  if (edges.length === 0) return assignment;

  const bySide = new Map<HandleSide, string[]>();
  for (const side of SIDE_ORDER) bySide.set(side, []);
  for (const edge of edges) {
    bySide.get(edge.natural)?.push(edge.edgeId);
  }

  // Redistribute overflow. Target: each side holds at most ceil(total / 4)
  // edges. Move excess from the most-loaded side to its perpendicular
  // neighbours (e.g., left overflow goes to top or bottom — which ever is
  // less loaded), preferring the less-loaded of the two.
  const target = Math.ceil(edges.length / SIDE_ORDER.length);

  const neighbours: Record<HandleSide, HandleSide[]> = {
    left: ['top', 'bottom'],
    right: ['top', 'bottom'],
    top: ['left', 'right'],
    bottom: ['left', 'right'],
  };

  // Sort side ids deterministically so repeated passes converge to a stable
  // ordering. We iterate until no side is over target (or we've done at most
  // 4 passes — each pass only moves within one side).
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const side of SIDE_ORDER) {
      const bucket = bySide.get(side);
      if (!bucket) continue;
      while (bucket.length > target) {
        const candidates = neighbours[side];
        const sortedCandidates = [...candidates].sort((a, b) => {
          const aLen = bySide.get(a)?.length ?? 0;
          const bLen = bySide.get(b)?.length ?? 0;
          if (aLen !== bLen) return aLen - bLen;
          return SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b);
        });
        const destination = sortedCandidates[0];
        if (destination === undefined) break;
        const destBucket = bySide.get(destination);
        if (!destBucket) break;
        if (destBucket.length >= target) break;
        const moving = bucket.pop();
        if (moving === undefined) break;
        destBucket.push(moving);
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (const side of SIDE_ORDER) {
    const bucket = bySide.get(side);
    if (!bucket) continue;
    for (const edgeId of bucket) {
      assignment.set(edgeId, side);
    }
  }

  return assignment;
}

/**
 * Phase 2 side-assignment. Returns a new array of edges with `sourceHandle`,
 * `targetHandle`, `data.edgeSide`, and `data.edgeSourceSide` populated.
 *
 * Edges whose endpoints are missing from the position lookup keep whatever
 * handle IDs they already carried (typical for cross-folder stubs, folder
 * trunks, and other pre-layout-pipeline edges that should not be remapped).
 */
export function assignEdgeSides(
  edges: readonly GraphEdge[],
  nodes: readonly DependencyNode[],
  positions: NodePositionLookup,
  hubThreshold = 10,
  options: AssignEdgeSidesOptions = {}
): GraphEdge[] {
  const effectiveThreshold = options.hubThreshold ?? hubThreshold;

  // Build degree map across the provided edges. Degree is combined
  // (in + out) since "hub" in Phase 2 is about total incident count.
  const degrees = new Map<string, number>();
  for (const node of nodes) {
    degrees.set(node.id, 0);
  }
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }

  // Identify hubs. Sort by (-degree, id) so the highest-degree hub is
  // processed first (its assignments are respected by later hubs).
  const hubs: { id: string; degree: number }[] = [];
  for (const [id, degree] of degrees) {
    if (degree >= effectiveThreshold) hubs.push({ id, degree });
  }
  hubs.sort((a, b) => {
    if (a.degree !== b.degree) return b.degree - a.degree;
    return a.id.localeCompare(b.id);
  });

  // Accumulator: per-edge side assignment (populated first by hubs, then by
  // the geometric pass).
  const sideAssignments = new Map<string, SideAssignment>();
  // Track which endpoint of an edge a hub has already pinned so a second
  // hub on the other endpoint cannot overwrite it.
  const pinnedAt = new Map<string, { source: boolean; target: boolean }>();

  const edgesByIncidence = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = edgesByIncidence.get(edge.source) ?? [];
    list.push(edge);
    edgesByIncidence.set(edge.source, list);
    if (edge.target !== edge.source) {
      const tlist = edgesByIncidence.get(edge.target) ?? [];
      tlist.push(edge);
      edgesByIncidence.set(edge.target, tlist);
    }
  }

  for (const hub of hubs) {
    const hubCenter = getCenter(hub.id, positions, options.sizes);
    if (!hubCenter) continue;
    const incident = (edgesByIncidence.get(hub.id) ?? [])
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    if (incident.length === 0) continue;

    const assignments: { edgeId: string; natural: HandleSide }[] = [];
    for (const edge of incident) {
      // Determine the "other" endpoint from the hub's perspective.
      const otherId = edge.source === hub.id ? edge.target : edge.source;
      const otherCenter = getCenter(otherId, positions, options.sizes);
      if (!otherCenter) continue;
      // Vector from hub → other. The hub's natural side is the dominant
      // direction of that vector.
      const dx = otherCenter.x - hubCenter.x;
      const dy = otherCenter.y - hubCenter.y;
      const natural = dominantSide(dx, dy);
      assignments.push({ edgeId: edge.id, natural });
    }

    const balanced = balanceQuadrants(assignments);
    for (const edge of incident) {
      const hubSide = balanced.get(edge.id);
      if (!hubSide) continue;

      const existing = sideAssignments.get(edge.id);
      const pin = pinnedAt.get(edge.id) ?? { source: false, target: false };

      if (edge.source === hub.id) {
        if (pin.source) continue; // already pinned by a stronger hub
        const sourceSide = hubSide;
        const targetSide = existing?.targetSide ?? opposite(hubSide);
        sideAssignments.set(edge.id, { sourceSide, targetSide });
        pin.source = true;
        pinnedAt.set(edge.id, pin);
      } else {
        if (pin.target) continue;
        const targetSide = hubSide;
        const sourceSide = existing?.sourceSide ?? opposite(hubSide);
        sideAssignments.set(edge.id, { sourceSide, targetSide });
        pin.target = true;
        pinnedAt.set(edge.id, pin);
      }
    }
  }

  // Geometric pass — fill in any edge (or edge endpoint) not pinned above.
  const result: GraphEdge[] = edges.map((edge) => {
    const sourceCenter = getCenter(edge.source, positions, options.sizes);
    const targetCenter = getCenter(edge.target, positions, options.sizes);
    if (!sourceCenter || !targetCenter) {
      // Endpoints missing from position lookup — leave handles untouched.
      return edge;
    }

    // Folder-level edges (crossFolder trunks, folder stubs, intra-folder
    // aggregates) carry their own dedicated handle ids — do not remap them
    // or Vue Flow will lose the folder-specific routing. The four-sided
    // handle scheme only applies to the module-level relational edges.
    const sourceHandleIsFolder = typeof edge.sourceHandle === 'string' && edge.sourceHandle.startsWith('folder-');
    const targetHandleIsFolder = typeof edge.targetHandle === 'string' && edge.targetHandle.startsWith('folder-');
    if (sourceHandleIsFolder || targetHandleIsFolder) {
      return edge;
    }

    const pin = pinnedAt.get(edge.id) ?? { source: false, target: false };
    const existing = sideAssignments.get(edge.id);

    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;
    const geometricSourceSide = dominantSide(dx, dy);
    const geometricTargetSide = opposite(geometricSourceSide);

    const sourceSide = pin.source ? (existing?.sourceSide ?? geometricSourceSide) : geometricSourceSide;
    const targetSide = pin.target ? (existing?.targetSide ?? geometricTargetSide) : geometricTargetSide;

    const sourceHandle = handleIdForSide('source', sourceSide);
    const targetHandle = handleIdForSide('target', targetSide);

    return {
      ...edge,
      sourceHandle,
      targetHandle,
      data: {
        ...edge.data,
        edgeSide: targetSide,
        edgeSourceSide: sourceSide,
      },
    } as GraphEdge;
  });

  return result;
}
