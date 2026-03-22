/**
 * Simple synchronous hierarchical layout.
 *
 * Groups nodes by hierarchy level (package → folder/group → module → symbol)
 * and assigns positions using a grid approach. Child nodes in VueFlow are
 * positioned relative to their parent, so we only assign positions for
 * root-level nodes (no parentNode) and any orphan nodes.
 *
 * Pure function — no external dependencies, no Vue reactivity.
 */

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

const COLUMN_SPACING = 320;
const ROW_SPACING = 220;

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

/**
 * Compute simple hierarchical positions for a set of nodes.
 *
 * Returns a Map from node ID to { x, y }. Only root-level nodes
 * (those without a parentNode) receive positions from this function —
 * child nodes are positioned relative to their parent by VueFlow.
 */
export function computeSimpleHierarchicalLayout(
  nodes: DependencyNode[],
  _edges: GraphEdge[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Separate root nodes (no parentNode) from child nodes
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

  const COLS_PER_ROW = 6;
  let currentRow = 0;

  // Place each type group in its own set of rows
  const sortedTypeOrders = [...byType.keys()].sort((a, b) => a - b);
  for (const typeOrder of sortedTypeOrders) {
    const group = byType.get(typeOrder);
    if (!group || group.length === 0) continue;

    let col = 0;
    let rowOffset = 0;
    for (const node of group) {
      positions.set(node.id, {
        x: col * COLUMN_SPACING,
        y: (currentRow + rowOffset) * ROW_SPACING,
      });
      col++;
      if (col >= COLS_PER_ROW) {
        col = 0;
        rowOffset++;
      }
    }

    // Advance to next group's rows
    const rowsUsed = Math.ceil(group.length / COLS_PER_ROW);
    currentRow += rowsUsed + 1; // +1 gap between type groups
  }

  return positions;
}
