/**
 * Applies an array of NodeChange to a nodes array and returns the updated nodes.
 * Replaces the deprecated applyNodeChanges from @vue-flow/core so we can remove the eslint-disable.
 *
 * Implemented as O(changes + nodes): we collect all updates by node id, then do a single pass
 * over nodes. Doing result.map() per change would be O(changes * nodes) and caused major
 * performance regressions when collision resolution batches many position/dimension updates.
 */

import type { NodeChange } from '@vue-flow/core';

/** Minimal node shape: id and optional position. */
interface NodeWithId {
  id: string;
  position?: { x: number; y: number };
}

interface PositionUpdate {
  x: number;
  y: number;
}

interface DimensionsUpdate {
  width?: number;
  height?: number;
  measured?: { width: number; height: number };
}

interface NodeUpdates {
  position?: PositionUpdate;
  dimensions?: DimensionsUpdate;
  selected?: boolean;
}

/**
 * Applies changes to a copy of the nodes array. Handles remove, position, dimensions, select.
 * Single pass over nodes after aggregating changes by id — O(changes + nodes).
 */
export function applyNodeChanges<T extends NodeWithId>(
  changes: NodeChange[],
  nodes: T[]
): T[] {
  const removedIds = new Set<string>();
  const updatesById = new Map<string, NodeUpdates>();

  for (const change of changes) {
    if (change.type === 'remove' && 'id' in change) {
      removedIds.add(change.id);
      updatesById.delete(change.id);
      continue;
    }
    if (change.type === 'position' && 'id' in change) {
      const c = change as { id: string; position?: { x: number; y: number } };
      if (c.position) {
        const u = updatesById.get(c.id) ?? {};
        u.position = { ...(u.position ?? { x: 0, y: 0 }), ...c.position };
        updatesById.set(c.id, u);
      }
      continue;
    }
    if (change.type === 'dimensions' && 'id' in change) {
      const c = change as { id: string; dimensions?: { width: number; height: number }; measured?: { width: number; height: number } };
      const u = updatesById.get(c.id) ?? {};
      u.dimensions = {
        ...(u.dimensions ?? {}),
        ...(c.dimensions && { width: c.dimensions.width, height: c.dimensions.height }),
        ...(c.measured && { measured: c.measured }),
      };
      updatesById.set(c.id, u);
      continue;
    }
    if (change.type === 'select' && 'id' in change) {
      const c = change as { id: string; selected: boolean };
      const u = updatesById.get(c.id) ?? {};
      u.selected = c.selected;
      updatesById.set(c.id, u);
    }
  }

  const result: T[] = [];
  for (const node of nodes) {
    if (removedIds.has(node.id)) continue;
    const u = updatesById.get(node.id);
    if (!u) {
      result.push(node);
      continue;
    }
    const position =
      u.position != null
        ? { ...((node as NodeWithId).position ?? { x: 0, y: 0 }), ...u.position }
        : undefined;
    const dimensions = u.dimensions;
    const resolvedDimensions =
      dimensions?.width !== undefined && dimensions?.height !== undefined
        ? { width: dimensions.width, height: dimensions.height }
        : undefined;
    const resolvedMeasured =
      dimensions?.measured ?? resolvedDimensions;
    const selected = u.selected;
    const updated = {
      ...node,
      ...(position != null && { position }),
      ...(dimensions?.width !== undefined && { width: dimensions.width }),
      ...(dimensions?.height !== undefined && { height: dimensions.height }),
      ...(resolvedDimensions !== undefined && { dimensions: resolvedDimensions }),
      ...(resolvedMeasured !== undefined && { measured: resolvedMeasured }),
      ...(selected !== undefined && { selected }),
    } as T;
    result.push(updated);
  }
  return result;
}
