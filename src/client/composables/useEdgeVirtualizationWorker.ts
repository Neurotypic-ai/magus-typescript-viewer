import { ref, watch } from 'vue';

import { measurePerformance } from '../../utils/performanceMonitoring';
import {
  VIRTUALIZATION_THRESHOLD,
  getDefaultEdgeVirtualizationConfigOverrides,
  getRecalcMinFrameGapMs,
} from './edgeVirtualizationCore';
import { buildRestoreVisibilityMap, buildVisibilityMap, collectUserHiddenEdgeIds } from './edgeVisibilityApply';

import type { Ref, WatchStopHandle } from 'vue';

import type {
  EdgeVirtualizationDeviceProfile,
  EdgeVirtualizationEdge,
  EdgeVirtualizationNode,
  EdgeVirtualizationPoint,
  EdgeVirtualizationViewport,
} from './edgeVirtualizationCore';
import type {
  RecalculateMessage,
  RecalculateResultMessage,
  SyncGraphMessage,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from './edgeVisibilityMessages';
import type { DependencyNode, GraphEdge } from '../types';

const RECALC_MIN_FRAME_GAP_MS = getRecalcMinFrameGapMs();
const PERF_MARKS_ENABLED = (import.meta.env['VITE_PERF_MARKS'] as string | undefined) === 'true';

// ── Options & callbacks ──

/** Returns current viewport (x, y, zoom). */
export type GetViewport = () => EdgeVirtualizationViewport;

/** Returns container rect or null. */
export type GetContainerRect = () => DOMRect | null;

/** Map of edge id → whether the edge is hidden. */
export type EdgeVisibilityMap = Map<string, boolean>;

/** Applies visibility map (edge id → hidden). */
export type SetEdgeVisibility = (visibilityMap: EdgeVisibilityMap) => void;

/** Called when the worker becomes unavailable. */
export type OnWorkerUnavailable = (reason: string) => void;

export interface UseEdgeVirtualizationWorkerOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  getViewport: GetViewport;
  getContainerRect: GetContainerRect;
  setEdgeVisibility: SetEdgeVisibility;
  enabled: Ref<boolean>;
  onWorkerUnavailable?: OnWorkerUnavailable;
}

// Re-export worker message types for public API
export type {
  EdgeVisibilityErrorPayload,
  EdgeVisibilityErrorMessage,
  EdgeVisibilityErrorMessageType,
  EdgeVisibilityResultMessageType,
  RecalculateMessage,
  RecalculatePayload,
  RecalculateResultMessage,
  RecalculateResultPayload,
  RecalculateMessageType,
  SyncGraphMessage,
  SyncGraphPayload,
  SyncGraphMessageType,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from './edgeVisibilityMessages';

// ── Stats & mode ──

/** Whether virtualization runs in worker or main-thread fallback. */
export type EdgeVirtualizationWorkerMode = 'worker' | 'main-fallback';

/** Stats exposed by the edge virtualization worker composable. */
export interface EdgeVirtualizationWorkerStats {
  mode: EdgeVirtualizationWorkerMode;
  requests: number;
  responses: number;
  staleResponses: number;
  lastVisibleCount: number;
  lastHiddenCount: number;
}

// ── Serialization (node/edge shapes read from DependencyNode / GraphEdge) ──

/** Measured width/height on a node (optional). */
export interface NodeMeasuredShape {
  width?: number;
  height?: number;
}

/** Node with optional measured dimensions (cast from DependencyNode). */
export interface NodeWithMeasured {
  measured?: NodeMeasuredShape;
}

/** Node with optional parent id (cast from DependencyNode). */
export interface NodeWithParentNode {
  parentNode?: string;
}

/** Style object shape used when serializing node for worker. */
export interface NodeStyleForSerialization {
  width?: unknown;
  height?: unknown;
}

/** Arbitrary style object on a node (e.g. Vue Flow node.style). */
export type NodeStyleRecord = Record<string, unknown>;

/** Navigator with optional deviceMemory (not in all TS libs). */
export interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

// ── Composable return ──

/** Return type of useEdgeVirtualizationWorker. */
export interface UseEdgeVirtualizationWorkerReturn {
  onViewportChange: () => void;
  recalculate: () => void;
  virtualizedHiddenCount: Ref<Set<string>>;
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
  stats: Ref<EdgeVirtualizationWorkerStats>;
}

const serializeNodesForWorker = (nodes: DependencyNode[]): EdgeVirtualizationNode[] => {
  return nodes.map((node) => {
    const nodeStyle = typeof node.style === 'object' ? (node.style as NodeStyleRecord) : undefined;
    const measured = (node as unknown as NodeWithMeasured).measured;
    const parentNode = (node as NodeWithParentNode).parentNode;
    const serialized: EdgeVirtualizationNode = {
      id: node.id,
    };

    serialized.position = { x: node.position.x, y: node.position.y };
    if (parentNode) {
      serialized.parentNode = parentNode;
    }
    if (nodeStyle) {
      const style: NodeStyleForSerialization = {
        width: nodeStyle['width'],
        height: nodeStyle['height'],
      };
      serialized.style = style;
    }
    if (measured && (measured.width !== undefined || measured.height !== undefined)) {
      const m: NodeMeasuredShape = {};
      if (measured.width !== undefined) m.width = measured.width;
      if (measured.height !== undefined) m.height = measured.height;
      serialized.measured = m;
    }

    return serialized;
  });
};

const serializeEdgesForWorker = (edges: GraphEdge[]): EdgeVirtualizationEdge[] => {
  return edges.map((edge) => {
    const sourceAnchor = edge.data?.sourceAnchor as EdgeVirtualizationPoint | undefined;
    const targetAnchor = edge.data?.targetAnchor as EdgeVirtualizationPoint | undefined;
    const serialized: EdgeVirtualizationEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
    };
    if (edge.sourceHandle) {
      serialized.sourceHandle = edge.sourceHandle;
    }
    if (edge.targetHandle) {
      serialized.targetHandle = edge.targetHandle;
    }

    if (edge.hidden !== undefined) {
      serialized.hidden = edge.hidden;
    }

    const data: EdgeVirtualizationEdge['data'] = {};
    if (edge.data?.type) {
      data.type = edge.data.type;
    }
    if (sourceAnchor) {
      data.sourceAnchor = sourceAnchor;
    }
    if (targetAnchor) {
      data.targetAnchor = targetAnchor;
    }
    if (Object.keys(data).length > 0) {
      serialized.data = data;
    }

    return serialized;
  });
};

const getDeviceProfile = (): EdgeVirtualizationDeviceProfile => {
  const nav = typeof navigator !== 'undefined' ? (navigator as NavigatorWithDeviceMemory) : undefined;
  const profile: EdgeVirtualizationDeviceProfile = {};
  if (nav?.hardwareConcurrency !== undefined) {
    profile.hardwareConcurrency = nav.hardwareConcurrency;
  }
  if (nav?.deviceMemory !== undefined) {
    profile.deviceMemory = nav.deviceMemory;
  }
  return profile;
};

export function useEdgeVirtualizationWorker(
  options: UseEdgeVirtualizationWorkerOptions
): UseEdgeVirtualizationWorkerReturn {
  const { nodes, edges, getViewport, getContainerRect, setEdgeVisibility, enabled, onWorkerUnavailable } = options;

  const virtualizedHiddenIds = ref(new Set<string>());
  const userHiddenIds = new Set<string>();
  const stats = ref<EdgeVirtualizationWorkerStats>({
    mode: 'worker',
    requests: 0,
    responses: 0,
    staleResponses: 0,
    lastVisibleCount: 0,
    lastHiddenCount: 0,
  });

  let worker: Worker | null = null;
  let workerUnavailable = false;
  let unavailableNotified = false;
  let workerRequestInFlightId: number | null = null;
  let nextRequestId = 0;
  let recalcVersion = 0;
  let graphVersion = 0;
  let graphSyncPending = true;
  let isWriting = false;
  let suspended = false;
  let recalcDirty = false;
  let recalcRafId: number | null = null;
  let lastRecalcTimestamp = 0;
  let stopWatch: WatchStopHandle | null = null;
  let stopEnabledWatch: WatchStopHandle | null = null;

  const notifyWorkerUnavailable = (reason: string): void => {
    if (workerUnavailable) {
      return;
    }
    workerUnavailable = true;
    stats.value.mode = 'main-fallback';
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (!unavailableNotified) {
      unavailableNotified = true;
      onWorkerUnavailable?.(reason);
    }
  };

  const restoreVirtualizedEdges = (): void => {
    if (virtualizedHiddenIds.value.size === 0) {
      return;
    }

    const restoreVisibilityMap = buildRestoreVisibilityMap(virtualizedHiddenIds.value, edges.value);

    if (restoreVisibilityMap.size === 0) {
      virtualizedHiddenIds.value = new Set<string>();
      return;
    }

    isWriting = true;
    setEdgeVisibility(restoreVisibilityMap);
    isWriting = false;
    virtualizedHiddenIds.value = new Set<string>();
  };

  const sendGraphSnapshot = (): void => {
    if (!worker || workerUnavailable) {
      return;
    }
    const message: SyncGraphMessage = {
      type: 'sync-graph',
      payload: {
        nodes: serializeNodesForWorker(nodes.value),
        edges: serializeEdgesForWorker(edges.value),
      },
    };
    worker.postMessage(message);
    graphSyncPending = false;
  };

  const applyWorkerResult = (message: RecalculateResultMessage): void => {
    const payload = message.payload;
    if (payload.graphVersion !== graphVersion || payload.recalcVersion !== recalcVersion) {
      stats.value.staleResponses += 1;
      return;
    }

    const newHiddenIds = new Set(payload.hiddenEdgeIds);
    const currentUserHiddenIds = collectUserHiddenEdgeIds(edges.value, virtualizedHiddenIds.value);

    if (PERF_MARKS_ENABLED) {
      performance.mark('apply-visibility-delta-start');
    }

    const visibilityMap = buildVisibilityMap(edges.value, newHiddenIds, currentUserHiddenIds);

    virtualizedHiddenIds.value = newHiddenIds;
    if (visibilityMap.size > 0) {
      isWriting = true;
      setEdgeVisibility(visibilityMap);
      isWriting = false;
    }

    stats.value.responses += 1;
    stats.value.lastVisibleCount = payload.finalVisibleCount;
    stats.value.lastHiddenCount = newHiddenIds.size;

    if (PERF_MARKS_ENABLED) {
      performance.mark('apply-visibility-delta-end');
      measurePerformance('apply-visibility-delta', 'apply-visibility-delta-start', 'apply-visibility-delta-end');
    }
  };

  const onWorkerMessage = (event: MessageEvent<WorkerResponseMessage>): void => {
    const message = event.data;
    if (message.type === 'edge-visibility-error') {
      const reason = message.payload.error || 'Worker returned edge visibility error';
      notifyWorkerUnavailable(reason);
      return;
    }

    if (workerRequestInFlightId !== message.requestId) {
      stats.value.staleResponses += 1;
      return;
    }

    workerRequestInFlightId = null;
    if (PERF_MARKS_ENABLED) {
      performance.mark('worker-roundtrip-end');
      measurePerformance('worker-roundtrip', 'worker-roundtrip-start', 'worker-roundtrip-end');
    }

    applyWorkerResult(message);

    if (recalcDirty && recalcRafId === null) {
      recalcRafId = requestAnimationFrame(runRecalcFrame);
    }
  };

  const dispatchWorkerRecalc = (): void => {
    if (suspended || workerUnavailable) {
      return;
    }

    const edgeList = edges.value;
    if (!enabled.value || edgeList.length < VIRTUALIZATION_THRESHOLD) {
      restoreVirtualizedEdges();
      recalcDirty = false;
      return;
    }

    if (!worker) {
      notifyWorkerUnavailable('Edge visibility worker is not initialized');
      return;
    }

    const collectedUserHidden = collectUserHiddenEdgeIds(edgeList, virtualizedHiddenIds.value);
    userHiddenIds.clear();
    collectedUserHidden.forEach((id) => userHiddenIds.add(id));

    if (graphSyncPending) {
      sendGraphSnapshot();
    }

    recalcDirty = false;
    const requestId = ++nextRequestId;
    workerRequestInFlightId = requestId;
    const rect = getContainerRect();
    const message: RecalculateMessage = {
      type: 'recalculate',
      requestId,
      payload: {
        recalcVersion,
        graphVersion,
        viewport: getViewport(),
        containerSize: rect ? { width: rect.width, height: rect.height } : null,
        userHiddenEdgeIds: [...userHiddenIds],
        config: getDefaultEdgeVirtualizationConfigOverrides(),
        deviceProfile: getDeviceProfile(),
      },
    };

    if (PERF_MARKS_ENABLED) {
      performance.mark('worker-roundtrip-start');
    }

    stats.value.requests += 1;
    worker.postMessage(message as WorkerRequestMessage);
  };

  const runRecalcFrame = (timestamp: number): void => {
    recalcRafId = null;

    if (suspended || workerUnavailable || !recalcDirty || !enabled.value) {
      return;
    }

    if (workerRequestInFlightId !== null) {
      recalcRafId = requestAnimationFrame(runRecalcFrame);
      return;
    }

    if (timestamp - lastRecalcTimestamp < RECALC_MIN_FRAME_GAP_MS) {
      recalcRafId = requestAnimationFrame(runRecalcFrame);
      return;
    }

    lastRecalcTimestamp = timestamp;
    dispatchWorkerRecalc();
  };

  const scheduleRecalc = (): void => {
    if (suspended || workerUnavailable) {
      return;
    }
    recalcDirty = true;
    recalcVersion += 1;
    recalcRafId ??= requestAnimationFrame(runRecalcFrame);
  };

  const recalculate = (): void => {
    if (workerUnavailable) {
      return;
    }
    recalcVersion += 1;
    recalcDirty = true;
    if (workerRequestInFlightId !== null) {
      return;
    }
    dispatchWorkerRecalc();
  };

  try {
    if (typeof Worker === 'undefined') {
      notifyWorkerUnavailable('Web workers are not supported in this environment');
    } else {
      worker = new Worker(new URL('../../workers/EdgeVisibilityWorker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', onWorkerMessage);
      worker.addEventListener('error', (error) => {
        const reason = error.message || 'Edge visibility worker crashed';
        notifyWorkerUnavailable(reason);
      });
    }
  } catch (error) {
    notifyWorkerUnavailable(error instanceof Error ? error.message : 'Failed to initialize edge visibility worker');
  }

  stopWatch = watch(
    [nodes, edges, enabled],
    () => {
      if (isWriting || !enabled.value) {
        return;
      }

      graphVersion += 1;
      graphSyncPending = true;
      scheduleRecalc();
    },
    { flush: 'sync' }
  );

  stopEnabledWatch = watch(enabled, (isEnabled) => {
    if (isEnabled) {
      return;
    }
    restoreVirtualizedEdges();
  });

  const suspend = (): void => {
    suspended = true;
    recalcDirty = false;
    if (recalcRafId !== null) {
      cancelAnimationFrame(recalcRafId);
      recalcRafId = null;
    }
  };

  const resume = (): void => {
    suspended = false;
    if (enabled.value) {
      scheduleRecalc();
    }
  };

  const dispose = (): void => {
    suspended = true;
    recalcDirty = false;
    if (recalcRafId !== null) {
      cancelAnimationFrame(recalcRafId);
      recalcRafId = null;
    }

    stopWatch();
    stopEnabledWatch();
    if (worker) {
      worker.terminate();
      worker = null;
    }
  };

  return {
    onViewportChange: scheduleRecalc,
    recalculate,
    virtualizedHiddenCount: virtualizedHiddenIds,
    suspend,
    resume,
    dispose,
    stats,
  };
}
