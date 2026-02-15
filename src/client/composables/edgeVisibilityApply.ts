/**
 * Pure helpers for building visibility maps from edge virtualization results.
 * No Vue, no DOM — safe for use in both main-thread and worker composables.
 */

/** Minimal edge shape for visibility logic (id + optional hidden). */
export interface EdgeWithHidden {
  id: string;
  hidden?: boolean;
}

/**
 * Collects edge IDs that are currently hidden by user (e.g. relationship filters)
 * and not by virtualization. Used so we don't accidentally un-hide them.
 */
export function collectUserHiddenEdgeIds(edges: EdgeWithHidden[], virtualizedHiddenIds: Set<string>): Set<string> {
  const userHiddenIds = new Set<string>();
  for (const edge of edges) {
    if (edge.hidden && !virtualizedHiddenIds.has(edge.id)) {
      userHiddenIds.add(edge.id);
    }
  }
  return userHiddenIds;
}

/**
 * Builds a visibility map (edge id → hidden) from a virtualization result,
 * respecting user-hidden edges (never un-hide those).
 */
export function buildVisibilityMap(
  edges: EdgeWithHidden[],
  hiddenEdgeIds: Set<string>,
  userHiddenIds: Set<string>
): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const edge of edges) {
    if (userHiddenIds.has(edge.id)) {
      continue;
    }
    const shouldBeHidden = hiddenEdgeIds.has(edge.id);
    if (edge.hidden !== shouldBeHidden) {
      map.set(edge.id, shouldBeHidden);
    }
  }
  return map;
}

/**
 * Builds the "restore" visibility map: for each virtualized-hidden id,
 * set hidden to true iff that edge is currently user-hidden.
 * Used when disabling virtualization or when below threshold.
 */
export function buildRestoreVisibilityMap(
  virtualizedHiddenIds: Set<string>,
  edges: EdgeWithHidden[]
): Map<string, boolean> {
  const userHiddenIds = collectUserHiddenEdgeIds(edges, virtualizedHiddenIds);
  const map = new Map<string, boolean>();
  virtualizedHiddenIds.forEach((edgeId) => {
    map.set(edgeId, userHiddenIds.has(edgeId));
  });
  return map;
}

/** Applies a visibility map (edge id → hidden) to the store. No-op if map is empty. */
export type SetEdgeVisibilityFn = (visibilityMap: Map<string, boolean>) => void;

/**
 * Shared "apply virtualization result" flow: build visibility map from result,
 * then call setEdgeVisibility. Used by main-thread composable and by worker
 * composable when applying worker result. Caller may wrap setEdgeVisibility
 * in a guard (e.g. isWriting).
 */
export function applyVirtualizationResult(
  edges: EdgeWithHidden[],
  hiddenEdgeIds: Set<string>,
  userHiddenIds: Set<string>,
  setEdgeVisibility: SetEdgeVisibilityFn
): void {
  const visibilityMap = buildVisibilityMap(edges, hiddenEdgeIds, userHiddenIds);
  if (visibilityMap.size > 0) {
    setEdgeVisibility(visibilityMap);
  }
}

/**
 * Shared "restore visibility when disabling virtualization" flow: build restore
 * map and call setEdgeVisibility. Used when below threshold or virtualization
 * disabled. Caller then clears virtualizedHiddenIds.
 */
export function applyRestoreVisibility(
  virtualizedHiddenIds: Set<string>,
  edges: EdgeWithHidden[],
  setEdgeVisibility: SetEdgeVisibilityFn
): void {
  if (virtualizedHiddenIds.size === 0) return;
  const restoreVisibilityMap = buildRestoreVisibilityMap(virtualizedHiddenIds, edges);
  if (restoreVisibilityMap.size > 0) {
    setEdgeVisibility(restoreVisibilityMap);
  }
}
