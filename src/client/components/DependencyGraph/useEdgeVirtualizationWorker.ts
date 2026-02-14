import { ref, watch } from 'vue';

import { measurePerformance } from '../../utils/performanceMonitoring';
import { DEFAULT_EDGE_TYPE_PRIORITY } from './edgeVirtualizationCore';

import type { Ref, WatchStopHandle } from 'vue';
import type {
  EdgeVirtualizationConfig,
  EdgeVirtualizationContainerSize,
  EdgeVirtualizationDeviceProfile,
  EdgeVirtualizationEdge,
  EdgeVirtualizationNode,
  EdgeVirtualizationViewport,
} from './edgeVirtualizationCore';
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

const EDGE_TYPE_PRIORITY = DEFAULT_EDGE_TYPE_PRIORITY;

interface UseEdgeVirtualizationWorkerOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  getViewport: () => { x: number; y: number; zoom: number };
  getContainerRect: () => DOMRect | null;
  setEdgeVisibility: (visibilityMap: Map<string, boolean>) => void;
  enabled: Ref<boolean>;
  onWorkerUnavailable?: (reason: string) => void;
}

interface SyncGraphMessage {
  type: 'sync-graph';
  payload: {
    nodes: EdgeVirtualizationNode[];
    edges: EdgeVirtualizationEdge[];
  };
}

interface RecalculateMessage {
  type: 'recalculate';
  requestId: number;
  payload: {
    recalcVersion: number;
    graphVersion: number;
    viewport: EdgeVirtualizationViewport;
    containerSize?: EdgeVirtualizationContainerSize | null;
    userHiddenEdgeIds: string[];
    config?: Partial<EdgeVirtualizationConfig>;
    deviceProfile?: EdgeVirtualizationDeviceProfile;
  };
}

type WorkerRequestMessage = SyncGraphMessage | RecalculateMessage;

interface RecalculateResultMessage {
  type: 'edge-visibility-result';
  requestId: number;
  payload: {
    recalcVersion: number;
    graphVersion: number;
    hiddenEdgeIds: string[];
    viewportVisibleCount: number;
    finalVisibleCount: number;
    lowZoomApplied: boolean;
    lowZoomBudget?: number;
  };
}

interface ErrorMessage {
  type: 'edge-visibility-error';
  requestId?: number;
  payload: {
    error: string;
  };
}

type WorkerResponseMessage = RecalculateResultMessage | ErrorMessage;

const buildWorkerConfig = (): Partial<EdgeVirtualizationConfig> => {
  return {
    viewportPaddingPx: VIEWPORT_PADDING_PX,
    lowZoomThreshold: LOW_ZOOM_THRESHOLD,
    lowZoomBaseMaxEdges: LOW_ZOOM_BASE_MAX_EDGES,
    lowZoomMinBudget: LOW_ZOOM_MIN_BUDGET,
    lowZoomMaxBudget: LOW_ZOOM_MAX_BUDGET,
    defaultNodeWidth: DEFAULT_NODE_WIDTH,
    defaultNodeHeight: DEFAULT_NODE_HEIGHT,
    edgeTypePriority: EDGE_TYPE_PRIORITY,
  };
};

const serializeNodesForWorker = (nodes: DependencyNode[]): EdgeVirtualizationNode[] => {
  return nodes.map((node) => {
    const nodeStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : undefined;
    const measured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
    const parentNode = (node as { parentNode?: string }).parentNode;
    const serialized: EdgeVirtualizationNode = {
      id: node.id,
    };

    if (node.position) {
      serialized.position = { x: node.position.x, y: node.position.y };
    }
    if (parentNode) {
      serialized.parentNode = parentNode;
    }
    if (nodeStyle) {
      serialized.style = {
        width: nodeStyle['width'],
        height: nodeStyle['height'],
      };
    }
    if (measured && (measured.width !== undefined || measured.height !== undefined)) {
      serialized.measured = {};
      if (measured.width !== undefined) {
        serialized.measured.width = measured.width;
      }
      if (measured.height !== undefined) {
        serialized.measured.height = measured.height;
      }
    }

    return serialized;
  });
};

const serializeEdgesForWorker = (edges: GraphEdge[]): EdgeVirtualizationEdge[] => {
  return edges.map((edge) => {
    const sourceAnchor = edge.data?.sourceAnchor as { x: number; y: number } | undefined;
    const targetAnchor = edge.data?.targetAnchor as { x: number; y: number } | undefined;
    const serialized: EdgeVirtualizationEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
    };

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
  const nav = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { deviceMemory?: number })
    : undefined;
  const profile: EdgeVirtualizationDeviceProfile = {};
  if (nav?.hardwareConcurrency !== undefined) {
    profile.hardwareConcurrency = nav.hardwareConcurrency;
  }
  if (nav?.deviceMemory !== undefined) {
    profile.deviceMemory = nav.deviceMemory;
  }
  return profile;
};

export function useEdgeVirtualizationWorker(options: UseEdgeVirtualizationWorkerOptions) {
  const { nodes, edges, getViewport, getContainerRect, setEdgeVisibility, enabled, onWorkerUnavailable } = options;

  const virtualizedHiddenIds = ref(new Set<string>());
  const userHiddenIds = new Set<string>();
  const stats = ref({
    mode: 'worker' as 'worker' | 'main-fallback',
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

    const currentUserHiddenIds = new Set<string>();
    for (const edge of edges.value) {
      if (edge.hidden && !virtualizedHiddenIds.value.has(edge.id)) {
        currentUserHiddenIds.add(edge.id);
      }
    }

    const restoreVisibilityMap = new Map<string, boolean>();
    virtualizedHiddenIds.value.forEach((edgeId) => {
      restoreVisibilityMap.set(edgeId, currentUserHiddenIds.has(edgeId));
    });

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
    const currentUserHiddenIds = new Set<string>();
    for (const edge of edges.value) {
      if (edge.hidden && !virtualizedHiddenIds.value.has(edge.id)) {
        currentUserHiddenIds.add(edge.id);
      }
    }

    if (PERF_MARKS_ENABLED) {
      performance.mark('apply-visibility-delta-start');
    }

    const visibilityMap = new Map<string, boolean>();
    edges.value.forEach((edge) => {
      if (currentUserHiddenIds.has(edge.id)) {
        return;
      }
      const shouldBeHidden = newHiddenIds.has(edge.id);
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

    userHiddenIds.clear();
    for (const edge of edgeList) {
      if (edge.hidden && !virtualizedHiddenIds.value.has(edge.id)) {
        userHiddenIds.add(edge.id);
      }
    }

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
        config: buildWorkerConfig(),
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
    if (recalcRafId === null) {
      recalcRafId = requestAnimationFrame(runRecalcFrame);
    }
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

  stopWatch = watch([nodes, edges, enabled], () => {
    if (isWriting || !enabled.value) {
      return;
    }

    graphVersion += 1;
    graphSyncPending = true;
    scheduleRecalc();
  }, { flush: 'sync' });

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

    stopWatch?.();
    stopEnabledWatch?.();
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
