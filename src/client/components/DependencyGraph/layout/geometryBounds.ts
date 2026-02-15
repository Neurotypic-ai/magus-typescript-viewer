/**
 * Shared geometry utilities for absolute-bounds resolution, dimension parsing,
 * and rectangle overlap detection. Consumed by edge virtualization, collision
 * resolution, and edge-highway transforms to avoid duplicated math.
 *
 * All functions are pure and deterministic for easy unit testing.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Axis-aligned bounding box in absolute (graph-space) coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimal node shape needed for bounds resolution. */
export interface BoundsNode {
  id: string;
  position?: { x: number; y: number };
  parentNode?: string;
  style?: unknown;
  measured?: {
    width?: number;
    height?: number;
  };
}

/** Default dimensions applied when a node has no measured or styled size. */
export interface BoundsDefaults {
  defaultNodeWidth: number;
  defaultNodeHeight: number;
}

// ---------------------------------------------------------------------------
// Dimension parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CSS-style dimension value (number or numeric string like "280px")
 * into a plain number. Returns `undefined` for non-finite or non-parseable input.
 */
export const parseDimension = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// ---------------------------------------------------------------------------
// Absolute bounds resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective width and height for a single node using the same
 * priority chain as VueFlow rendering:
 *   1. Explicit style width/height (container nodes)
 *   2. Measured DOM width/height
 *   3. Provided defaults
 */
export const resolveNodeDimensions = (
  node: BoundsNode,
  defaults: BoundsDefaults
): { width: number; height: number } => {
  const nodeStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
  const width = parseDimension(nodeStyle['width']) ?? node.measured?.width ?? defaults.defaultNodeWidth;
  const height = parseDimension(nodeStyle['height']) ?? node.measured?.height ?? defaults.defaultNodeHeight;
  return { width: Math.max(1, width), height: Math.max(1, height) };
};

/**
 * Build a map of node-id to absolute (graph-space) bounding rectangles.
 * Recursively resolves `parentNode` chains to convert relative positions
 * to absolute ones. Cycle-safe via `resolving` guard set.
 */
export const buildAbsoluteNodeBoundsMap = (nodeList: BoundsNode[], defaults: BoundsDefaults): Map<string, Rect> => {
  const nodeById = new Map(nodeList.map((node) => [node.id, node]));
  const boundsById = new Map<string, Rect>();
  const resolving = new Set<string>();

  const resolveBounds = (nodeId: string): Rect | null => {
    const cached = boundsById.get(nodeId);
    if (cached) {
      return cached;
    }

    if (resolving.has(nodeId)) {
      return null;
    }

    const node = nodeById.get(nodeId);
    if (!node?.position) {
      return null;
    }

    resolving.add(nodeId);
    const { width, height } = resolveNodeDimensions(node, defaults);

    let absoluteX = node.position.x;
    let absoluteY = node.position.y;
    if (node.parentNode) {
      const parentBounds = resolveBounds(node.parentNode);
      if (parentBounds) {
        absoluteX += parentBounds.x;
        absoluteY += parentBounds.y;
      }
    }

    const computedBounds: Rect = { x: absoluteX, y: absoluteY, width, height };
    boundsById.set(nodeId, computedBounds);
    resolving.delete(nodeId);
    return computedBounds;
  };

  for (const node of nodeList) {
    resolveBounds(node.id);
  }
  return boundsById;
};

