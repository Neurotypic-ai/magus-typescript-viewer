/**
 * Simple synchronous hierarchical layout.
 *
 * Groups nodes by hierarchy level (package → folder/group → module → symbol)
 * and assigns positions using a flow-based approach. Child nodes in VueFlow are
 * positioned relative to their parent, so we:
 *   1. Lay out children within their parent (simple grid, left-to-right then wrap).
 *   2. Compute an explicit size for each parent based on child layout.
 *   3. Assign absolute positions to root-level nodes using variable column widths
 *      so that wider parents don't overlap narrower ones.
 *
 * Pure function — no external dependencies, no Vue reactivity.
 */

import { resolveNodeDimensions } from './geometryBounds';

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

// ── Root-level grid constants ────────────────────────────────────────────────

/** Horizontal gap between adjacent root nodes in the same row. */
const ROOT_H_GAP = 40;
/** Vertical gap between rows of root nodes. */
const ROOT_V_GAP = 60;
/** Max root nodes per row before wrapping. */
const COLS_PER_ROW = 6;

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
const CHILD_PADDING_TOP = 44;
/** Horizontal inset from the parent border to the first child column. */
const CHILD_PADDING_LEFT = 10;
/** Horizontal inset from the last child column to the parent border. */
const CHILD_PADDING_RIGHT = 10;
/** Bottom padding inside the parent. */
const CHILD_PADDING_BOTTOM = 10;
/** Gap between sibling child nodes. */
const CHILD_GAP = 12;
/** Maximum columns of children per parent. */
const CHILD_MAX_COLS = 3;

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

/** Node type priority for ordering within a row. */
const TYPE_ORDER: Record<string, number> = {
  package: 0,
  group: 1,
  module: 2,
  symbol: 3,
};

function getTypeOrder(node: DependencyNode): number {
  const t = node.type ?? '';
  return TYPE_ORDER[t] ?? 99;
}

// ── Child layout ─────────────────────────────────────────────────────────────

/**
 * Lay out child nodes within their parent and compute the parent's required size.
 * Returns positions for each child (relative to parent top-left) and the
 * minimum width/height the parent needs to enclose them.
 */
function computeChildLayout(children: DependencyNode[]): {
  childPositions: Map<string, { x: number; y: number }>;
  parentSize: { width: number; height: number };
} {
  const childPositions = new Map<string, { x: number; y: number }>();

  const cols = Math.min(CHILD_MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(children.length))));
  const rows = Math.ceil(children.length / cols);
  const childDimensions = children.map((child) => resolveNodeDimensions(child, DEFAULT_NODE_DIMENSIONS));
  const columnWidths = Array.from({ length: cols }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);

  childDimensions.forEach((dimensions, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    columnWidths[col] = Math.max(columnWidths[col] ?? 0, dimensions.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, dimensions.height);
  });

  const columnOffsets = new Array<number>(cols);
  let nextColumnOffset = CHILD_PADDING_LEFT;
  for (let col = 0; col < cols; col++) {
    columnOffsets[col] = nextColumnOffset;
    nextColumnOffset += (columnWidths[col] ?? 0) + CHILD_GAP;
  }

  const rowOffsets = new Array<number>(rows);
  let nextRowOffset = CHILD_PADDING_TOP;
  for (let row = 0; row < rows; row++) {
    rowOffsets[row] = nextRowOffset;
    nextRowOffset += (rowHeights[row] ?? 0) + CHILD_GAP;
  }

  children.forEach((child, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    childPositions.set(child.id, {
      x: columnOffsets[col] ?? CHILD_PADDING_LEFT,
      y: rowOffsets[row] ?? CHILD_PADDING_TOP,
    });
  });

  const contentWidth = columnWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, cols - 1) * CHILD_GAP;
  const contentHeight = rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows - 1) * CHILD_GAP;

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
 * - Child nodes (those with a `parentNode`) are positioned relative to their
 *   parent in a simple grid.
 * - Root nodes (no `parentNode`) are placed in a flow layout: each row uses
 *   the actual node widths for x-positions, and actual heights for row spacing,
 *   so nodes never overlap each other regardless of size variation.
 */
export function computeSimpleHierarchicalLayout(
  nodes: DependencyNode[],
  _edges: GraphEdge[]
): HierarchicalLayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, { width: number; height: number }>();

  // ── Step 1: lay out children within each parent ──────────────────────────

  const childrenByParent = new Map<string, DependencyNode[]>();
  for (const node of nodes) {
    if (node.parentNode) {
      const siblings = childrenByParent.get(node.parentNode) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentNode, siblings);
    }
  }

  for (const [parentId, children] of childrenByParent) {
    const { childPositions, parentSize } = computeChildLayout(children);
    for (const [id, pos] of childPositions) {
      positions.set(id, pos);
    }
    sizes.set(parentId, parentSize);
  }

  // ── Step 2: lay out root nodes with variable column widths ────────────────

  const rootNodes = nodes.filter((n) => !n.parentNode).sort((a, b) => getTypeOrder(a) - getTypeOrder(b));

  // Group root nodes by type for row-based layout.
  const byType = new Map<number, DependencyNode[]>();
  for (const node of rootNodes) {
    const order = getTypeOrder(node);
    const group = byType.get(order) ?? [];
    group.push(node);
    byType.set(order, group);
  }

  let currentY = 0;

  const sortedTypeOrders = [...byType.keys()].sort((a, b) => a - b);
  for (const typeOrder of sortedTypeOrders) {
    const group = byType.get(typeOrder);
    if (!group || group.length === 0) continue;

    let col = 0;
    let rowX = 0;
    let rowMaxHeight = 0;
    let rowStartY = currentY;

    for (const node of group) {
      const nodeSize = sizes.get(node.id);
      const explicitNodeSize = resolveNodeDimensions(node, DEFAULT_NODE_DIMENSIONS);
      const nodeWidth = nodeSize?.width ?? explicitNodeSize.width;
      const nodeHeight = nodeSize?.height ?? explicitNodeSize.height;

      rowMaxHeight = Math.max(rowMaxHeight, nodeHeight);

      positions.set(node.id, { x: rowX, y: rowStartY });

      col++;
      rowX += nodeWidth + ROOT_H_GAP;

      if (col >= COLS_PER_ROW) {
        col = 0;
        rowX = 0;
        rowStartY += rowMaxHeight + ROOT_V_GAP;
        rowMaxHeight = 0;
        currentY = rowStartY;
      }
    }

    // Advance past this type group.
    currentY = rowStartY + rowMaxHeight + ROOT_V_GAP;
  }

  return { positions, sizes };
}
