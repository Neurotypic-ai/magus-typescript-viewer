/**
 * Sugiyama-based synchronous hierarchical layout.
 *
 * Root-level nodes are arranged in layer-based columns (Sugiyama framework):
 *   - X position determined by layerIndex (foundations left, consumers right)
 *   - Y position within each column determined by sortOrder (barycenter heuristic)
 *
 * Child nodes in VueFlow are positioned relative to their parent:
 *   1. Lay out children within their parent (layer columns, sorted by sortOrder).
 *   2. Compute an explicit size for each parent based on child layout.
 *   3. Assign column positions to root-level nodes by layerIndex.
 *
 * Pure function — no external dependencies, no Vue reactivity.
 */

import { resolveNodeDimensions } from './geometryBounds';

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

// ── Root-level column constants ──────────────────────────────────────────────

/** Horizontal gap between adjacent layer columns. */
const ROOT_H_GAP = 120;
/** Vertical gap between nodes stacked in the same column. */
const ROOT_V_GAP = 120;

// ── Child layout constants ───────────────────────────────────────────────────

/**
 * Estimated width of a child module node before DOM measurement.
 * Modules with metadata, imports, symbols etc. are typically 280–340px.
 */
const CHILD_ESTIMATED_WIDTH = 320;

/**
 * Estimated height of a child module node before DOM measurement.
 * Modules with header, body content (imports, deps, symbols) are typically
 * 200–400px. Use a generous estimate so expandParent adjustments are small.
 */
const CHILD_ESTIMATED_HEIGHT = 260;

const DEFAULT_NODE_DIMENSIONS = {
  defaultNodeWidth: CHILD_ESTIMATED_WIDTH,
  defaultNodeHeight: CHILD_ESTIMATED_HEIGHT,
} as const;

/** Space reserved at the top of a parent for its header label. */
const CHILD_PADDING_TOP = 100;
/** Horizontal inset from the parent border to the first child column. */
const CHILD_PADDING_LEFT = 100;
/** Horizontal inset from the last child column to the parent border. */
const CHILD_PADDING_RIGHT = 100;
/** Bottom padding inside the parent. */
const CHILD_PADDING_BOTTOM = 100;
/** Gap between sibling child nodes. */
const CHILD_GAP = 200;

/**
 * Actual visual inset from the folder chrome to where child nodes should start.
 * The larger `CHILD_PADDING_*` constants are preserved as reserve space for the
 * enclosing parent bounds, but they are too large to use as literal child
 * positions inside the folder.
 */
const CHILD_VISUAL_INSET_TOP = 100;
const CHILD_VISUAL_INSET_LEFT = 100;

// ── Types ────────────────────────────────────────────────────────────────────

interface HierarchicalLayoutResult {
  /** Map from node ID to its assigned position. */
  positions: Map<string, { x: number; y: number }>;
  /**
   * Map from parent node ID to a computed explicit size.
   * Only populated for nodes that have children; callers should apply these
   * as explicit width/height so the parent visually encloses its children.
   */
  sizes: Map<string, { width: number; height: number }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSortOrder(node: DependencyNode): number {
  return node.data?.sortOrder ?? 0;
}

function getLayerIndex(node: DependencyNode): number {
  return node.data?.layerIndex ?? 0;
}

// ── Child layout ─────────────────────────────────────────────────────────────

/**
 * Lay out child nodes within their parent.
 *
 * Two modes, chosen automatically:
 *
 * 1. **Single-column vertical stack** (default when children have no internal
 *    edges between each other). Each child's x is the same; they are
 *    stacked vertically by sortOrder. This matches how most folders read
 *    — siblings are "peers," not a dependency chain.
 *
 * 2. **Layer columns** (when there are intra-folder edges between children).
 *    Children are grouped by layerIndex into sub-columns (foundations left,
 *    consumers right) and sorted by sortOrder within each column. This
 *    shows the internal dependency flow for folders that are structured
 *    as a layered subsystem.
 *
 * `hasIntraFolderEdges` is a hint computed once per folder in the caller —
 * we don't need the full edge list here, just whether any edge connects two
 * children in this folder.
 */
function computeChildLayout(
  children: DependencyNode[],
  hasIntraFolderEdges: boolean
): {
  childPositions: Map<string, { x: number; y: number }>;
  parentSize: { width: number; height: number };
} {
  const childPositions = new Map<string, { x: number; y: number }>();

  if (!hasIntraFolderEdges) {
    // Single-column vertical stack: stable, predictable, and avoids artificial
    // horizontal spread caused by differing external-import depths.
    const sorted = [...children].sort(
      (a, b) => getSortOrder(a) - getSortOrder(b) || a.id.localeCompare(b.id)
    );

    const columnX = CHILD_VISUAL_INSET_LEFT;
    let columnY = CHILD_VISUAL_INSET_TOP;
    let columnWidth = 0;

    for (const child of sorted) {
      const dims = resolveNodeDimensions(child, DEFAULT_NODE_DIMENSIONS);
      columnWidth = Math.max(columnWidth, dims.width);
      childPositions.set(child.id, { x: columnX, y: columnY });
      columnY += dims.height + CHILD_GAP;
    }

    const contentHeight = Math.max(0, columnY - CHILD_GAP - CHILD_VISUAL_INSET_TOP);

    return {
      childPositions,
      parentSize: {
        width: Math.max(220, columnWidth + CHILD_PADDING_LEFT + CHILD_PADDING_RIGHT),
        height: Math.max(80, CHILD_PADDING_TOP + contentHeight + CHILD_PADDING_BOTTOM),
      },
    };
  }

  // Layer-column layout for folders with internal structure.
  const byLayer = new Map<number, DependencyNode[]>();
  for (const child of children) {
    const layer = getLayerIndex(child);
    const group = byLayer.get(layer) ?? [];
    group.push(child);
    byLayer.set(layer, group);
  }

  // Sort each column by sortOrder, tiebreak by ID
  for (const [, group] of byLayer) {
    group.sort((a, b) => getSortOrder(a) - getSortOrder(b) || a.id.localeCompare(b.id));
  }

  const sortedLayers = [...byLayer.keys()].sort((a, b) => b - a);

  // Compute column widths and row heights per column
  let columnX = CHILD_VISUAL_INSET_LEFT;
  let maxColumnHeight = 0;

  for (const layer of sortedLayers) {
    const group = byLayer.get(layer);
    if (!group || group.length === 0) continue;

    let columnWidth = 0;
    let columnY = CHILD_VISUAL_INSET_TOP;

    for (const child of group) {
      const dims = resolveNodeDimensions(child, DEFAULT_NODE_DIMENSIONS);
      columnWidth = Math.max(columnWidth, dims.width);
      childPositions.set(child.id, { x: columnX, y: columnY });
      columnY += dims.height + CHILD_GAP;
    }

    maxColumnHeight = Math.max(maxColumnHeight, columnY - CHILD_GAP - CHILD_VISUAL_INSET_TOP);
    columnX += columnWidth + CHILD_GAP;
  }

  const contentWidth = Math.max(0, columnX - CHILD_GAP - CHILD_VISUAL_INSET_LEFT);
  const contentHeight = maxColumnHeight;

  return {
    childPositions,
    parentSize: {
      width: Math.max(220, contentWidth + CHILD_PADDING_LEFT + CHILD_PADDING_RIGHT),
      height: Math.max(80, CHILD_PADDING_TOP + contentHeight + CHILD_PADDING_BOTTOM),
    },
  };
}

// ── Main layout ───────────────────────────────────────────────────────────────

/**
 * Compute hierarchical positions and parent sizes for a set of nodes.
 *
 * - Child nodes (those with a `parentNode`) are positioned in layer columns
 *   within their parent, grouped by layerIndex and sorted by sortOrder.
 * - Root nodes (no `parentNode`) are placed in Sugiyama layer columns:
 *   grouped by layerIndex (foundations left, consumers right) and sorted
 *   vertically by sortOrder (barycenter heuristic).
 */
export function computeSimpleHierarchicalLayout(
  nodes: DependencyNode[],
  edges: GraphEdge[]
): HierarchicalLayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, { width: number; height: number }>();

  // ── Step 1: lay out children within each parent ──────────────────────────

  const childrenByParent = new Map<string, DependencyNode[]>();
  const parentByChild = new Map<string, string>();
  for (const node of nodes) {
    if (node.parentNode) {
      const siblings = childrenByParent.get(node.parentNode) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentNode, siblings);
      parentByChild.set(node.id, node.parentNode);
    }
  }

  // Detect intra-folder edges (both endpoints share a parent).
  // Cross-folder edges have already been lifted to folder→folder trunks by
  // `liftCrossfolderEdgesToFolderLevel`, but source/target stubs still connect
  // a module to its parent folder — those aren't "between siblings" and are
  // filtered out by requiring parentByChild on BOTH ends.
  const foldersWithIntraEdges = new Set<string>();
  for (const edge of edges) {
    const srcParent = parentByChild.get(edge.source);
    const tgtParent = parentByChild.get(edge.target);
    if (srcParent !== undefined && srcParent === tgtParent) {
      foldersWithIntraEdges.add(srcParent);
    }
  }

  for (const [parentId, children] of childrenByParent) {
    const hasIntraEdges = foldersWithIntraEdges.has(parentId);
    const { childPositions, parentSize } = computeChildLayout(children, hasIntraEdges);
    for (const [id, pos] of childPositions) {
      positions.set(id, pos);
    }
    sizes.set(parentId, parentSize);
  }

  // ── Step 2: lay out root nodes in Sugiyama layer columns ──────────────────
  //
  // Group root nodes by layerIndex, sort each column by sortOrder (barycenter),
  // and stack them vertically. Columns are placed left-to-right, foundations
  // (layer 0) on the left, consumers on the right.

  const rootNodes = nodes.filter((n) => !n.parentNode);

  // Group by layer index
  const byLayer = new Map<number, DependencyNode[]>();
  for (const node of rootNodes) {
    const layer = getLayerIndex(node);
    const group = byLayer.get(layer) ?? [];
    group.push(node);
    byLayer.set(layer, group);
  }

  // Sort each column by sortOrder (barycenter) descending, tiebreak by ID
  for (const [, group] of byLayer) {
    group.sort((a, b) => getSortOrder(b) - getSortOrder(a) || a.id.localeCompare(b.id));
  }

  // Lay out columns left-to-right
  const sortedLayers = [...byLayer.keys()].sort((a, b) => b - a);
  let columnX = 0;

  for (const layer of sortedLayers) {
    const group = byLayer.get(layer);
    if (!group || group.length === 0) continue;

    // Determine the width of this column (max node width in the column)
    let columnWidth = 0;
    let columnY = 0;

    for (const node of group) {
      const nodeSize = sizes.get(node.id);
      const explicitNodeSize = resolveNodeDimensions(node, DEFAULT_NODE_DIMENSIONS);
      const nodeWidth = nodeSize?.width ?? explicitNodeSize.width;
      const nodeHeight = nodeSize?.height ?? explicitNodeSize.height;

      columnWidth = Math.max(columnWidth, nodeWidth);
      positions.set(node.id, { x: columnX, y: columnY });
      columnY += nodeHeight + ROOT_V_GAP;
    }

    columnX += columnWidth + ROOT_H_GAP;
  }

  return { positions, sizes };
}
