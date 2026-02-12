import { ref, watch } from 'vue';

import type { Ref } from 'vue';

import type { DependencyNode, GraphEdge } from './types';

/** Minimum edge count before virtualization kicks in */
const VIRTUALIZATION_THRESHOLD = 200;

/** Padding in screen pixels around the viewport before edges are culled */
const VIEWPORT_PADDING_PX = 300;

/** Debounce ms for viewport change → visibility recalculation */
const RECALC_DEBOUNCE_MS = 60;

/** At zoom levels below this, apply edge count thresholding */
const LOW_ZOOM_THRESHOLD = 0.3;

/** Max visible edges at very low zoom (keeps the graph readable + performant) */
const LOW_ZOOM_MAX_EDGES = 500;

/** Edge type priority for thresholding (higher = kept longer) */
const EDGE_TYPE_PRIORITY: Record<string, number> = {
  inheritance: 4,
  implements: 3,
  dependency: 2,
  import: 1,
  devDependency: 0,
  peerDependency: 0,
  contains: 5,
  uses: 5,
  export: 0,
  extends: 3,
};

interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface UseEdgeVirtualizationOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  getViewport: () => { x: number; y: number; zoom: number };
  getContainerRect: () => DOMRect | null;
  setEdges: (edges: GraphEdge[]) => void;
  enabled: Ref<boolean>;
}

/**
 * Composable that hides off-screen edges to reduce DOM element count.
 *
 * At high zoom levels where only a portion of the graph is visible,
 * this can remove 60-90% of edges from the DOM.
 *
 * At low zoom levels (< 0.3), it also applies priority-based thresholding
 * to keep only the most important edges visible.
 */
export function useEdgeVirtualization(options: UseEdgeVirtualizationOptions) {
  const { nodes, edges, getViewport, getContainerRect, setEdges, enabled } = options;

  // Track which edges are hidden by virtualization vs. by user filtering.
  // We only toggle edges that we own — never override user-set hidden flags.
  const virtualizedHiddenIds = ref(new Set<string>());

  // Track edges hidden by user filtering (relationship toggles, etc.)
  // so we don't accidentally un-hide them.
  const userHiddenIds = new Set<string>();

  // Guard flag to prevent watch → recalc → write → watch infinite loop
  let isWriting = false;
  let recalcTimer: ReturnType<typeof setTimeout> | null = null;

  /** Build a quick lookup of node positions by ID */
  function buildNodePositionMap(nodeList: DependencyNode[]): Map<string, { x: number; y: number }> {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of nodeList) {
      if (node.position) {
        map.set(node.id, node.position);
      }
    }
    return map;
  }

  /** Calculate visible viewport bounds in graph-space coordinates */
  function getViewportBounds(): ViewportBounds | null {
    const vp = getViewport();
    if (!vp || vp.zoom === 0) return null;

    const rect = getContainerRect();
    const width = rect?.width ?? 1200;
    const height = rect?.height ?? 800;
    const padding = VIEWPORT_PADDING_PX / vp.zoom;

    // Convert screen-space viewport to graph-space bounds:
    // screenX = graphX * zoom + viewport.x → graphX = (screenX - viewport.x) / zoom
    const minX = (-vp.x / vp.zoom) - padding;
    const minY = (-vp.y / vp.zoom) - padding;
    const maxX = ((-vp.x + width) / vp.zoom) + padding;
    const maxY = ((-vp.y + height) / vp.zoom) + padding;

    return { minX, maxX, minY, maxY };
  }

  /** Check if a node's bounding area intersects viewport bounds */
  function isNodeInBounds(pos: { x: number; y: number }, bounds: ViewportBounds): boolean {
    // Generous size estimate: nodes are typically 150-300px wide, 40-100px tall
    return (
      pos.x + 300 >= bounds.minX &&
      pos.x <= bounds.maxX &&
      pos.y + 100 >= bounds.minY &&
      pos.y <= bounds.maxY
    );
  }

  /** Apply priority-based thresholding for low zoom levels */
  function applyLowZoomThresholding(
    visibleEdgeIds: Set<string>,
    edgeList: GraphEdge[]
  ): Set<string> {
    if (visibleEdgeIds.size <= LOW_ZOOM_MAX_EDGES) return visibleEdgeIds;

    // Build degree map for visible nodes to prioritize high-connectivity edges
    const nodeDegree = new Map<string, number>();
    for (const edge of edgeList) {
      if (!visibleEdgeIds.has(edge.id)) continue;
      nodeDegree.set(edge.source, (nodeDegree.get(edge.source) ?? 0) + 1);
      nodeDegree.set(edge.target, (nodeDegree.get(edge.target) ?? 0) + 1);
    }

    // Score each edge by type priority + connectivity
    const scored: Array<{ id: string; score: number }> = [];
    for (const edge of edgeList) {
      if (!visibleEdgeIds.has(edge.id)) continue;
      const typePriority = EDGE_TYPE_PRIORITY[edge.data?.type ?? ''] ?? 0;
      const sourceDegree = nodeDegree.get(edge.source) ?? 0;
      const targetDegree = nodeDegree.get(edge.target) ?? 0;
      // Higher type priority and higher connectivity = more important
      const score = typePriority * 100 + sourceDegree + targetDegree;
      scored.push({ id: edge.id, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const kept = new Set<string>();
    for (let i = 0; i < Math.min(LOW_ZOOM_MAX_EDGES, scored.length); i++) {
      kept.add(scored[i]!.id);
    }
    return kept;
  }

  /** Core recalculation: determine which edges should be visible */
  function recalculate(): void {
    const edgeList = edges.value;
    const nodeList = nodes.value;

    // Skip virtualization for small graphs
    if (!enabled.value || edgeList.length < VIRTUALIZATION_THRESHOLD) {
      // Restore any edges we previously hid
      if (virtualizedHiddenIds.value.size > 0) {
        const restored = edgeList.map((edge) => {
          if (virtualizedHiddenIds.value.has(edge.id)) {
            return { ...edge, hidden: userHiddenIds.has(edge.id) };
          }
          return edge;
        });
        isWriting = true;
        setEdges(restored);
        isWriting = false;
        virtualizedHiddenIds.value = new Set();
      }
      return;
    }

    const bounds = getViewportBounds();
    if (!bounds) return;

    const nodePositionMap = buildNodePositionMap(nodeList);
    const vp = getViewport();
    const isLowZoom = vp.zoom < LOW_ZOOM_THRESHOLD;

    // Snapshot which edges are currently user-hidden (by relationship filters)
    // so we don't accidentally un-hide them when they scroll into viewport.
    userHiddenIds.clear();
    for (const edge of edgeList) {
      if (edge.hidden && !virtualizedHiddenIds.value.has(edge.id)) {
        userHiddenIds.add(edge.id);
      }
    }

    // Determine which edges have at least one endpoint in viewport
    const viewportVisibleIds = new Set<string>();
    for (const edge of edgeList) {
      // Don't un-hide user-hidden edges
      if (userHiddenIds.has(edge.id)) continue;

      const sourcePos = nodePositionMap.get(edge.source);
      const targetPos = nodePositionMap.get(edge.target);

      // If we can't find node positions, keep the edge visible as a safety fallback
      if (!sourcePos || !targetPos) {
        viewportVisibleIds.add(edge.id);
        continue;
      }

      // Edge is visible if either endpoint is in the viewport
      if (isNodeInBounds(sourcePos, bounds) || isNodeInBounds(targetPos, bounds)) {
        viewportVisibleIds.add(edge.id);
      }
    }

    // Apply low-zoom thresholding if needed
    const finalVisibleIds = isLowZoom
      ? applyLowZoomThresholding(viewportVisibleIds, edgeList)
      : viewportVisibleIds;

    // Build the new hidden set and check if anything changed
    const newHiddenIds = new Set<string>();
    let changed = false;

    const updated = edgeList.map((edge) => {
      if (userHiddenIds.has(edge.id)) {
        // Respect user filtering — don't touch these edges
        return edge;
      }

      const shouldBeHidden = !finalVisibleIds.has(edge.id);
      if (shouldBeHidden) {
        newHiddenIds.add(edge.id);
      }

      if (edge.hidden !== shouldBeHidden) {
        changed = true;
        return { ...edge, hidden: shouldBeHidden };
      }
      return edge;
    });

    virtualizedHiddenIds.value = newHiddenIds;

    if (changed) {
      isWriting = true;
      setEdges(updated);
      isWriting = false;
    }
  }

  /** Schedule a debounced recalculation */
  function scheduleRecalc(): void {
    if (recalcTimer) clearTimeout(recalcTimer);
    recalcTimer = setTimeout(recalculate, RECALC_DEBOUNCE_MS);
  }

  // Re-run when nodes/edges change (e.g., after layout, filter toggle).
  // Skip when the change was caused by our own write (isWriting guard).
  watch([nodes, edges], () => {
    if (enabled.value && !isWriting) {
      scheduleRecalc();
    }
  });

  return {
    /** Call this when the viewport changes (pan, zoom) */
    onViewportChange: scheduleRecalc,
    /** Force an immediate recalculation */
    recalculate,
    /** Set of edge IDs currently hidden by virtualization */
    virtualizedHiddenCount: virtualizedHiddenIds,
  };
}
