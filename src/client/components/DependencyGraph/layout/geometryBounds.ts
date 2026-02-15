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

// ---------------------------------------------------------------------------
// Rectangle overlap / intersection helpers
// ---------------------------------------------------------------------------

/**
 * Check whether two axis-aligned rectangles overlap when separated by at
 * least `gap` pixels on each axis.
 */
export const rectsOverlap = (a: Rect, b: Rect, gap: number): boolean => {
  const hOverlap = a.x < b.x + b.width + gap && a.x + a.width + gap > b.x;
  const vOverlap = a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  return hOverlap && vOverlap;
};

/**
 * Compute the overlap depth between two rectangles on a given axis.
 * Positive value means `a` intrudes into `b` (plus gap). Negative means clear.
 */
export const overlapDepth = (a: Rect, b: Rect, axis: 'x' | 'y', gap: number): number => {
  if (axis === 'x') {
    const aRight = a.x + a.width + gap;
    const bRight = b.x + b.width + gap;
    return Math.min(aRight - b.x, bRight - a.x);
  }
  const aBottom = a.y + a.height + gap;
  const bBottom = b.y + b.height + gap;
  return Math.min(aBottom - b.y, bBottom - a.y);
};

// ---------------------------------------------------------------------------
// Sibling grouping
// ---------------------------------------------------------------------------

/**
 * Group node IDs by their `parentNode` value. Root-level nodes (no parent)
 * are grouped under the key `'__root__'`.
 */
export const groupNodesByParent = (nodeList: BoundsNode[]): Map<string, string[]> => {
  const groups = new Map<string, string[]>();
  for (const node of nodeList) {
    const parentId = node.parentNode ?? '__root__';
    const siblings = groups.get(parentId);
    if (siblings) {
      siblings.push(node.id);
    } else {
      groups.set(parentId, [node.id]);
    }
  }
  return groups;
};
