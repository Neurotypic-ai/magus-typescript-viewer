/**
 * Simple synchronous hierarchical layout.
 *
 * Groups nodes by hierarchy level (package → folder/group → module → symbol)
 * and assigns positions using a grid approach. Child nodes in VueFlow are
 * positioned relative to their parent, so we:
 *   1. Lay out children within their parent (simple grid, left-to-right then wrap).
 *   2. Compute an explicit size for each parent based on child layout.
 *   3. Assign absolute positions to root-level nodes, using the computed parent
 *      sizes to determine row heights so parents don't overlap each other.
 *
 * Pure function — no external dependencies, no Vue reactivity.
 */

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

// ── Root-level grid constants ────────────────────────────────────────────────

const COLUMN_SPACING = 320;
const ROW_SPACING = 220;
const COLS_PER_ROW = 6;

// ── Child layout constants ───────────────────────────────────────────────────

/** Estimated width of a child node (module) before DOM measurement. */
const CHILD_ESTIMATED_WIDTH = 280;
/** Estimated height of a child node (module) before DOM measurement. */
const CHILD_ESTIMATED_HEIGHT = 130;
/** Space reserved at the top of a parent for its header (folder label). */
const CHILD_PADDING_TOP = 40;
/** Horizontal padding inside the parent on each side. */
const CHILD_PADDING_SIDE = 12;
/** Bottom padding inside the parent. */
const CHILD_PADDING_BOTTOM = 12;
/** Gap between sibling child nodes. */
const CHILD_GAP = 10;
/** Maximum columns of children per parent row. */
const CHILD_MAX_COLS = 3;

// ── Types ────────────────────────────────────────────────────────────────────

export interface HierarchicalLayoutResult {
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

  children.forEach((child, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    childPositions.set(child.id, {
      x: CHILD_PADDING_SIDE + col * (CHILD_ESTIMATED_WIDTH + CHILD_GAP),
      y: CHILD_PADDING_TOP + row * (CHILD_ESTIMATED_HEIGHT + CHILD_GAP),
    });
  });

  const contentWidth = cols * CHILD_ESTIMATED_WIDTH + (cols - 1) * CHILD_GAP;
  const contentHeight = rows * CHILD_ESTIMATED_HEIGHT + (rows - 1) * CHILD_GAP;

  return {
    childPositions,
    parentSize: {
      width: Math.max(220, contentWidth + 2 * CHILD_PADDING_SIDE),
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
 * - Root nodes (no `parentNode`) are placed in a type-ordered grid, with row
 *   heights derived from each root's computed size so rows never overlap.
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

  // ── Step 2: lay out root nodes, using computed sizes for row heights ───────

  const rootNodes = nodes
    .filter((n) => !n.parentNode)
    .sort((a, b) => getTypeOrder(a) - getTypeOrder(b));

  // Group root nodes by type for row-based layout
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
    let rowMaxHeight = ROW_SPACING;
    let rowStartY = currentY;

    for (const node of group) {
      // If this node has a computed size, use its height to track row height.
      const nodeSize = sizes.get(node.id);
      const nodeHeight = nodeSize?.height ?? ROW_SPACING;
      rowMaxHeight = Math.max(rowMaxHeight, nodeHeight);

      positions.set(node.id, {
        x: col * COLUMN_SPACING,
        y: rowStartY,
      });

      col++;
      if (col >= COLS_PER_ROW) {
        col = 0;
        rowStartY += rowMaxHeight + ROW_SPACING;
        rowMaxHeight = ROW_SPACING;
        currentY = rowStartY;
      }
    }

    // Advance past this type group (add one extra row gap between type groups)
    currentY = rowStartY + rowMaxHeight + ROW_SPACING;
  }

  return { positions, sizes };
}
