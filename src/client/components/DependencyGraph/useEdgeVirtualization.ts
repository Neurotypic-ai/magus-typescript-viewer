import { ref, watch } from 'vue';

import type { Ref, WatchStopHandle } from 'vue';

import type { DependencyNode, GraphEdge } from './types';

/** Minimum edge count before virtualization kicks in */
const VIRTUALIZATION_THRESHOLD = 200;

/** Padding in screen pixels around the viewport before edges are culled */
const VIEWPORT_PADDING_PX = 300;

/** Minimum frame spacing for recalculations */
const RECALC_MIN_FRAME_GAP_MS = 16;

/** At zoom levels below this, apply edge count thresholding */
const LOW_ZOOM_THRESHOLD = 0.3;

/** Base visible-edge budget at low zoom (adapted per device + zoom) */
const LOW_ZOOM_BASE_MAX_EDGES = 500;
const LOW_ZOOM_MIN_BUDGET = 140;
const LOW_ZOOM_MAX_BUDGET = 900;

const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 100;

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
  setEdgeVisibility: (visibilityMap: Map<string, boolean>) => void;
  enabled: Ref<boolean>;
}

interface NodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
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
  const { nodes, edges, getViewport, getContainerRect, setEdgeVisibility, enabled } = options;

  // Track which edges are hidden by virtualization vs. by user filtering.
  // We only toggle edges that we own — never override user-set hidden flags.
  const virtualizedHiddenIds = ref(new Set<string>());

  // Track edges hidden by user filtering (relationship toggles, etc.)
  // so we don't accidentally un-hide them.
  const userHiddenIds = new Set<string>();

  // Guard flag to prevent watch → recalc → write → watch infinite loop
  let isWriting = false;
  let recalcRafId: number | null = null;
  let recalcDirty = false;
  let lastRecalcTimestamp = 0;
  // Suspend flag: when true, recalculate is a no-op. Used during layout→fitView
  // transitions to prevent the composable from seeing a stale viewport.
  let suspended = false;

  let edgePrioritySignature = '';
  let edgePriorityOrder: string[] = [];

  function parseDimension(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== 'string') {
      return undefined;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function buildAbsoluteNodeBoundsMap(nodeList: DependencyNode[]): Map<string, NodeBounds> {
    const nodeById = new Map(nodeList.map((node) => [node.id, node]));
    const boundsById = new Map<string, NodeBounds>();
    const resolving = new Set<string>();

    const resolveBounds = (nodeId: string): NodeBounds | null => {
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
      const nodeStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
      const measured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
      const width = parseDimension(nodeStyle['width']) ?? measured?.width ?? DEFAULT_NODE_WIDTH;
      const height = parseDimension(nodeStyle['height']) ?? measured?.height ?? DEFAULT_NODE_HEIGHT;

      let absoluteX = node.position.x;
      let absoluteY = node.position.y;
      const parentId = (node as { parentNode?: string }).parentNode;
      if (parentId) {
        const parentBounds = resolveBounds(parentId);
        if (parentBounds) {
          absoluteX += parentBounds.x;
          absoluteY += parentBounds.y;
        }
      }

      const computedBounds: NodeBounds = {
        x: absoluteX,
        y: absoluteY,
        width: Math.max(1, width),
        height: Math.max(1, height),
      };
      boundsById.set(nodeId, computedBounds);
      resolving.delete(nodeId);
      return computedBounds;
    };

    for (const node of nodeList) {
      resolveBounds(node.id);
    }
    return boundsById;
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

  /** Check if a node bounding box intersects viewport bounds */
  function isNodeInBounds(node: NodeBounds, bounds: ViewportBounds): boolean {
    return (
      node.x + node.width >= bounds.minX &&
      node.x <= bounds.maxX &&
      node.y + node.height >= bounds.minY &&
      node.y <= bounds.maxY
    );
  }

  /** Check if a point (edge anchor) is within viewport bounds */
  function isPointInBounds(pos: { x: number; y: number }, bounds: ViewportBounds): boolean {
    return (
      pos.x >= bounds.minX &&
      pos.x <= bounds.maxX &&
      pos.y >= bounds.minY &&
      pos.y <= bounds.maxY
    );
  }

  /** Liang-Barsky line clipping test against axis-aligned viewport rectangle */
  function segmentIntersectsBounds(
    start: { x: number; y: number },
    end: { x: number; y: number },
    bounds: ViewportBounds
  ): boolean {
    let t0 = 0;
    let t1 = 1;
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const clipTest = (p: number, q: number): boolean => {
      if (p === 0) {
        return q >= 0;
      }

      const ratio = q / p;
      if (p < 0) {
        if (ratio > t1) return false;
        if (ratio > t0) t0 = ratio;
      } else {
        if (ratio < t0) return false;
        if (ratio < t1) t1 = ratio;
      }
      return true;
    };

    return (
      clipTest(-dx, start.x - bounds.minX) &&
      clipTest(dx, bounds.maxX - start.x) &&
      clipTest(-dy, start.y - bounds.minY) &&
      clipTest(dy, bounds.maxY - start.y)
    );
  }

  function isEdgeSegmentInBounds(source: NodeBounds, target: NodeBounds, bounds: ViewportBounds): boolean {
    if (isNodeInBounds(source, bounds) || isNodeInBounds(target, bounds)) {
      return true;
    }

    const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    return segmentIntersectsBounds(sourceCenter, targetCenter, bounds);
  }

  function computeEdgeSignature(edgeList: GraphEdge[]): string {
    let hash = 0;
    for (const edge of edgeList) {
      const token = `${edge.id}|${edge.data?.type ?? ''}`;
      for (let i = 0; i < token.length; i += 1) {
        hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
      }
    }
    return `${edgeList.length}:${hash >>> 0}`;
  }

  function rebuildEdgePriorityOrder(edgeList: GraphEdge[]): void {
    const nextSignature = computeEdgeSignature(edgeList);
    if (nextSignature === edgePrioritySignature && edgePriorityOrder.length > 0) {
      return;
    }

    edgePrioritySignature = nextSignature;
    const nodeDegree = new Map<string, number>();
    for (const edge of edgeList) {
      nodeDegree.set(edge.source, (nodeDegree.get(edge.source) ?? 0) + 1);
      nodeDegree.set(edge.target, (nodeDegree.get(edge.target) ?? 0) + 1);
    }

    const scored: Array<{ id: string; score: number }> = [];
    for (const edge of edgeList) {
      const typePriority = EDGE_TYPE_PRIORITY[edge.data?.type ?? ''] ?? 0;
      const sourceDegree = nodeDegree.get(edge.source) ?? 0;
      const targetDegree = nodeDegree.get(edge.target) ?? 0;
      const score = typePriority * 100 + sourceDegree + targetDegree;
      scored.push({ id: edge.id, score });
    }

    scored.sort((a, b) => b.score - a.score);
    edgePriorityOrder = scored.map((entry) => entry.id);
  }

  function computeAdaptiveLowZoomBudget(zoom: number, visibleEdgeCount: number): number {
    const nav = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number })
      : null;
    const cores = nav?.hardwareConcurrency ?? 8;
    const memoryGb = nav?.deviceMemory ?? 8;

    let budget = LOW_ZOOM_BASE_MAX_EDGES;
    budget += Math.max(0, (cores - 4) * 24);
    budget += Math.max(0, (memoryGb - 4) * 18);

    if (zoom < 0.2) {
      budget = Math.round(budget * 0.55);
    } else if (zoom < LOW_ZOOM_THRESHOLD) {
      budget = Math.round(budget * 0.75);
    }

    budget = Math.min(LOW_ZOOM_MAX_BUDGET, Math.max(LOW_ZOOM_MIN_BUDGET, budget));
    return Math.max(LOW_ZOOM_MIN_BUDGET, Math.min(budget, visibleEdgeCount));
  }

  /** Apply priority-based thresholding for low zoom levels */
  function applyLowZoomThresholding(
    visibleEdgeIds: Set<string>,
    zoom: number
  ): Set<string> {
    const maxBudget = computeAdaptiveLowZoomBudget(zoom, visibleEdgeIds.size);
    if (visibleEdgeIds.size <= maxBudget) return visibleEdgeIds;

    const kept = new Set<string>();
    for (const edgeId of edgePriorityOrder) {
      if (!visibleEdgeIds.has(edgeId)) {
        continue;
      }
      kept.add(edgeId);
      if (kept.size >= maxBudget) {
        return kept;
      }
    }

    // Fallback: if cache misses IDs for any reason, fill from current set.
    for (const edgeId of visibleEdgeIds) {
      if (kept.size >= maxBudget) {
        break;
      }
      kept.add(edgeId);
    }

    return kept;
  }

  /** Core recalculation: determine which edges should be visible */
  function recalculate(): void {
    if (suspended) return;

    const edgeList = edges.value;
    const nodeList = nodes.value;

    // Skip virtualization for small graphs
    if (!enabled.value || edgeList.length < VIRTUALIZATION_THRESHOLD) {
      // Restore any edges we previously hid
      if (virtualizedHiddenIds.value.size > 0) {
        const restoreVisibilityMap = new Map<string, boolean>();
        virtualizedHiddenIds.value.forEach((edgeId) => {
          restoreVisibilityMap.set(edgeId, userHiddenIds.has(edgeId));
        });
        isWriting = true;
        setEdgeVisibility(restoreVisibilityMap);
        isWriting = false;
        virtualizedHiddenIds.value = new Set();
      }
      return;
    }

    const bounds = getViewportBounds();
    if (!bounds) return;

    const nodeBoundsMap = buildAbsoluteNodeBoundsMap(nodeList);
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

    // Determine which edges have at least one endpoint in viewport.
    // Prefer pre-computed anchor points (from layout worker) for accuracy;
    // fall back to node position map lookup when anchors aren't available.
    const viewportVisibleIds = new Set<string>();
    for (const edge of edgeList) {
      // Don't un-hide user-hidden edges
      if (userHiddenIds.has(edge.id)) continue;

      const sourceAnchor = edge.data?.sourceAnchor as { x: number; y: number } | undefined;
      const targetAnchor = edge.data?.targetAnchor as { x: number; y: number } | undefined;

      if (sourceAnchor && targetAnchor) {
        // Use exact anchor points — more accurate than node-center heuristic
        if (isPointInBounds(sourceAnchor, bounds) || isPointInBounds(targetAnchor, bounds)) {
          viewportVisibleIds.add(edge.id);
        } else if (segmentIntersectsBounds(sourceAnchor, targetAnchor, bounds)) {
          viewportVisibleIds.add(edge.id);
        }
        continue;
      }

      // Fallback: use absolute node bounds and segment-rectangle intersection
      const sourceBounds = nodeBoundsMap.get(edge.source);
      const targetBounds = nodeBoundsMap.get(edge.target);

      // If we can't find node bounds, keep the edge visible as a safety fallback
      if (!sourceBounds || !targetBounds) {
        viewportVisibleIds.add(edge.id);
        continue;
      }

      if (isEdgeSegmentInBounds(sourceBounds, targetBounds, bounds)) {
        viewportVisibleIds.add(edge.id);
      }
    }

    rebuildEdgePriorityOrder(edgeList);

    // Apply low-zoom thresholding if needed
    const finalVisibleIds = isLowZoom
      ? applyLowZoomThresholding(viewportVisibleIds, vp.zoom)
      : viewportVisibleIds;

    // Build the new hidden set and check if anything changed
    const newHiddenIds = new Set<string>();
    const visibilityMap = new Map<string, boolean>();
    edgeList.forEach((edge) => {
      if (userHiddenIds.has(edge.id)) {
        // Respect user filtering — don't touch these edges
        return;
      }

      const shouldBeHidden = !finalVisibleIds.has(edge.id);
      if (shouldBeHidden) {
        newHiddenIds.add(edge.id);
      }

      if (edge.hidden !== shouldBeHidden) {
        visibilityMap.set(edge.id, shouldBeHidden);
      }
    });

    virtualizedHiddenIds.value = newHiddenIds;
    if (visibilityMap.size > 0) {
      isWriting = true;
      setEdgeVisibility(visibilityMap);
      isWriting = false;
    }
  }

  const runRecalcFrame = (timestamp: number): void => {
    recalcRafId = null;
    if (suspended || !enabled.value || !recalcDirty) {
      return;
    }

    if (timestamp - lastRecalcTimestamp < RECALC_MIN_FRAME_GAP_MS) {
      recalcRafId = requestAnimationFrame(runRecalcFrame);
      return;
    }

    recalcDirty = false;
    lastRecalcTimestamp = timestamp;
    recalculate();

    if (recalcDirty && recalcRafId === null) {
      recalcRafId = requestAnimationFrame(runRecalcFrame);
    }
  };

  /** Schedule a throttled recalculation aligned to animation frames */
  function scheduleRecalc(): void {
    if (suspended) return;
    recalcDirty = true;
    if (recalcRafId === null) {
      recalcRafId = requestAnimationFrame(runRecalcFrame);
    }
  }

  // Re-run when nodes/edges change (e.g., after layout, filter toggle).
  // Skip when the change was caused by our own write (isWriting guard).
  // CRITICAL: flush: 'sync' ensures the callback fires synchronously during
  // setEdges() while isWriting is still true — preventing an infinite
  // watch → recalc → setEdges → watch cascade. With the default async
  // flush, isWriting is already false by the time the callback runs.
  const stopWatch: WatchStopHandle = watch([nodes, edges, enabled], () => {
    if (enabled.value && !isWriting) {
      rebuildEdgePriorityOrder(edges.value);
      scheduleRecalc();
    }
  }, { flush: 'sync' });

  rebuildEdgePriorityOrder(edges.value);

  const dispose = (): void => {
    suspended = true;
    recalcDirty = false;
    if (recalcRafId !== null) {
      cancelAnimationFrame(recalcRafId);
      recalcRafId = null;
    }
    stopWatch();
  };

  return {
    /** Call this when the viewport changes (pan, zoom) */
    onViewportChange: scheduleRecalc,
    /** Force an immediate recalculation */
    recalculate,
    /** Set of edge IDs currently hidden by virtualization */
    virtualizedHiddenCount: virtualizedHiddenIds,
    /** Suspend virtualization (e.g., during layout→fitView transitions) */
    suspend: () => {
      suspended = true;
      recalcDirty = false;
      if (recalcRafId !== null) {
        cancelAnimationFrame(recalcRafId);
        recalcRafId = null;
      }
    },
    /** Resume virtualization and immediately recalculate */
    resume: () => {
      suspended = false;
      scheduleRecalc();
    },
    /** Dispose watchers/timers on component teardown */
    dispose,
  };
}
