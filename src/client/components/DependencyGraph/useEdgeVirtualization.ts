import { ref, watch } from 'vue';

import { measurePerformance } from '../../utils/performanceMonitoring';
import {
  buildEdgePriorityOrder,
  computeEdgePrioritySignature,
  computeEdgeVirtualizationResult,
  DEFAULT_EDGE_TYPE_PRIORITY,
} from './edgeVirtualizationCore';

import type { Ref, WatchStopHandle } from 'vue';

import type { DependencyNode, GraphEdge } from './types';

/** Minimum edge count before virtualization kicks in */
const VIRTUALIZATION_THRESHOLD = 200;

/** Padding in screen pixels around the viewport before edges are culled */
const VIEWPORT_PADDING_PX = 300;

const parseEnvInt = (key: string, fallback: number): number => {
  const raw = import.meta.env[key] as string | undefined;
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

/** Minimum frame spacing for recalculations */
const RECALC_MIN_FRAME_GAP_MS = parseEnvInt('VITE_EDGE_VIRTUALIZATION_MIN_FRAME_GAP_MS', 48);
const PERF_MARKS_ENABLED = (import.meta.env['VITE_PERF_MARKS'] as string | undefined) === 'true';

/** At zoom levels below this, apply edge count thresholding */
const LOW_ZOOM_THRESHOLD = 0.3;

/** Base visible-edge budget at low zoom (adapted per device + zoom) */
const LOW_ZOOM_BASE_MAX_EDGES = 500;
const LOW_ZOOM_MIN_BUDGET = 140;
const LOW_ZOOM_MAX_BUDGET = 900;

const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 100;

/** Edge type priority for thresholding (higher = kept longer) */
const EDGE_TYPE_PRIORITY = DEFAULT_EDGE_TYPE_PRIORITY;

interface UseEdgeVirtualizationOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  getViewport: () => { x: number; y: number; zoom: number };
  getContainerRect: () => DOMRect | null;
  setEdgeVisibility: (visibilityMap: Map<string, boolean>) => void;
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

  function rebuildEdgePriorityOrder(edgeList: GraphEdge[]): void {
    const nextSignature = computeEdgePrioritySignature(edgeList);
    if (nextSignature === edgePrioritySignature && edgePriorityOrder.length > 0) {
      return;
    }

    edgePrioritySignature = nextSignature;
    edgePriorityOrder = buildEdgePriorityOrder(edgeList, EDGE_TYPE_PRIORITY);
  }

  /** Core recalculation: determine which edges should be visible */
  function recalculate(): void {
    if (PERF_MARKS_ENABLED) {
      performance.mark('edge-virtualization-recalc-start');
    }

    try {
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

      // Snapshot which edges are currently user-hidden (by relationship filters)
      // so we don't accidentally un-hide them when they scroll into viewport.
      userHiddenIds.clear();
      for (const edge of edgeList) {
        if (edge.hidden && !virtualizedHiddenIds.value.has(edge.id)) {
          userHiddenIds.add(edge.id);
        }
      }

      rebuildEdgePriorityOrder(edgeList);
      const rect = getContainerRect();
      const vp = getViewport();
      const result = computeEdgeVirtualizationResult({
        nodes: nodeList,
        edges: edgeList,
        viewport: vp,
        containerSize: rect ? { width: rect.width, height: rect.height } : null,
        userHiddenEdgeIds: userHiddenIds,
        edgePriorityOrder,
        config: {
          viewportPaddingPx: VIEWPORT_PADDING_PX,
          lowZoomThreshold: LOW_ZOOM_THRESHOLD,
          lowZoomBaseMaxEdges: LOW_ZOOM_BASE_MAX_EDGES,
          lowZoomMinBudget: LOW_ZOOM_MIN_BUDGET,
          lowZoomMaxBudget: LOW_ZOOM_MAX_BUDGET,
          defaultNodeWidth: DEFAULT_NODE_WIDTH,
          defaultNodeHeight: DEFAULT_NODE_HEIGHT,
          edgeTypePriority: EDGE_TYPE_PRIORITY,
        },
      });
      if (!result) {
        return;
      }

      const visibilityMap = new Map<string, boolean>();
      edgeList.forEach((edge) => {
        if (userHiddenIds.has(edge.id)) {
          // Respect user filtering — don't touch these edges
          return;
        }

        const shouldBeHidden = result.hiddenEdgeIds.has(edge.id);

        if (edge.hidden !== shouldBeHidden) {
          visibilityMap.set(edge.id, shouldBeHidden);
        }
      });

      virtualizedHiddenIds.value = result.hiddenEdgeIds;
      if (visibilityMap.size > 0) {
        isWriting = true;
        setEdgeVisibility(visibilityMap);
        isWriting = false;
      }
    } finally {
      if (PERF_MARKS_ENABLED) {
        performance.mark('edge-virtualization-recalc-end');
        measurePerformance(
          'edge-virtualization-recalc',
          'edge-virtualization-recalc-start',
          'edge-virtualization-recalc-end'
        );
      }
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
