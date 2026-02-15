import { ref, watch } from 'vue';

import { measurePerformance } from '../utils/performanceMonitoring';
import {
  DEFAULT_EDGE_TYPE_PRIORITY,
  VIRTUALIZATION_THRESHOLD,
  buildEdgePriorityOrder,
  computeEdgePrioritySignature,
  computeEdgeVirtualizationResult,
  getDefaultEdgeVirtualizationConfigOverrides,
  getRecalcMinFrameGapMs,
} from './edgeVirtualizationCore';
import {
  applyRestoreVisibility,
  applyVirtualizationResult,
  collectUserHiddenEdgeIds,
} from './edgeVisibilityApply';

import type { Ref, WatchStopHandle } from 'vue';

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';
import type { GetContainerRect, GetViewport, SetEdgeVisibility } from './useEdgeVirtualizationWorker';

// ── Types (reused from worker where applicable) ──

/** Options for the main-thread edge virtualization composable. */
export interface UseEdgeVirtualizationOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  getViewport: GetViewport;
  getContainerRect: GetContainerRect;
  setEdgeVisibility: SetEdgeVisibility;
  enabled: Ref<boolean>;
}

/** Return type of useEdgeVirtualization (subset of worker return). */
export interface UseEdgeVirtualizationReturn {
  onViewportChange: () => void;
  recalculate: () => void;
  virtualizedHiddenCount: Ref<Set<string>>;
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
}

const RECALC_MIN_FRAME_GAP_MS = getRecalcMinFrameGapMs();
const PERF_MARKS_ENABLED = (import.meta.env['VITE_PERF_MARKS'] as string | undefined) === 'true';

/**
 * Composable that hides off-screen edges to reduce DOM element count.
 *
 * At high zoom levels where only a portion of the graph is visible,
 * this can remove 60-90% of edges from the DOM.
 *
 * At low zoom levels (< 0.3), it also applies priority-based thresholding
 * to keep only the most important edges visible.
 */
export function useEdgeVirtualization(options: UseEdgeVirtualizationOptions): UseEdgeVirtualizationReturn {
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
    const overrides = getDefaultEdgeVirtualizationConfigOverrides();
    edgePriorityOrder = buildEdgePriorityOrder(edgeList, overrides.edgeTypePriority ?? DEFAULT_EDGE_TYPE_PRIORITY);
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
        if (virtualizedHiddenIds.value.size > 0) {
          isWriting = true;
          applyRestoreVisibility(virtualizedHiddenIds.value, edgeList, setEdgeVisibility);
          isWriting = false;
          virtualizedHiddenIds.value = new Set();
        }
        return;
      }

      const collectedUserHidden = collectUserHiddenEdgeIds(edgeList, virtualizedHiddenIds.value);
      userHiddenIds.clear();
      collectedUserHidden.forEach((id) => userHiddenIds.add(id));

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
        config: getDefaultEdgeVirtualizationConfigOverrides(),
      });
      if (!result) return;

      virtualizedHiddenIds.value = result.hiddenEdgeIds;
      isWriting = true;
      applyVirtualizationResult(edgeList, result.hiddenEdgeIds, userHiddenIds, setEdgeVisibility);
      isWriting = false;
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
  };

  /** Schedule a throttled recalculation aligned to animation frames */
  function scheduleRecalc(): void {
    if (suspended) return;
    recalcDirty = true;
    recalcRafId ??= requestAnimationFrame(runRecalcFrame);
  }

  // Re-run when nodes/edges change (e.g., after layout, filter toggle).
  // Skip when the change was caused by our own write (isWriting guard).
  // CRITICAL: flush: 'sync' ensures the callback fires synchronously during
  // setEdges() while isWriting is still true — preventing an infinite
  // watch → recalc → setEdges → watch cascade. With the default async
  // flush, isWriting is already false by the time the callback runs.
  const stopWatch: WatchStopHandle = watch(
    [nodes, edges, enabled],
    () => {
      if (enabled.value && !isWriting) {
        rebuildEdgePriorityOrder(edges.value);
        scheduleRecalc();
      }
    },
    { flush: 'sync' }
  );

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
