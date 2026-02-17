/**
 * Deterministic hierarchical collision resolver with directional repulsion.
 *
 * Operates on a mutable position map (parent-relative coordinates) to:
 *   1. Detect sibling overlaps within each scope
 *   2. Repel overlapping nodes AWAY from anchored (dragged/changed) nodes
 *   3. Push along the axis of minimum overlap for natural-feeling separation
 *   4. Grow parent containers to maintain margin around children
 *   5. Propagate growth up the ancestor chain so group nodes push each other
 *
 * Key difference from a layout-time forward sweep: the user-controlled
 * (anchored) nodes are immovable and all other overlapping siblings are
 * pushed *away* from them in the direction of least penetration.
 *
 * All functions are pure and deterministic for straightforward unit testing.
 */

import type { BoundsNode } from './geometryBounds';
import { GROUP_EXCLUSION_ZONE_PX } from './edgeGeometryPolicy';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CollisionConfig {
  /** Minimum gap between sibling bounding boxes (px). */
  overlapGap: number;
  /** Maximum settle iterations per resolve call. */
  maxCycles: number;
  /** Maximum total displacement per node per cycle (px). 0 = unlimited. */
  maxDisplacementPerCycle: number;
  /** Container padding for modules. */
  modulePadding: { horizontal: number; top: number; bottom: number };
  /** Container padding for groups. */
  groupPadding: { horizontal: number; top: number; bottom: number };
}

export const DEFAULT_COLLISION_CONFIG: CollisionConfig = {
  overlapGap: 40,
  maxCycles: 20,
  maxDisplacementPerCycle: 0, // unlimited — bounded by cycle count
  modulePadding: { horizontal: 20, top: 42, bottom: 20 },
  groupPadding: {
    horizontal: GROUP_EXCLUSION_ZONE_PX,
    top: GROUP_EXCLUSION_ZONE_PX,
    bottom: GROUP_EXCLUSION_ZONE_PX,
  },
};

/** Option key used in strategy options for minimum node distance (px). */
export const COLLISION_MINIMUM_DISTANCE_OPTION_KEY = 'minimumDistancePx';

/**
 * Create a CollisionConfig from a minimum distance value.
 * Sets overlapGap and groupPadding from minimumDistancePx while preserving
 * modulePadding, maxCycles, maxDisplacementPerCycle and other defaults.
 */
export function createCollisionConfig(minimumDistancePx: number): CollisionConfig {
  const d = Math.max(0, minimumDistancePx);
  return {
    ...DEFAULT_COLLISION_CONFIG,
    overlapGap: d,
    groupPadding: {
      horizontal: d,
      top: d,
      bottom: d,
    },
  };
}

/**
 * Strategy options map: strategyId -> { optionKey -> value }.
 * Kept generic to avoid circular deps on RenderingStrategy types.
 */
export type StrategyOptionsById = Record<string, Record<string, unknown>>;

/**
 * Resolve the active CollisionConfig for the given rendering strategy.
 * Reads minimumDistancePx from strategy options; falls back to default when absent or invalid.
 */
export function getActiveCollisionConfig(
  renderingStrategyId: string,
  strategyOptionsById: StrategyOptionsById
): CollisionConfig {
  const options = strategyOptionsById[renderingStrategyId];
  if (!options || typeof options !== 'object') {
    return DEFAULT_COLLISION_CONFIG;
  }
  const value = options[COLLISION_MINIMUM_DISTANCE_OPTION_KEY];
  const num = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (num == null || num < 0) {
    return DEFAULT_COLLISION_CONFIG;
  }
  return createCollisionConfig(num);
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Mutable bounding box used during resolution. */
interface MutableBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Result of a single resolve() call. */
export interface CollisionResult {
  /** Map of node ID -> updated position (parent-relative). */
  updatedPositions: Map<string, { x: number; y: number }>;
  /** Map of container ID -> updated size. */
  updatedSizes: Map<string, { width: number; height: number }>;
  /** Number of settle cycles used. */
  cyclesUsed: number;
  /** Whether the resolver converged within the cycle budget. */
  converged: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getContainerPadding(
  nodeType: string | undefined,
  config: CollisionConfig
): { horizontal: number; top: number; bottom: number } {
  return nodeType === 'group' ? config.groupPadding : config.modulePadding;
}

/**
 * Build a depth map for parent IDs. Depth 0 = leaf parent (no grandchildren).
 * Higher depth = further from leaves. Used for bottom-up processing order.
 */
function computeParentDepths(childIdsByParent: Map<string, string[]>): Map<string, number> {
  const depths = new Map<string, number>();

  function resolveDepth(parentId: string): number {
    const cached = depths.get(parentId);
    if (cached !== undefined) return cached;

    const children = childIdsByParent.get(parentId);
    if (!children || children.length === 0) {
      depths.set(parentId, 0);
      return 0;
    }

    let maxChildDepth = 0;
    for (const childId of children) {
      if (childIdsByParent.has(childId)) {
        maxChildDepth = Math.max(maxChildDepth, resolveDepth(childId) + 1);
      }
    }
    depths.set(parentId, maxChildDepth);
    return maxChildDepth;
  }

  for (const parentId of childIdsByParent.keys()) {
    resolveDepth(parentId);
  }
  return depths;
}

/**
 * Check if two boxes overlap considering a gap.
 */
function boxesOverlap(a: MutableBox, b: MutableBox, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/**
 * Compute the separation vector to push `movable` away from `anchor`.
 * Finds the axis of minimum overlap and pushes in the direction that
 * moves `movable` away from `anchor`'s center.
 *
 * Returns { dx, dy } where exactly one axis is non-zero.
 */
function computeRepulsionVector(
  anchor: MutableBox,
  movable: MutableBox,
  gap: number,
  maxDisplacement: number
): { dx: number; dy: number } {
  // Center of each box
  const anchorCx = anchor.x + anchor.width / 2;
  const anchorCy = anchor.y + anchor.height / 2;
  const movableCx = movable.x + movable.width / 2;
  const movableCy = movable.y + movable.height / 2;

  // Compute how far we'd need to push on each axis to clear the overlap + gap
  // Push right: movable.x needs to be >= anchor.x + anchor.width + gap
  const pushRight = anchor.x + anchor.width + gap - movable.x;
  // Push left: movable.x + movable.width + gap needs to be <= anchor.x
  const pushLeft = movable.x + movable.width + gap - anchor.x;
  // Push down: movable.y needs to be >= anchor.y + anchor.height + gap
  const pushDown = anchor.y + anchor.height + gap - movable.y;
  // Push up: movable.y + movable.height + gap needs to be <= anchor.y
  const pushUp = movable.y + movable.height + gap - anchor.y;

  // For each axis, pick the direction that's "away" from the anchor center
  const xDirection = movableCx >= anchorCx ? 'right' : 'left';
  const yDirection = movableCy >= anchorCy ? 'down' : 'up';

  const xCost = xDirection === 'right' ? pushRight : pushLeft;
  const yCost = yDirection === 'down' ? pushDown : pushUp;

  // Pick axis of minimum cost (minimum displacement needed)
  let dx = 0;
  let dy = 0;

  if (xCost <= yCost) {
    dx = xDirection === 'right' ? xCost : -xCost;
  } else {
    dy = yDirection === 'down' ? yCost : -yCost;
  }

  // Clamp to max displacement if configured
  if (maxDisplacement > 0) {
    if (Math.abs(dx) > maxDisplacement) dx = Math.sign(dx) * maxDisplacement;
    if (Math.abs(dy) > maxDisplacement) dy = Math.sign(dy) * maxDisplacement;
  }

  return { dx, dy };
}

// ---------------------------------------------------------------------------
// Core resolve entry point
// ---------------------------------------------------------------------------

/**
 * Resolve collisions across the entire node tree using directional repulsion.
 *
 * @param nodes - Complete list of nodes (used for hierarchy and type info).
 * @param positionMap - Mutable map of nodeId -> { x, y, width, height }
 *   in **parent-relative** coordinates. Modified in place; the returned
 *   `updatedPositions` / `updatedSizes` describe what changed.
 * @param anchoredNodeIds - Optional set of node IDs that are immovable
 *   (e.g. being actively dragged by the user). When provided, these
 *   nodes will not be pushed — only their overlapping neighbors move.
 *   Also determines which sibling scopes to resolve (scoped resolution).
 *   When null/undefined, full resolution across all scopes is performed
 *   with no anchored nodes (all nodes movable, forward sweep fallback).
 * @param config - Tuning knobs.
 * @param hardAnchoredNodeIds - Nodes that must never receive position updates
 *   from this resolver (e.g. currently dragged nodes).
 */
export function resolveCollisions(
  nodes: BoundsNode[],
  positionMap: Map<string, MutableBox>,
  anchoredNodeIds: Set<string> | null | undefined,
  config: CollisionConfig = DEFAULT_COLLISION_CONFIG,
  hardAnchoredNodeIds: Set<string> | null | undefined = null
): CollisionResult {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const anchored = anchoredNodeIds ?? new Set<string>();
  const hardAnchored = hardAnchoredNodeIds ?? new Set<string>();

  // ---- Build hierarchy helpers ----
  const childIdsByParent = new Map<string, string[]>();
  const siblingsByParent = new Map<string, string[]>();

  for (const node of nodes) {
    const parentId = node.parentNode ?? '__root__';
    {
      const arr = childIdsByParent.get(parentId);
      if (arr) arr.push(node.id);
      else childIdsByParent.set(parentId, [node.id]);
    }
    {
      const arr = siblingsByParent.get(parentId);
      if (arr) arr.push(node.id);
      else siblingsByParent.set(parentId, [node.id]);
    }
  }

  const parentDepths = computeParentDepths(childIdsByParent);

  // Sort parents ascending by depth: leaf parents first, grandparents later.
  const sortedParentIds = [...childIdsByParent.keys()]
    .filter((id) => id !== '__root__')
    .sort((a, b) => (parentDepths.get(a) ?? 0) - (parentDepths.get(b) ?? 0));

  // Determine which sibling scopes to resolve.
  const affectedScopes = new Set<string>();
  if (anchored.size > 0) {
    for (const nodeId of anchored) {
      const node = nodeById.get(nodeId);
      affectedScopes.add(node?.parentNode ?? '__root__');
    }
    // Also propagate to ancestor scopes — a pushed parent may collide with its siblings.
    const parentSet = new Set(affectedScopes);
    for (const scopeId of parentSet) {
      if (scopeId === '__root__') continue;
      const ancestor = nodeById.get(scopeId);
      affectedScopes.add(ancestor?.parentNode ?? '__root__');
    }
  } else {
    // Full resolve — all scopes.
    for (const parentId of siblingsByParent.keys()) {
      affectedScopes.add(parentId);
    }
  }

  // Snapshot original positions for diff at the end.
  const originalPositions = new Map<string, { x: number; y: number }>();
  const originalSizes = new Map<string, { width: number; height: number }>();
  for (const [id, box] of positionMap) {
    originalPositions.set(id, { x: box.x, y: box.y });
    originalSizes.set(id, { width: box.width, height: box.height });
  }

  // Track which nodes were displaced in the current cycle so we can
  // cascade: nodes pushed by the resolver become "soft anchors" that
  // push further neighbors in subsequent cycles.
  const displacedThisResolve = new Set<string>();

  // ---- Phase functions ----

  function enforceMinPositions(): void {
    for (const [parentId, childIds] of childIdsByParent) {
      if (parentId === '__root__') continue;
      const parentNode = nodeById.get(parentId);
      const parentBox = positionMap.get(parentId);
      if (!parentBox) continue;
      const layoutInsets = (parentNode as { data?: { layoutInsets?: { top?: number } } }).data?.layoutInsets;
      const nodeType = (parentNode as { type?: string }).type;
      const resolvedPadding = getContainerPadding(nodeType, config);

      const layoutTop = typeof layoutInsets?.top === 'number' && layoutInsets.top > 0 ? layoutInsets.top : 0;
      const containerTopPadding = Math.max(layoutTop, resolvedPadding.top);
      const minX = resolvedPadding.horizontal;
      const minY = containerTopPadding;

      for (const childId of childIds) {
        // Dragged nodes are hard anchors. Never clamp them, otherwise users
        // experience rubber-banding while interacting.
        if (anchored.has(childId)) continue;

        const box = positionMap.get(childId);
        if (!box) continue;
        const maxX = Math.max(minX, parentBox.width - resolvedPadding.horizontal - box.width);
        const maxY = Math.max(minY, parentBox.height - resolvedPadding.bottom - box.height);

        if (box.x < minX) box.x = minX;
        if (box.y < minY) box.y = minY;
        if (box.x > maxX) box.x = maxX;
        if (box.y > maxY) box.y = maxY;
      }
    }
  }

  function expandParentsBottomUp(): void {
    for (const parentId of sortedParentIds) {
      const childIds = childIdsByParent.get(parentId);
      if (!childIds) continue;

      const parentBox = positionMap.get(parentId);
      if (!parentBox) continue;

      const childBoxes = childIds.map((id) => positionMap.get(id)).filter((box): box is MutableBox => Boolean(box));

      if (childBoxes.length === 0) continue;

      const parentNode = nodeById.get(parentId);
      const nodeType = (parentNode as { type?: string }).type;
      const padding = getContainerPadding(nodeType, config);
      const layoutInsets = (parentNode as { data?: { layoutInsets?: { top?: number } } }).data?.layoutInsets;
      const layoutTop = typeof layoutInsets?.top === 'number' && layoutInsets.top > 0 ? layoutInsets.top : 0;
      const containerTopPadding = Math.max(layoutTop, padding.top);
      const hasHardAnchoredChild = childIds.some((id) => hardAnchored.has(id));
      const hasAnchoredChild = childIds.some((id) => anchored.has(id));

      /**
       * Group containers must be able to grow to top/left (not only right/bottom).
       * We re-anchor children to the configured inset and compensate parent origin
       * so children keep their absolute coordinates.
       *
       * For live-dragged children (hard anchors), skip origin shifts to avoid
       * drag jitter/snap while the user is interacting.
       */
      if (nodeType === 'group' && !hasHardAnchoredChild) {
        const minLeft = Math.min(...childBoxes.map((box) => box.x));
        const minTop = Math.min(...childBoxes.map((box) => box.y));
        const shouldExpandLeft = minLeft < padding.horizontal;
        const shouldExpandTop = minTop < containerTopPadding;
        const shouldCollapseLeft = !hasAnchoredChild && minLeft > padding.horizontal;
        const shouldCollapseTop = !hasAnchoredChild && minTop > containerTopPadding;
        const shiftX = shouldExpandLeft || shouldCollapseLeft ? minLeft - padding.horizontal : 0;
        const shiftY = shouldExpandTop || shouldCollapseTop ? minTop - containerTopPadding : 0;

        if (Math.abs(shiftX) > 0.01 || Math.abs(shiftY) > 0.01) {
          parentBox.x += shiftX;
          parentBox.y += shiftY;
          for (const childBox of childBoxes) {
            childBox.x -= shiftX;
            childBox.y -= shiftY;
          }
        }
      }

      const maxRight = Math.max(...childBoxes.map((box) => box.x + box.width));
      const maxBottom = Math.max(...childBoxes.map((box) => box.y + box.height));
      const targetWidth = maxRight + padding.horizontal;
      const targetHeight = maxBottom + padding.bottom;

      if (nodeType === 'group' && !hasHardAnchoredChild) {
        parentBox.width = Math.max(1, targetWidth);
        parentBox.height = Math.max(1, targetHeight);
      } else {
        parentBox.width = Math.max(parentBox.width, targetWidth);
        parentBox.height = Math.max(parentBox.height, targetHeight);
      }
    }
  }

  /**
   * Repulsion-based collision resolution.
   *
   * For each sibling scope, check all pairs. When overlap is found:
   * - If one node is anchored (or was displaced this resolve) and the
   *   other is free, push the free node away.
   * - If both are free, push the one whose center is further from the
   *   other (i.e. it was "arrived upon").
   * - If both are anchored, skip (can't move either).
   *
   * Returns true if any overlap was resolved.
   */
  function repelSiblings(): boolean {
    let anyOverlap = false;
    const gap = config.overlapGap;
    const maxDisp = config.maxDisplacementPerCycle;

    for (const scopeId of affectedScopes) {
      const siblingIds = siblingsByParent.get(scopeId);
      if (!siblingIds || siblingIds.length < 2) continue;

      const siblings = siblingIds
        .map((id) => ({ id, box: positionMap.get(id) }))
        .filter((entry): entry is { id: string; box: MutableBox } => Boolean(entry.box));

      if (siblings.length < 2) continue;

      // Check all pairs
      for (let i = 0; i < siblings.length; i++) {
        const a = siblings[i];
        if (!a) continue;
        for (let j = i + 1; j < siblings.length; j++) {
          const b = siblings[j];
          if (!b) continue;

          if (!boxesOverlap(a.box, b.box, gap)) continue;

          anyOverlap = true;

          const aIsAnchored = anchored.has(a.id) || displacedThisResolve.has(a.id);
          const bIsAnchored = anchored.has(b.id) || displacedThisResolve.has(b.id);

          if (aIsAnchored && bIsAnchored) {
            // Both immovable — only push if one is truly user-anchored and the other just displaced
            const aIsHardAnchored = anchored.has(a.id);
            const bIsHardAnchored = anchored.has(b.id);
            if (aIsHardAnchored && !bIsHardAnchored) {
              // Push b away from a
              const vec = computeRepulsionVector(a.box, b.box, gap, maxDisp);
              b.box.x += vec.dx;
              b.box.y += vec.dy;
              displacedThisResolve.add(b.id);
            } else if (bIsHardAnchored && !aIsHardAnchored) {
              // Push a away from b
              const vec = computeRepulsionVector(b.box, a.box, gap, maxDisp);
              a.box.x += vec.dx;
              a.box.y += vec.dy;
              displacedThisResolve.add(a.id);
            }
            // Both hard-anchored: skip
            continue;
          }

          if (aIsAnchored) {
            // Push b away from a
            const vec = computeRepulsionVector(a.box, b.box, gap, maxDisp);
            b.box.x += vec.dx;
            b.box.y += vec.dy;
            displacedThisResolve.add(b.id);
          } else if (bIsAnchored) {
            // Push a away from b
            const vec = computeRepulsionVector(b.box, a.box, gap, maxDisp);
            a.box.x += vec.dx;
            a.box.y += vec.dy;
            displacedThisResolve.add(a.id);
          } else {
            // Neither anchored: push the one further from the pair center
            // (effectively: the "later arrival" gets pushed)
            const aCx = a.box.x + a.box.width / 2;
            const aCy = a.box.y + a.box.height / 2;
            const bCx = b.box.x + b.box.width / 2;
            const bCy = b.box.y + b.box.height / 2;
            const midX = (aCx + bCx) / 2;
            const midY = (aCy + bCy) / 2;

            const aDist = (aCx - midX) ** 2 + (aCy - midY) ** 2;
            const bDist = (bCx - midX) ** 2 + (bCy - midY) ** 2;

            if (bDist >= aDist) {
              // Push b away from a
              const vec = computeRepulsionVector(a.box, b.box, gap, maxDisp);
              b.box.x += vec.dx;
              b.box.y += vec.dy;
              displacedThisResolve.add(b.id);
            } else {
              // Push a away from b
              const vec = computeRepulsionVector(b.box, a.box, gap, maxDisp);
              a.box.x += vec.dx;
              a.box.y += vec.dy;
              displacedThisResolve.add(a.id);
            }
          }
        }
      }
    }

    return anyOverlap;
  }

  // ---- Main settle loop ----

  enforceMinPositions();

  let cyclesUsed = 0;
  let converged = false;
  for (let cycle = 0; cycle < config.maxCycles; cycle++) {
    cyclesUsed = cycle + 1;
    expandParentsBottomUp();
    const hadOverlaps = repelSiblings();
    if (!hadOverlaps) {
      converged = true;
      break;
    }
    enforceMinPositions();
  }

  // ---- Compute delta maps ----

  const updatedPositions = new Map<string, { x: number; y: number }>();
  const updatedSizes = new Map<string, { width: number; height: number }>();

  for (const [id, box] of positionMap) {
    // Never report position changes for live-dragged nodes.
    if (hardAnchored.has(id)) continue;

    const origPos = originalPositions.get(id);
    if (origPos && (Math.abs(box.x - origPos.x) > 0.01 || Math.abs(box.y - origPos.y) > 0.01)) {
      updatedPositions.set(id, { x: box.x, y: box.y });
    }
  }

  for (const [id, box] of positionMap) {
    const origSize = originalSizes.get(id);
    if (origSize && (Math.abs(box.width - origSize.width) > 0.01 || Math.abs(box.height - origSize.height) > 0.01)) {
      updatedSizes.set(id, { width: box.width, height: box.height });
    }
  }

  return { updatedPositions, updatedSizes, cyclesUsed, converged };
}

// ---------------------------------------------------------------------------
// Helper: build mutable position map from node list
// ---------------------------------------------------------------------------

/**
 * Create a mutable position map from a list of BoundsNode items
 * in parent-relative coordinates (as stored in VueFlow node.position).
 * Uses `resolveNodeDimensions` logic inline to avoid circular deps.
 */
export function buildPositionMap(
  nodes: BoundsNode[],
  defaults: { defaultNodeWidth: number; defaultNodeHeight: number }
): Map<string, MutableBox> {
  const map = new Map<string, MutableBox>();
  for (const node of nodes) {
    if (!node.position) continue;
    const nodeStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
    const parseDim = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v)
        ? v
        : typeof v === 'string'
          ? Number.parseFloat(v) || undefined
          : undefined;
    const width = parseDim(nodeStyle['width']) ?? node.measured?.width ?? defaults.defaultNodeWidth;
    const height = parseDim(nodeStyle['height']) ?? node.measured?.height ?? defaults.defaultNodeHeight;
    map.set(node.id, {
      x: node.position.x,
      y: node.position.y,
      width: Math.max(1, width),
      height: Math.max(1, height),
    });
  }
  return map;
}
