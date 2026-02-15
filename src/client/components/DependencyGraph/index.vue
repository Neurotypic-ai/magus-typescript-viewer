<script setup lang="ts">
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MarkerType, Panel, Position, VueFlow, applyNodeChanges, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from 'vue';

import { createLogger } from '../../../shared/utils/logger';
import { buildParentMap } from '../../graph/cluster/folderMembership';
import { clusterByFolder } from '../../graph/cluster/folders';
import { applyEdgeHighways, optimizeHighwayHandleRouting } from '../../graph/transforms/edgeHighways';
import { traverseGraph } from '../../graph/traversal';
import { WebWorkerLayoutProcessor } from '../../layout/WebWorkerLayoutProcessor';
import { useGraphSettings } from '../../stores/graphSettings';
import { useGraphStore } from '../../stores/graphStore';
import { useInsightsStore } from '../../stores/insightsStore';
import { useIssuesStore } from '../../stores/issuesStore';
import { getEdgeStyle, getNodeStyle, graphTheme } from '../../theme/graphTheme';
import { measurePerformance } from '../../utils/performanceMonitoring';
import {
  applyEdgeVisibility,
  buildOverviewGraph,
  buildSymbolDrilldownGraph,
  filterNodeChangesForFolderMode,
  toDependencyEdgeKind,
} from './buildGraphView';
import CanvasEdgeLayer from './components/CanvasEdgeLayer.vue';
import GraphControls from './components/GraphControls.vue';
import GraphSearch from './components/GraphSearch.vue';
import InsightsDashboard from './components/InsightsDashboard.vue';
import IssuesPanel from './components/IssuesPanel.vue';
import NodeContextMenu from './components/NodeContextMenu.vue';
import NodeDetails from './components/NodeDetails.vue';
import { nodeTypes } from './nodes/nodes';
import {
  FOLDER_COLLAPSE_ACTIONS_KEY,
  HIGHLIGHT_ORPHAN_GLOBAL_KEY,
  ISOLATE_EXPAND_ALL_KEY,
  NODE_ACTIONS_KEY,
} from './nodes/utils';
import { useEdgeVirtualization } from './useEdgeVirtualization';
import { useEdgeVirtualizationWorker } from './useEdgeVirtualizationWorker';
import { useFpsCounter } from './useFpsCounter';
import { useGraphInteractionController } from './useGraphInteractionController';
import { createNodeDimensionTracker, isContainerNode } from './useNodeDimensions';
import { classifyWheelIntent, isMacPlatform } from './utils/wheelIntent';
import { resolveCollisions, buildPositionMap, DEFAULT_COLLISION_CONFIG } from './layout/collisionResolver';
import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from './layout/edgeGeometryPolicy';
import type { BoundsNode } from './layout/geometryBounds';

import type { DefaultEdgeOptions, NodeChange } from '@vue-flow/core';
import type { ManualOffset } from '../../stores/graphStore';

import type { DependencyKind, DependencyNode, DependencyPackageGraph, GraphEdge, SearchResult } from './types';

import '@vue-flow/controls/dist/style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

const graphLogger = createLogger('DependencyGraph');

export interface DependencyGraphProps {
  data: DependencyPackageGraph;
}

interface LayoutProcessOptions {
  fitViewToResult?: boolean;
  fitPadding?: number;
  fitNodes?: string[];
  twoPassMeasure?: boolean;
}

const props = defineProps<DependencyGraphProps>();

const graphStore = useGraphStore();
const graphSettings = useGraphSettings();
const issuesStore = useIssuesStore();
const insightsStore = useInsightsStore();
const interaction = useGraphInteractionController();

const contextMenu = ref<{ nodeId: string; nodeLabel: string; x: number; y: number } | null>(null);

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

const parseEnvBoolean = (key: string, fallback: boolean): boolean => {
  const raw = import.meta.env[key] as string | undefined;
  if (!raw) {
    return fallback;
  }

  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
};

const EDGE_VISIBLE_RENDER_THRESHOLD = parseEnvInt('VITE_EDGE_VISIBLE_RENDER_THRESHOLD', 1400);
const MINIMAP_AUTO_HIDE_EDGE_THRESHOLD = 2800;
const HEAVY_EDGE_STYLE_THRESHOLD = 2200;
const HIGH_EDGE_MARKER_THRESHOLD = 1800;
const LOW_DETAIL_EDGE_ZOOM_THRESHOLD = 0.35;
const EDGE_RENDERER_FALLBACK_EDGE_THRESHOLD = parseEnvInt('VITE_CANVAS_EDGE_THRESHOLD', 2200);
const NODE_VISIBLE_RENDER_THRESHOLD = parseEnvInt('VITE_NODE_VISIBLE_RENDER_THRESHOLD', 320);
const EDGE_RENDERER_MODE = (import.meta.env['VITE_EDGE_RENDER_MODE'] as string | undefined) ?? 'svg';
const EDGE_VIRTUALIZATION_MODE = (import.meta.env['VITE_EDGE_VIRTUALIZATION_MODE'] as string | undefined) === 'worker'
  ? 'worker'
  : 'main';
const USE_CSS_SELECTION_HOVER = parseEnvBoolean('VITE_USE_CSS_SELECTION_HOVER', true);
const PERF_MARKS_ENABLED = parseEnvBoolean('VITE_PERF_MARKS', false);
const EDGE_VIEWPORT_RECALC_THROTTLE_MS = parseEnvInt('VITE_EDGE_VIEWPORT_RECALC_THROTTLE_MS', 80);
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.5 };
const MIN_GRAPH_ZOOM = 0.1;
const MAX_GRAPH_ZOOM = 2;
const MAC_PINCH_ZOOM_SENSITIVITY = 0.014;
const MAC_MOUSE_WHEEL_ZOOM_SENSITIVITY = 0.006;
const MAX_ZOOM_DELTA_PER_EVENT = 140;

const nodes = computed(() => graphStore['nodes']);
const edges = computed(() => graphStore['edges']);
const selectedNode = computed(() => graphStore['selectedNode']);
const scopeMode = computed(() => interaction.scopeMode.value);
const isLayoutPending = ref(false);

// ---- Collision resolution state & thresholds ----
const LIVE_SETTLE_NODE_THRESHOLD = 350;
const LIVE_SETTLE_MIN_INTERVAL_MS = 32;
const DRAG_END_ONLY_THRESHOLD = 700;
const DRAG_POSITION_EPSILON = 0.01;
const isApplyingCollisionResolution = ref(false);
const activeDraggedNodeIds = ref<Set<string>>(new Set());
const userPinnedNodeIds = ref<Set<string>>(new Set());
let collisionSettleRafId: number | null = null;
let collisionDimensionTimer: ReturnType<typeof setTimeout> | null = null;
let lastCollisionSettleTime = 0;

const { fitView, updateNodeInternals, panBy, zoomTo, getViewport, setViewport, removeSelectedElements, getNodes: getVueFlowNodes } = useVueFlow();

const isMac = computed(() => isMacPlatform());
const graphRootRef = ref<HTMLElement | null>(null);
const edgeVirtualizationEnabled = ref(true);
const edgeVirtualizationRuntimeMode = ref<'main' | 'worker'>(EDGE_VIRTUALIZATION_MODE);
const edgeVirtualizationMainEnabled = computed(() => {
  return edgeVirtualizationEnabled.value && edgeVirtualizationRuntimeMode.value === 'main';
});
const edgeVirtualizationWorkerEnabled = computed(() => {
  return edgeVirtualizationEnabled.value && edgeVirtualizationRuntimeMode.value === 'worker';
});
const isPanning = ref(false);
const isIsolateAnimating = ref(false);
const isolateExpandAll = ref(false);
const isLayoutMeasuring = ref(false);
const canvasRendererAvailable = ref(true);
let isolateAnimatingTimer: ReturnType<typeof setTimeout> | null = null;
const showFps = computed(() => graphSettings.showFps);
const viewportState = ref({ ...DEFAULT_VIEWPORT });
const { fps, fpsHistory, fpsStats, start: startFps, stop: stopFps } = useFpsCounter(showFps);
const FPS_CHART_WIDTH = 220;
const FPS_CHART_HEIGHT = 56;
let panEndTimer: ReturnType<typeof setTimeout> | null = null;
let selectionHighlightRafId: number | null = null;
let viewportSyncRafId: number | null = null;
let edgeViewportRecalcTimer: ReturnType<typeof setTimeout> | null = null;
let lastEdgeViewportRecalcAt = 0;
const nodeDimensionTracker = createNodeDimensionTracker();

const fpsChartScaleMax = computed(() => {
  if (!fpsHistory.value.length) {
    return 60;
  }
  return Math.max(60, ...fpsHistory.value);
});

const fpsChartPoints = computed(() => {
  const samples = fpsHistory.value;
  if (!samples.length) {
    return '';
  }

  const maxScale = fpsChartScaleMax.value;
  if (samples.length === 1) {
    const normalized = Math.max(0, Math.min(samples[0]! / maxScale, 1));
    const y = FPS_CHART_HEIGHT - normalized * FPS_CHART_HEIGHT;
    return `0.0,${y.toFixed(1)} ${FPS_CHART_WIDTH.toFixed(1)},${y.toFixed(1)}`;
  }

  const step = FPS_CHART_WIDTH / (samples.length - 1);
  return samples
    .map((sample, index) => {
      const normalized = Math.max(0, Math.min(sample / maxScale, 1));
      const x = index * step;
      const y = FPS_CHART_HEIGHT - normalized * FPS_CHART_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
});

const fpsTargetLineY = computed(() => {
  const ratio = Math.min(60 / fpsChartScaleMax.value, 1);
  return (FPS_CHART_HEIGHT - ratio * FPS_CHART_HEIGHT).toFixed(1);
});

// Edge virtualization: hides off-screen edges to reduce DOM count.
// Uses passed-in getters to avoid direct dependency on DOM state at init time.
const handleEdgeVirtualizationWorkerUnavailable = (reason: string): void => {
  if (edgeVirtualizationRuntimeMode.value !== 'worker') {
    return;
  }
  edgeVirtualizationRuntimeMode.value = 'main';
  graphLogger.warn(`Edge visibility worker unavailable (${reason}). Falling back to main-thread virtualization.`);
};

const mainEdgeVirtualization = useEdgeVirtualization({
  nodes: computed(() => graphStore['nodes']),
  edges: computed(() => graphStore['edges']),
  getViewport,
  getContainerRect: () => cachedContainerRect,
  setEdgeVisibility: (visibilityMap) => graphStore.setEdgeVisibility(visibilityMap),
  enabled: edgeVirtualizationMainEnabled,
});

const workerEdgeVirtualization = useEdgeVirtualizationWorker({
  nodes: computed(() => graphStore['nodes']),
  edges: computed(() => graphStore['edges']),
  getViewport,
  getContainerRect: () => cachedContainerRect,
  setEdgeVisibility: (visibilityMap) => graphStore.setEdgeVisibility(visibilityMap),
  enabled: edgeVirtualizationWorkerEnabled,
  onWorkerUnavailable: handleEdgeVirtualizationWorkerUnavailable,
});
const edgeVirtualizationWorkerStats = computed(() => workerEdgeVirtualization.stats.value);

const onEdgeVirtualizationViewportChange = (): void => {
  if (edgeVirtualizationRuntimeMode.value === 'worker') {
    workerEdgeVirtualization.onViewportChange();
    return;
  }
  mainEdgeVirtualization.onViewportChange();
};

const suspendEdgeVirtualization = (): void => {
  mainEdgeVirtualization.suspend();
  workerEdgeVirtualization.suspend();
};

const resumeEdgeVirtualization = (): void => {
  if (edgeVirtualizationRuntimeMode.value === 'worker') {
    workerEdgeVirtualization.resume();
    return;
  }
  mainEdgeVirtualization.resume();
};

const disposeEdgeVirtualization = (): void => {
  mainEdgeVirtualization.dispose();
  workerEdgeVirtualization.dispose();
};

const syncViewportState = (): void => {
  viewportState.value = { ...getViewport() };
};

const requestEdgeVirtualizationViewportRecalc = (force = false): void => {
  if (!edgeVirtualizationEnabled.value) {
    return;
  }

  const runRecalc = () => {
    if (PERF_MARKS_ENABLED) {
      performance.mark('edge-virtualization-viewport-sync-start');
    }
    onEdgeVirtualizationViewportChange();
    if (PERF_MARKS_ENABLED) {
      performance.mark('edge-virtualization-viewport-sync-end');
      measurePerformance(
        'edge-virtualization-viewport-sync',
        'edge-virtualization-viewport-sync-start',
        'edge-virtualization-viewport-sync-end'
      );
    }
  };

  if (force) {
    if (edgeViewportRecalcTimer) {
      clearTimeout(edgeViewportRecalcTimer);
      edgeViewportRecalcTimer = null;
    }
    lastEdgeViewportRecalcAt = performance.now();
    runRecalc();
    return;
  }

  const now = performance.now();
  const elapsed = now - lastEdgeViewportRecalcAt;
  if (elapsed >= EDGE_VIEWPORT_RECALC_THROTTLE_MS) {
    lastEdgeViewportRecalcAt = now;
    runRecalc();
    return;
  }

  if (edgeViewportRecalcTimer) {
    return;
  }

  edgeViewportRecalcTimer = setTimeout(() => {
    edgeViewportRecalcTimer = null;
    lastEdgeViewportRecalcAt = performance.now();
    runRecalc();
  }, Math.max(0, EDGE_VIEWPORT_RECALC_THROTTLE_MS - elapsed));
};

const scheduleViewportStateSync = (): void => {
  if (viewportSyncRafId !== null) {
    return;
  }

  viewportSyncRafId = requestAnimationFrame(() => {
    viewportSyncRafId = null;
    syncViewportState();
  });
};

const clampZoomLevel = (zoom: number): number => {
  return Math.max(MIN_GRAPH_ZOOM, Math.min(MAX_GRAPH_ZOOM, zoom));
};

const computeZoomFromDelta = (currentZoom: number, deltaY: number, sensitivity: number): number => {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return currentZoom;
  }

  const boundedDelta = Math.max(-MAX_ZOOM_DELTA_PER_EVENT, Math.min(MAX_ZOOM_DELTA_PER_EVENT, deltaY));
  return clampZoomLevel(currentZoom * Math.exp(-boundedDelta * sensitivity));
};

const applyZoomAtPointer = (
  event: WheelEvent,
  currentViewport: { x: number; y: number; zoom: number },
  nextZoom: number
): void => {
  if (nextZoom === currentViewport.zoom) {
    return;
  }

  if (cachedFlowContainer && cachedContainerRect) {
    const cursorX = event.clientX - cachedContainerRect.left;
    const cursorY = event.clientY - cachedContainerRect.top;
    const scale = nextZoom / currentViewport.zoom;
    const nextViewport = {
      x: cursorX - (cursorX - currentViewport.x) * scale,
      y: cursorY - (cursorY - currentViewport.y) * scale,
      zoom: nextZoom,
    };
    viewportState.value = nextViewport;
    void setViewport(nextViewport, { duration: 0 });
  } else {
    void zoomTo(nextZoom, { duration: 0 });
    syncViewportState();
  }

  requestEdgeVirtualizationViewportRecalc();
};

const isCanvasModeRequested = computed(() => {
  return EDGE_RENDERER_MODE === 'hybrid-canvas' || EDGE_RENDERER_MODE === 'hybrid-canvas-experimental';
});

const isHybridCanvasMode = computed(() => {
  return (
    canvasRendererAvailable.value &&
    isCanvasModeRequested.value &&
    edges.value.length >= EDGE_RENDERER_FALLBACK_EDGE_THRESHOLD
  );
});

const handleCanvasUnavailable = (): void => {
  if (!canvasRendererAvailable.value) {
    return;
  }
  canvasRendererAvailable.value = false;
  graphLogger.warn('Canvas edge renderer unavailable, falling back to SVG edges.');
};

const renderedEdges = computed(() => {
  if (!isHybridCanvasMode.value) {
    return visualEdges.value;
  }

  if (highlightedEdgeIds.value.size === 0) {
    return [];
  }

  return visualEdges.value.filter((edge) => highlightedEdgeIds.value.has(edge.id));
});
const useOnlyRenderVisibleElements = computed(() => {
  // During two-pass layout measurement all nodes must stay mounted so
  // measureAllNodeDimensions can capture complete sizes.
  if (isLayoutMeasuring.value) {
    return false;
  }

  if (isHybridCanvasMode.value) {
    return false;
  }

  return (
    (edgeVirtualizationEnabled.value && edges.value.length >= EDGE_VISIBLE_RENDER_THRESHOLD) ||
    nodes.value.length >= NODE_VISIBLE_RENDER_THRESHOLD
  );
});
const isHeavyEdgeMode = computed(() => edges.value.length >= HEAVY_EDGE_STYLE_THRESHOLD);
const minimapAutoHidden = computed(() => edges.value.length >= MINIMAP_AUTO_HIDE_EDGE_THRESHOLD);
const showMiniMap = computed(() => !isHybridCanvasMode.value && !minimapAutoHidden.value);

const defaultEdgeOptions = computed<DefaultEdgeOptions>(() => {
  const lowDetailEdges =
    isHybridCanvasMode.value ||
    edges.value.length >= HIGH_EDGE_MARKER_THRESHOLD ||
    viewportState.value.zoom < LOW_DETAIL_EDGE_ZOOM_THRESHOLD;

  if (lowDetailEdges) {
    return {
      zIndex: 2,
      type: 'straight',
    };
  }

  return {
    markerEnd: { type: MarkerType.ArrowClosed, width: EDGE_MARKER_WIDTH_PX, height: EDGE_MARKER_HEIGHT_PX },
    zIndex: 2,
    type: 'smoothstep',
  };
});

const onMoveStart = (): void => {
  if (panEndTimer) clearTimeout(panEndTimer);
  isPanning.value = true;
};

const onMove = (): void => {
  scheduleViewportStateSync();
  requestEdgeVirtualizationViewportRecalc();
};

const onMoveEnd = (): void => {
  // Short delay before removing panning class to avoid flicker on quick gestures
  if (panEndTimer) clearTimeout(panEndTimer);
  panEndTimer = setTimeout(() => {
    isPanning.value = false;
    syncViewportState();
    // Force a final recalc at the settled viewport position
    requestEdgeVirtualizationViewportRecalc(true);
  }, 120);
};

let layoutProcessor: WebWorkerLayoutProcessor | null = null;
let layoutRequestVersion = 0;
let graphInitPromise: Promise<void> | null = null;
let graphInitQueued = false;
const nodeMeasurementCache = new Map<string, { width: number; height: number; topInset: number }>();

interface SearchHighlightState {
  hasResults: boolean;
  hasPath: boolean;
  matchingNodeIds: Set<string>;
  pathNodeIds: Set<string>;
  matchingEdgeIds: Set<string>;
}

const searchHighlightState = reactive<SearchHighlightState>({
  hasResults: false,
  hasPath: false,
  matchingNodeIds: new Set<string>(),
  pathNodeIds: new Set<string>(),
  matchingEdgeIds: new Set<string>(),
});

interface SelectionAdjacency {
  connectedNodeIds: Set<string>;
  connectedEdgeIds: Set<string>;
}

const selectionAdjacencyByNodeId = computed(() => {
  const adjacency = new Map<string, SelectionAdjacency>();

  const ensureEntry = (nodeId: string): SelectionAdjacency => {
    let entry = adjacency.get(nodeId);
    if (!entry) {
      entry = {
        connectedNodeIds: new Set<string>(),
        connectedEdgeIds: new Set<string>(),
      };
      adjacency.set(nodeId, entry);
    }
    return entry;
  };

  for (const edge of edges.value) {
    if (edge.hidden) {
      continue;
    }

    const sourceEntry = ensureEntry(edge.source);
    sourceEntry.connectedNodeIds.add(edge.target);
    sourceEntry.connectedEdgeIds.add(edge.id);

    const targetEntry = ensureEntry(edge.target);
    targetEntry.connectedNodeIds.add(edge.source);
    targetEntry.connectedEdgeIds.add(edge.id);
  }

  // Resolve group (folder) nodes: selecting a folder highlights its children,
  // all edges touching children, and the external nodes on those edges.
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes.value) {
    if (node.parentNode) {
      const children = childrenByParent.get(node.parentNode);
      if (children) {
        children.push(node.id);
      } else {
        childrenByParent.set(node.parentNode, [node.id]);
      }
    }
  }

  for (const [groupId, childIds] of childrenByParent) {
    const groupEntry = ensureEntry(groupId);
    const childSet = new Set(childIds);

    // Add all children as connected
    for (const childId of childIds) {
      groupEntry.connectedNodeIds.add(childId);

      // Pull in the child's edges and external neighbors
      const childEntry = adjacency.get(childId);
      if (childEntry) {
        childEntry.connectedEdgeIds.forEach((edgeId) => groupEntry.connectedEdgeIds.add(edgeId));
        for (const neighborId of childEntry.connectedNodeIds) {
          if (!childSet.has(neighborId) && neighborId !== groupId) {
            groupEntry.connectedNodeIds.add(neighborId);
          }
        }
      }
    }
  }

  return adjacency;
});

// Layout result cache keyed by hash of node IDs + edge IDs + config.
// Prevents expensive ELK re-layout when only toggling visual settings.
interface LayoutCacheEntry {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  weight: number;
}

const layoutCache = new Map<string, LayoutCacheEntry>();
const MAX_LAYOUT_CACHE_ENTRIES = 8;
const MAX_LAYOUT_CACHE_WEIGHT = 220_000;
let layoutCacheWeight = 0;
const MAX_NODE_MEASUREMENT_CACHE_ENTRIES = 4_000;
const TWO_PASS_MEASURE_NODE_THRESHOLD = 500;

const addSetDiff = (target: Set<string>, previous: Set<string>, next: Set<string>): void => {
  previous.forEach((id) => {
    if (!next.has(id)) {
      target.add(id);
    }
  });
  next.forEach((id) => {
    if (!previous.has(id)) {
      target.add(id);
    }
  });
};

const resetSearchHighlightState = (): void => {
  searchHighlightState.hasResults = false;
  searchHighlightState.hasPath = false;
  searchHighlightState.matchingNodeIds = new Set<string>();
  searchHighlightState.pathNodeIds = new Set<string>();
  searchHighlightState.matchingEdgeIds = new Set<string>();
};

const shouldRunTwoPassMeasure = (nodeCount: number): boolean => nodeCount <= TWO_PASS_MEASURE_NODE_THRESHOLD;

const waitForNextPaint = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
};

function computeLayoutCacheKey(nodes: DependencyNode[], edgeList: GraphEdge[], config: typeof layoutConfig): string {
  // Build a fast hash from node/edge IDs + layout direction/algorithm
  const nodeIds = nodes
    .map((n) => n.id)
    .sort()
    .join(',');
  const edgeIds = edgeList
    .map((e) => e.id)
    .sort()
    .join(',');
  const dwl = graphSettings.degreeWeightedLayers ? 1 : 0;
  return `${config.algorithm}:${config.direction}:${config.nodeSpacing}:${config.rankSpacing}:${config.edgeSpacing}:dwl${dwl}:${nodeIds.length}:${edgeIds.length}:${simpleHash(nodeIds)}:${simpleHash(edgeIds)}`;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function estimateLayoutCacheWeight(nodes: DependencyNode[], edgeList: GraphEdge[]): number {
  // Coarse heuristic to keep cache bounded without expensive deep size checks.
  return nodes.length * 18 + edgeList.length * 10;
}

function trimLayoutCache(nextEntryWeight: number): void {
  while (
    layoutCache.size >= MAX_LAYOUT_CACHE_ENTRIES ||
    layoutCacheWeight + nextEntryWeight > MAX_LAYOUT_CACHE_WEIGHT
  ) {
    const oldestKey = layoutCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    const removed = layoutCache.get(oldestKey);
    if (removed) {
      layoutCacheWeight = Math.max(0, layoutCacheWeight - removed.weight);
    }
    layoutCache.delete(oldestKey);
  }
}

function pruneNodeMeasurementCache(liveNodes: DependencyNode[]): void {
  if (nodeMeasurementCache.size === 0) {
    return;
  }

  const liveIds = new Set(liveNodes.map((node) => node.id));
  for (const cachedId of nodeMeasurementCache.keys()) {
    if (!liveIds.has(cachedId)) {
      nodeMeasurementCache.delete(cachedId);
    }
  }

  while (nodeMeasurementCache.size > MAX_NODE_MEASUREMENT_CACHE_ENTRIES) {
    const oldest = nodeMeasurementCache.keys().next().value;
    if (!oldest) {
      break;
    }
    nodeMeasurementCache.delete(oldest);
  }
}

// Cached DOM references for handleWheel (Issue #19: avoid querySelector/getBoundingClientRect per event)
let cachedFlowContainer: HTMLElement | null = null;
let cachedContainerRect: DOMRect | null = null;
let flowResizeObserver: ResizeObserver | null = null;

const minimapNodeColor = (node: { type?: string }): string => {
  if (node.type === 'package') return 'rgba(20, 184, 166, 0.8)';
  if (node.type === 'module') return 'rgba(59, 130, 246, 0.75)';
  if (node.type === 'class' || node.type === 'interface') return 'rgba(217, 119, 6, 0.7)';
  return 'rgba(148, 163, 184, 0.6)';
};

const minimapNodeStrokeColor = (node: { id?: string }): string => {
  return node.id === selectedNode.value?.id ? '#22d3ee' : 'rgba(226, 232, 240, 0.8)';
};

const handleMinimapNodeClick = (params: { node: { id: string } }): void => {
  void handleFocusNode(params.node.id);
};

const defaultLayoutConfig = {
  algorithm: 'layered' as 'layered' | 'radial' | 'force' | 'stress',
  direction: 'LR' as 'LR' | 'RL' | 'TB' | 'BT',
  nodeSpacing: 80,
  rankSpacing: 200,
  edgeSpacing: 30,
};
const layoutConfig = { ...defaultLayoutConfig };

const getLayoutProcessorConfig = () => ({
  algorithm: layoutConfig.algorithm,
  direction: layoutConfig.direction,
  nodeSpacing: layoutConfig.nodeSpacing,
  rankSpacing: layoutConfig.rankSpacing,
  edgeSpacing: layoutConfig.edgeSpacing,
  degreeWeightedLayers: graphSettings.degreeWeightedLayers,
  theme: graphTheme,
  animationDuration: 150,
});

const getHandlePositions = (
  direction: 'LR' | 'RL' | 'TB' | 'BT'
): { sourcePosition: Position; targetPosition: Position } => {
  switch (direction) {
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    case 'TB':
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
  }
};

const getEnabledNodeTypes = (): Set<string> => {
  return new Set(graphSettings.enabledNodeTypes);
};

const mergeNodeInteractionStyle = (
  node: DependencyNode,
  interactionStyle: Record<string, string | number | undefined>
): Record<string, string | number | undefined> => {
  const currentStyle =
    typeof node.style === 'object' ? (node.style as Record<string, string | number | undefined>) : {};

  // If no interaction changes vs current style, return existing style unchanged (same reference = no reactivity trigger)
  if (Object.keys(interactionStyle).every((key) => currentStyle[key] === interactionStyle[key])) {
    return currentStyle;
  }

  const baseStyle = getNodeStyle(node.type as DependencyKind);

  const preservedSizing = {
    width: currentStyle['width'],
    height: currentStyle['height'],
    minWidth: currentStyle['minWidth'],
    minHeight: currentStyle['minHeight'],
    overflow: currentStyle['overflow'],
    zIndex: currentStyle['zIndex'],
  };

  return {
    ...baseStyle,
    ...preservedSizing,
    ...interactionStyle,
  };
};

const stripNodeClass = (node: DependencyNode): DependencyNode => {
  if (node.class === undefined || node.class === '') {
    return node;
  }
  // VueFlow merges node updates; omitting `class` can leave stale internal classes.
  // Overwrite explicitly to clear previous selection classes.
  return { ...node, class: '' } as DependencyNode;
};

const stripEdgeClass = (edge: GraphEdge): GraphEdge => {
  if (edge.class === undefined || edge.class === '') {
    return edge;
  }
  return { ...edge, class: '' } as GraphEdge;
};

const EDGE_HOVER_CLASS = 'edge-hover-highlighted';
const EDGE_HOVER_Z_INDEX = 12;
const EDGE_HOVER_BASE_STROKE_VAR = '--edge-hover-base-stroke';
const EDGE_HOVER_FALLBACK_STROKE = '#404040';
const NODE_SELECTION_CLASS_TOKENS = ['selection-target', 'selection-connected', 'selection-dimmed'] as const;
const EDGE_SELECTION_CLASS_TOKENS = [
  'edge-selection-highlighted',
  'edge-selection-dimmed',
  EDGE_HOVER_CLASS,
] as const;
const EMPTY_EDGE_SET = new Set<string>();
const hoveredNodeId = ref<string | null>(null);

const normalizeClassValue = (className: unknown): string => {
  if (typeof className !== 'string') {
    return '';
  }
  return className.trim();
};

const getClassTokens = (className: unknown): Set<string> => {
  const normalizedClass = normalizeClassValue(className);
  if (!normalizedClass) {
    return new Set<string>();
  }
  return new Set(normalizedClass.split(/\s+/).filter((token) => token.length > 0));
};

const normalizeEdgeClass = (edgeClass: GraphEdge['class']): string => {
  return normalizeClassValue(edgeClass);
};

const getEdgeClassTokens = (edgeClass: GraphEdge['class']): Set<string> => {
  return getClassTokens(edgeClass);
};

const edgeClassTokensToString = (tokens: Set<string>): string => {
  return [...tokens].join(' ');
};

const toEdgeStyleRecord = (style: GraphEdge['style']): Record<string, string | number | undefined> | undefined => {
  if (typeof style !== 'object' || style === null) {
    return undefined;
  }
  return style as Record<string, string | number | undefined>;
};

const getEdgeBaseStroke = (edge: GraphEdge): string => {
  const edgeStyle = toEdgeStyleRecord(edge.style);
  const styleStroke = edgeStyle?.['stroke'];
  if (typeof styleStroke === 'string' && styleStroke.length > 0) {
    return styleStroke;
  }

  const themedStroke = getEdgeStyle(toDependencyEdgeKind(edge.data?.type))['stroke'];
  if (typeof themedStroke === 'string' && themedStroke.length > 0) {
    return themedStroke;
  }

  return EDGE_HOVER_FALLBACK_STROKE;
};

const selectedAdjacency = computed(() => {
  if (!selectedNode.value || interaction.scopeMode.value === 'isolate') {
    return undefined;
  }
  return selectionAdjacencyByNodeId.value.get(selectedNode.value.id);
});

const selectedConnectedNodeIds = computed<Set<string>>(() => {
  return selectedAdjacency.value?.connectedNodeIds ?? EMPTY_EDGE_SET;
});

const selectedConnectedEdgeIds = computed<Set<string>>(() => {
  return selectedAdjacency.value?.connectedEdgeIds ?? EMPTY_EDGE_SET;
});

const hoveredConnectedEdgeIds = computed<Set<string>>(() => {
  if (
    hoveredNodeId.value === null ||
    selectedNode.value !== null ||
    interaction.scopeMode.value === 'isolate'
  ) {
    return EMPTY_EDGE_SET;
  }
  return selectionAdjacencyByNodeId.value.get(hoveredNodeId.value)?.connectedEdgeIds ?? EMPTY_EDGE_SET;
});

const highlightedEdgeIds = computed<Set<string>>(() => {
  const ids = new Set<string>();
  selectedConnectedEdgeIds.value.forEach((edgeId) => ids.add(edgeId));
  hoveredConnectedEdgeIds.value.forEach((edgeId) => ids.add(edgeId));
  if (searchHighlightState.hasResults) {
    searchHighlightState.matchingEdgeIds.forEach((edgeId) => ids.add(edgeId));
  }
  return ids;
});
const highlightedEdgeIdList = computed(() => [...highlightedEdgeIds.value]);

const resolveNodeSelectionClass = (node: DependencyNode): string | null => {
  if (!selectedNode.value || interaction.scopeMode.value === 'isolate') {
    return null;
  }

  if (node.id === selectedNode.value.id) {
    return 'selection-target';
  }
  if (selectedConnectedNodeIds.value.has(node.id)) {
    return 'selection-connected';
  }
  return 'selection-dimmed';
};

const applyEdgeHoverStrokeVariable = (edge: GraphEdge, shouldHover: boolean): GraphEdge['style'] => {
  const currentStyle = toEdgeStyleRecord(edge.style);
  if (shouldHover) {
    const baseStroke = getEdgeBaseStroke(edge);
    if (currentStyle?.[EDGE_HOVER_BASE_STROKE_VAR] === baseStroke) {
      return edge.style;
    }
    return {
      ...(currentStyle ?? {}),
      [EDGE_HOVER_BASE_STROKE_VAR]: baseStroke,
    };
  }

  if (!currentStyle || !(EDGE_HOVER_BASE_STROKE_VAR in currentStyle)) {
    return edge.style;
  }

  const nextStyle = { ...currentStyle };
  delete nextStyle[EDGE_HOVER_BASE_STROKE_VAR];
  return Object.keys(nextStyle).length > 0 ? nextStyle : undefined;
};

// IDs of nodes/edges that were given visual classes in the previous computed
// evaluation. We MUST produce fresh objects for these on the next pass so
// VueFlow sees new references and clears stale classes from its internal state.
let prevStyledNodeIds = new Set<string>();

const visualNodes = computed<DependencyNode[]>(() => {
  if (!USE_CSS_SELECTION_HOVER) {
    prevStyledNodeIds = new Set();
    return nodes.value;
  }

  const nextStyledIds = new Set<string>();
  let nextNodes: DependencyNode[] | null = null;

  // Cache the set of actively-dragged node IDs so we can avoid creating new
  // object references for them. VueFlow tracks drag state internally on the
  // node object; if we replace the object reference mid-drag, VueFlow
  // re-syncs the node from the prop and snaps the position back to the
  // (potentially stale) store position, causing rubber-banding.
  const dragging = activeDraggedNodeIds.value;

  nodes.value.forEach((node, index) => {
    // CRITICAL: Never create a new object reference for a node that is actively
    // being dragged. Doing so resets VueFlow's internal drag tracking and
    // causes the node to snap back to the store position.
    if (dragging.size > 0 && dragging.has(node.id)) {
      // Still track as styled so we re-apply when drag ends.
      const selectionClass = resolveNodeSelectionClass(node);
      if (selectionClass) {
        nextStyledIds.add(node.id);
      }
      return;
    }

    const classTokens = getClassTokens(node.class);
    NODE_SELECTION_CLASS_TOKENS.forEach((token) => classTokens.delete(token));

    const selectionClass = resolveNodeSelectionClass(node);
    if (selectionClass) {
      classTokens.add(selectionClass);
      nextStyledIds.add(node.id);
    }

    const nextClass = edgeClassTokensToString(classTokens);

    // Skip only if this node wasn't styled last time AND the class already matches.
    // Previously-styled nodes MUST get a fresh object so VueFlow drops the old class.
    if (!prevStyledNodeIds.has(node.id) && normalizeClassValue(node.class) === nextClass) {
      return;
    }

    if (!nextNodes) {
      nextNodes = [...nodes.value];
    }

    // Always spread a new object — returning the same store reference would
    // make VueFlow think nothing changed and keep stale classes in its DOM.
    nextNodes[index] = { ...node, class: nextClass || '' } as DependencyNode;
  });

  prevStyledNodeIds = nextStyledIds;
  return nextNodes ?? nodes.value;
});

let prevStyledEdgeIds = new Set<string>();

const visualEdges = computed<GraphEdge[]>(() => {
  if (!USE_CSS_SELECTION_HOVER) {
    prevStyledEdgeIds = new Set();
    return edges.value;
  }

  const hasSelection = selectedNode.value !== null && interaction.scopeMode.value !== 'isolate';
  const selectionEdgeIds = selectedConnectedEdgeIds.value;
  const hoveredEdgeIdSet = hoveredConnectedEdgeIds.value;

  const nextStyledIds = new Set<string>();
  let nextEdges: GraphEdge[] | null = null;

  edges.value.forEach((edge, index) => {
    const classTokens = getEdgeClassTokens(edge.class);
    EDGE_SELECTION_CLASS_TOKENS.forEach((token) => classTokens.delete(token));

    let isStyled = false;

    if (hasSelection) {
      classTokens.add(selectionEdgeIds.has(edge.id) ? 'edge-selection-highlighted' : 'edge-selection-dimmed');
      isStyled = true;
    }

    const shouldHover = hoveredEdgeIdSet.has(edge.id);
    if (shouldHover) {
      classTokens.add(EDGE_HOVER_CLASS);
      isStyled = true;
    }

    if (isStyled) {
      nextStyledIds.add(edge.id);
    }

    const nextClass = edgeClassTokensToString(classTokens);
    const nextStyle = applyEdgeHoverStrokeVariable(edge, shouldHover);
    const nextZIndex = shouldHover ? Math.max(edge.zIndex ?? 0, EDGE_HOVER_Z_INDEX) : edge.zIndex;

    // Previously-styled edges MUST get a fresh object so VueFlow drops stale classes.
    const wasPreviouslyStyled = prevStyledEdgeIds.has(edge.id);
    if (
      !wasPreviouslyStyled &&
      normalizeEdgeClass(edge.class) === nextClass &&
      nextStyle === edge.style &&
      nextZIndex === edge.zIndex
    ) {
      return;
    }

    if (!nextEdges) {
      nextEdges = [...edges.value];
    }

    nextEdges[index] = {
      ...edge,
      class: nextClass,
      style: nextStyle,
      zIndex: nextZIndex,
    } as GraphEdge;
  });

  prevStyledEdgeIds = nextStyledIds;
  return nextEdges ?? edges.value;
});

interface TypeCountEntry {
  type: string;
  count: number;
}

const toSortedTypeCounts = (counts: Map<string, number>): TypeCountEntry[] => {
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.type.localeCompare(b.type);
    });
};

const renderedNodeCount = computed(() => visualNodes.value.length);
const renderedEdgeCount = computed(() => visualEdges.value.filter((edge) => !edge.hidden).length);

const renderedNodeTypeCounts = computed<TypeCountEntry[]>(() => {
  const counts = new Map<string, number>();
  visualNodes.value.forEach((node) => {
    const type = node.type ?? 'unknown';
    counts.set(type, (counts.get(type) ?? 0) + 1);
  });
  return toSortedTypeCounts(counts);
});

const renderedEdgeTypeCounts = computed<TypeCountEntry[]>(() => {
  const counts = new Map<string, number>();
  visualEdges.value.forEach((edge) => {
    if (edge.hidden) {
      return;
    }
    const bundledTypes = edge.data?.bundledTypes ?? [];
    if (bundledTypes.length > 0) {
      [...new Set(bundledTypes)].forEach((type) => {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      });
      return;
    }

    const type = edge.data?.type ?? 'unknown';
    counts.set(type, (counts.get(type) ?? 0) + 1);
  });
  return toSortedTypeCounts(counts);
});

const initializeLayoutProcessor = () => {
  layoutRequestVersion += 1;

  if (!layoutProcessor) {
    layoutProcessor = new WebWorkerLayoutProcessor(getLayoutProcessorConfig());
    return;
  }

  layoutProcessor.updateConfig(getLayoutProcessorConfig());
};

const applySelectionHighlight = (selected: DependencyNode | null): void => {
  if (USE_CSS_SELECTION_HOVER) {
    return;
  }

  // Isolation mode manages its own styles
  if (interaction.scopeMode.value === 'isolate') return;

  if (PERF_MARKS_ENABLED) {
    performance.mark('selection-highlight-start');
  }

  const hasSelection = selected !== null;
  const selectedAdjacency = selected ? selectionAdjacencyByNodeId.value.get(selected.id) : undefined;
  const connectedNodeIds = selectedAdjacency?.connectedNodeIds ?? new Set<string>();
  const connectedEdgeIds = selectedAdjacency?.connectedEdgeIds ?? new Set<string>();
  const nodeUpdates = new Map<string, DependencyNode>();
  const edgeUpdates = new Map<string, GraphEdge>();

  nodes.value.forEach((node) => {
    let nodeClass: string | undefined;

    if (hasSelection) {
      if (selected && node.id === selected.id) nodeClass = 'selection-target';
      else if (connectedNodeIds.has(node.id)) nodeClass = 'selection-connected';
      else nodeClass = 'selection-dimmed';
    }

    if (node.class === nodeClass) return;
    if (!nodeClass) {
      const stripped = stripNodeClass(node);
      if (stripped !== node) {
        nodeUpdates.set(node.id, stripped);
      }
      return;
    }
    nodeUpdates.set(node.id, { ...node, class: nodeClass } as DependencyNode);
  });

  edges.value.forEach((edge) => {
    let edgeClass: string | undefined;
    if (hasSelection) {
      edgeClass = connectedEdgeIds.has(edge.id) ? 'edge-selection-highlighted' : 'edge-selection-dimmed';
    }
    if (edge.class === edgeClass) return;
    if (!edgeClass) {
      const stripped = stripEdgeClass(edge);
      if (stripped !== edge) {
        edgeUpdates.set(edge.id, stripped);
      }
      return;
    }
    edgeUpdates.set(edge.id, { ...edge, class: edgeClass } as GraphEdge);
  });

  graphStore['updateNodesById'](nodeUpdates);
  graphStore['updateEdgesById'](edgeUpdates);

  if (PERF_MARKS_ENABLED) {
    performance.mark('selection-highlight-end');
    measurePerformance('selection-highlight', 'selection-highlight-start', 'selection-highlight-end');
  }
};

let hoveredEdgeIds = new Set<string>();
const hoveredEdgePrevZIndexById = new Map<string, number | undefined>();

const applyHoverEdgeHighlight = (nodeId: string | null): void => {
  if (USE_CSS_SELECTION_HOVER) {
    return;
  }

  const shouldHighlightEdges =
    nodeId !== null && selectedNode.value === null && interaction.scopeMode.value !== 'isolate';
  const nextHoveredEdgeIds = shouldHighlightEdges
    ? (selectionAdjacencyByNodeId.value.get(nodeId)?.connectedEdgeIds ?? new Set<string>())
    : new Set<string>();

  const impactedEdgeIds = new Set<string>([...hoveredEdgeIds, ...nextHoveredEdgeIds]);
  if (impactedEdgeIds.size === 0) {
    hoveredEdgeIds = nextHoveredEdgeIds;
    if (nextHoveredEdgeIds.size === 0) {
      hoveredEdgePrevZIndexById.clear();
    }
    return;
  }

  const edgeById = new Map(edges.value.map((edge) => [edge.id, edge]));
  const edgeUpdates = new Map<string, GraphEdge>();

  impactedEdgeIds.forEach((edgeId) => {
    const edge = edgeById.get(edgeId);
    if (!edge) {
      hoveredEdgePrevZIndexById.delete(edgeId);
      return;
    }

    const shouldHover = nextHoveredEdgeIds.has(edgeId);
    if (shouldHover && !hoveredEdgePrevZIndexById.has(edgeId)) {
      hoveredEdgePrevZIndexById.set(edgeId, edge.zIndex);
    }

    const classTokens = getEdgeClassTokens(edge.class);
    if (shouldHover) {
      classTokens.add(EDGE_HOVER_CLASS);
    } else {
      classTokens.delete(EDGE_HOVER_CLASS);
    }

    const nextClass = edgeClassTokensToString(classTokens);
    const previousZIndex = hoveredEdgePrevZIndexById.get(edgeId);
    const nextZIndex = shouldHover ? EDGE_HOVER_Z_INDEX : previousZIndex;
    if (!shouldHover) {
      hoveredEdgePrevZIndexById.delete(edgeId);
    }

    const classChanged = normalizeEdgeClass(edge.class) !== nextClass;
    const zIndexChanged = edge.zIndex !== nextZIndex;
    const currentStyle = toEdgeStyleRecord(edge.style);
    let nextStyle = edge.style;
    let styleChanged = false;

    if (shouldHover) {
      const baseStroke = getEdgeBaseStroke(edge);
      const currentHoverBaseStroke = currentStyle?.[EDGE_HOVER_BASE_STROKE_VAR];
      if (currentHoverBaseStroke !== baseStroke) {
        nextStyle = {
          ...(currentStyle ?? {}),
          [EDGE_HOVER_BASE_STROKE_VAR]: baseStroke,
        };
        styleChanged = true;
      }
    } else if (currentStyle && EDGE_HOVER_BASE_STROKE_VAR in currentStyle) {
      const styleWithoutHoverVar = { ...currentStyle };
      delete styleWithoutHoverVar[EDGE_HOVER_BASE_STROKE_VAR];
      nextStyle = Object.keys(styleWithoutHoverVar).length > 0 ? styleWithoutHoverVar : undefined;
      styleChanged = true;
    }

    if (!classChanged && !zIndexChanged && !styleChanged) {
      return;
    }

    edgeUpdates.set(edge.id, {
      ...edge,
      class: nextClass,
      zIndex: nextZIndex,
      style: nextStyle,
    } as GraphEdge);
  });

  hoveredEdgeIds = new Set(nextHoveredEdgeIds);
  if (edgeUpdates.size > 0) {
    graphStore['updateEdgesById'](edgeUpdates);
  }
};

const setSelectedNode = (node: DependencyNode | null) => {
  if (node !== null || selectedNode.value !== null) {
    clearHoverState();
  }

  graphStore['setSelectedNode'](node);
  interaction.setSelectionNodeId(node?.id ?? null);
  if (!node) {
    interaction.setCameraMode('free');
    removeSelectedElements();
  }
  if (USE_CSS_SELECTION_HOVER) {
    return;
  }
  // Debounce via rAF to coalesce rapid selection changes (keyboard nav)
  if (selectionHighlightRafId !== null) {
    cancelAnimationFrame(selectionHighlightRafId);
  }
  selectionHighlightRafId = requestAnimationFrame(() => {
    selectionHighlightRafId = null;
    applySelectionHighlight(node);
    applyHoverEdgeHighlight(node ? null : hoveredNodeId.value);
  });
};

const reconcileSelectedNodeAfterStructuralChange = (updatedNodes: DependencyNode[]): void => {
  const currentSelection = selectedNode.value;
  if (!currentSelection) {
    return;
  }

  const refreshedSelection = updatedNodes.find((node) => node.id === currentSelection.id) ?? null;
  setSelectedNode(refreshedSelection);
};

const measureAllNodeDimensions = (
  layoutedNodes: DependencyNode[]
): { nodes: DependencyNode[]; hasChanges: boolean } => {
  if (layoutedNodes.length === 0) {
    return { nodes: layoutedNodes, hasChanges: false };
  }

  // Keep a fresh snapshot from the observer-driven tracker and only fall back
  // to direct DOM reads if a node has not been observed yet.
  nodeDimensionTracker.refresh();
  const fallbackElementMap = new Map<string, HTMLElement>();

  // Batch-read measurements in a single layout/reflow pass.
  const measurements = new Map<
    string,
    {
      width: number;
      height: number;
      headerH: number;
      bodyH: number;
      subnodesH: number;
      isContainer: boolean;
    }
  >();

  layoutedNodes.forEach((node) => {
    const tracked = nodeDimensionTracker.get(node.id);
    if (tracked) {
      measurements.set(node.id, {
        width: tracked.width,
        height: tracked.height,
        headerH: tracked.headerHeight,
        bodyH: tracked.bodyHeight,
        subnodesH: tracked.subnodesHeight,
        isContainer: isContainerNode(node),
      });
      return;
    }

    if (fallbackElementMap.size === 0) {
      const nodeElements = document.querySelectorAll<HTMLElement>('.vue-flow__node');
      nodeElements.forEach((el) => {
        const id = el.dataset['id'];
        if (id) {
          fallbackElementMap.set(id, el);
        }
      });
    }

    const element = fallbackElementMap.get(node.id);
    if (!element) {
      return;
    }

    const isContainer = isContainerNode(node);

    const measurement = {
      width: element.offsetWidth,
      height: element.offsetHeight,
      headerH: 0,
      bodyH: 0,
      subnodesH: 0,
      isContainer,
    };

    // Only compute insets for container nodes.
    if (isContainer) {
      measurement.headerH = element.querySelector<HTMLElement>('.base-node-header')?.offsetHeight ?? 0;
      measurement.bodyH = element.querySelector<HTMLElement>('.base-node-body')?.offsetHeight ?? 0;
      measurement.subnodesH = element.querySelector<HTMLElement>('.base-node-subnodes')?.offsetHeight ?? 0;
    }

    measurements.set(node.id, measurement);
  });

  let hasChanges = false;
  const measuredNodes = layoutedNodes.map((node) => {
    const m = measurements.get(node.id);
    if (!m) {
      return node;
    }

    const currentMeasured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
    const widthDelta = Math.abs((currentMeasured?.width ?? 0) - m.width);
    const heightDelta = Math.abs((currentMeasured?.height ?? 0) - m.height);
    const cached = nodeMeasurementCache.get(node.id);
    const cacheDeltaWidth = Math.abs((cached?.width ?? 0) - m.width);
    const cacheDeltaHeight = Math.abs((cached?.height ?? 0) - m.height);

    let insetChanged = false;
    let measuredTopInset = 0;

    if (m.isContainer) {
      // Reserve full visible top content so nested children never overlap card sections.
      measuredTopInset = Math.max(96, Math.round(m.headerH + m.bodyH + m.subnodesH + 12));
      const currentTopInset = (node.data?.layoutInsets as { top?: number } | undefined)?.top ?? 0;
      const insetDelta = Math.abs(currentTopInset - measuredTopInset);
      const cacheDeltaInset = Math.abs((cached?.topInset ?? 0) - measuredTopInset);
      insetChanged = insetDelta > 1 || cacheDeltaInset > 1;
    }

    const sizeChanged = widthDelta > 1 || heightDelta > 1 || cacheDeltaWidth > 1 || cacheDeltaHeight > 1;
    if (!sizeChanged && !insetChanged) {
      return node;
    }

    hasChanges = true;
    nodeMeasurementCache.set(node.id, { width: m.width, height: m.height, topInset: measuredTopInset });
    if (nodeMeasurementCache.size > MAX_NODE_MEASUREMENT_CACHE_ENTRIES) {
      const oldest = nodeMeasurementCache.keys().next().value;
      if (oldest) {
        nodeMeasurementCache.delete(oldest);
      }
    }

    const updatedNode = {
      ...node,
      measured: {
        width: m.width,
        height: m.height,
      },
      ...(m.isContainer && measuredTopInset > 0
        ? {
            data: {
              ...node.data,
              layoutInsets: { top: measuredTopInset },
            },
          }
        : {}),
    };

    return updatedNode as DependencyNode;
  });

  return {
    nodes: measuredNodes,
    hasChanges,
  };
};

const toDimensionValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const collectNodesNeedingInternalsUpdate = (previous: DependencyNode[], next: DependencyNode[]): string[] => {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  const changedIds: string[] = [];

  next.forEach((node) => {
    const prev = previousById.get(node.id);
    if (!prev) {
      changedIds.push(node.id);
      return;
    }

    if (
      prev.sourcePosition !== node.sourcePosition ||
      prev.targetPosition !== node.targetPosition ||
      prev.parentNode !== node.parentNode
    ) {
      changedIds.push(node.id);
      return;
    }

    const prevMeasured = (prev as { measured?: { width?: number; height?: number } }).measured;
    const nextMeasured = (node as { measured?: { width?: number; height?: number } }).measured;
    const prevStyle = typeof prev.style === 'object' ? (prev.style as Record<string, unknown>) : {};
    const nextStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};

    const prevWidth = prevMeasured?.width ?? toDimensionValue(prevStyle['width']) ?? toDimensionValue(prev.width) ?? 0;
    const prevHeight =
      prevMeasured?.height ?? toDimensionValue(prevStyle['height']) ?? toDimensionValue(prev.height) ?? 0;
    const nextWidth = nextMeasured?.width ?? toDimensionValue(nextStyle['width']) ?? toDimensionValue(node.width) ?? 0;
    const nextHeight =
      nextMeasured?.height ?? toDimensionValue(nextStyle['height']) ?? toDimensionValue(node.height) ?? 0;

    if (Math.abs(prevWidth - nextWidth) > 1 || Math.abs(prevHeight - nextHeight) > 1) {
      changedIds.push(node.id);
    }
  });

  return changedIds;
};

const normalizeLayoutResult = (
  resultNodes: DependencyNode[],
  resultEdges: GraphEdge[]
): { nodes: DependencyNode[]; edges: GraphEdge[] } => {
  const { sourcePosition, targetPosition } = getHandlePositions(layoutConfig.direction);

  const nodesWithHandles = resultNodes.map((node) => ({
    ...node,
    sourcePosition,
    targetPosition,
  }));

  return {
    nodes: nodesWithHandles,
    edges: optimizeHighwayHandleRouting(nodesWithHandles, resultEdges),
  };
};

const processGraphLayout = async (
  graphData: { nodes: DependencyNode[]; edges: GraphEdge[] },
  options: LayoutProcessOptions = {}
) => {
  if (!layoutProcessor) {
    return null;
  }

  const requestVersion = ++layoutRequestVersion;
  const fitViewToResult = options.fitViewToResult ?? true;
  const fitPadding = options.fitPadding ?? 0.1;
  const twoPassMeasure = options.twoPassMeasure ?? shouldRunTwoPassMeasure(graphData.nodes.length);

  isLayoutPending.value = true;
  if (twoPassMeasure) {
    isLayoutMeasuring.value = true;
  }

  // Suspend edge virtualization during layout to prevent it from seeing stale
  // viewport coordinates before fitView completes its 180ms animation.
  suspendEdgeVirtualization();

  // Suspend cache writes during layout passes to prevent expensive JSON.stringify
  // on intermediate state (first-pass nodes that will be replaced by second-pass)
  graphStore.suspendCacheWrites();

  try {
    performance.mark('layout-start');

    // Check layout cache to avoid expensive ELK re-computation
    const cacheKey = computeLayoutCacheKey(graphData.nodes, graphData.edges as GraphEdge[], layoutConfig);
    const cachedEntry = layoutCache.get(cacheKey);
    if (cachedEntry) {
      // Promote cached entry to MRU position for bounded cache eviction.
      layoutCache.delete(cacheKey);
      layoutCache.set(cacheKey, cachedEntry);

      const previousNodes = graphStore['nodes'];
      // Apply manual offsets to cached layout nodes as well
      const cachedNodes = graphStore.manualOffsets.size > 0
        ? graphStore.applyManualOffsets(cachedEntry.nodes)
        : cachedEntry.nodes;
      graphStore['setNodes'](cachedNodes);
      graphStore['setEdges'](cachedEntry.edges);
      pruneNodeMeasurementCache(cachedNodes);
      await nextTick();
      const changedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, cachedNodes);
      if (changedNodeIds.length > 0) {
        updateNodeInternals(changedNodeIds);
      }

      if (fitViewToResult) {
        await fitView({
          duration: 180,
          padding: fitPadding,
          ...(options.fitNodes?.length ? { nodes: options.fitNodes } : {}),
        });
      }
      syncViewportState();

      // Resume edge virtualization now that fitView has settled the viewport
      resumeEdgeVirtualization();

      performance.mark('layout-end');
      measurePerformance('graph-layout', 'layout-start', 'layout-end');
      return { nodes: cachedEntry.nodes, edges: cachedEntry.edges };
    }

    const firstPassResult = await layoutProcessor.processLayout(graphData);
    if (requestVersion !== layoutRequestVersion) {
      return null;
    }

    let normalized = normalizeLayoutResult(
      firstPassResult.nodes as unknown as DependencyNode[],
      firstPassResult.edges as unknown as GraphEdge[]
    );
    const pendingNodeInternalUpdates = new Set<string>();

    // First pass commit - needed to render DOM for measurement
    const previousNodes = graphStore['nodes'];
    graphStore['setNodes'](normalized.nodes);
    graphStore['setEdges'](normalized.edges);
    pruneNodeMeasurementCache(normalized.nodes);

    await nextTick();
    const firstPassChangedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, normalized.nodes);
    firstPassChangedNodeIds.forEach((id) => pendingNodeInternalUpdates.add(id));

    if (twoPassMeasure) {
      // Allow one paint frame so measurement-mode CSS (content-visibility override)
      // has taken effect before we read node dimensions.
      await waitForNextPaint();
      const measured = measureAllNodeDimensions(normalized.nodes);
      if (measured.hasChanges) {
        const firstPassNodes = normalized.nodes;
        const secondPassResult = await layoutProcessor.processLayout({
          nodes: measured.nodes,
          edges: normalized.edges,
        });
        if (requestVersion !== layoutRequestVersion) {
          return null;
        }

        normalized = normalizeLayoutResult(
          secondPassResult.nodes as unknown as DependencyNode[],
          secondPassResult.edges as unknown as GraphEdge[]
        );

        // Single final commit replaces the first-pass data
        graphStore['setNodes'](normalized.nodes);
        graphStore['setEdges'](normalized.edges);
        pruneNodeMeasurementCache(normalized.nodes);
        await nextTick();
        const secondPassChangedNodeIds = collectNodesNeedingInternalsUpdate(firstPassNodes, normalized.nodes);
        secondPassChangedNodeIds.forEach((id) => pendingNodeInternalUpdates.add(id));
      }
    }

    if (pendingNodeInternalUpdates.size > 0) {
      updateNodeInternals(Array.from(pendingNodeInternalUpdates));
    }

    // Apply persisted manual offsets from previous collision-resolution pushes
    // so that user-adjusted positions survive relayout and folder toggle rebuilds.
    if (graphStore.manualOffsets.size > 0) {
      const offsetNodes = graphStore.applyManualOffsets(normalized.nodes);
      graphStore['setNodes'](offsetNodes);
      normalized = { nodes: offsetNodes, edges: normalized.edges };
    }

    if (fitViewToResult) {
      if (options.fitNodes && options.fitNodes.length > 0) {
        await fitView({
          duration: 180,
          padding: fitPadding,
          nodes: options.fitNodes,
        });
      } else {
        await fitView({
          duration: 180,
          padding: fitPadding,
        });
      }
    }
    syncViewportState();

    // Resume edge virtualization now that fitView has settled the viewport
    resumeEdgeVirtualization();

    // Cache the result for future identical graph+config combinations
    const cacheEntryWeight = estimateLayoutCacheWeight(normalized.nodes, normalized.edges);
    trimLayoutCache(cacheEntryWeight);
    layoutCache.set(cacheKey, {
      nodes: normalized.nodes,
      edges: normalized.edges,
      weight: cacheEntryWeight,
    });
    layoutCacheWeight += cacheEntryWeight;

    performance.mark('layout-end');
    measurePerformance('graph-layout', 'layout-start', 'layout-end');

    return normalized;
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error during layout processing');
    graphLogger.error('Layout processing failed:', error);
    return null;
  } finally {
    isLayoutMeasuring.value = false;
    // Resume cache writes so the final state gets persisted
    graphStore.resumeCacheWrites();
    // Safety net: always resume edge virtualization even on error/early-return paths.
    // Duplicate resume calls are harmless (scheduleRecalc just debounces).
    resumeEdgeVirtualization();
    if (requestVersion === layoutRequestVersion) {
      isLayoutPending.value = false;
    }
  }
};

const initializeGraph = async () => {
  performance.mark('graph-init-start');
  resetSearchHighlightState();
  interaction.resetInteraction();
  graphStore.setViewMode('overview');
  initializeLayoutProcessor();

  const overviewGraph = buildOverviewGraph({
    data: props.data,
    enabledNodeTypes: getEnabledNodeTypes(),
    enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
    direction: layoutConfig.direction,
    clusterByFolder: graphSettings.clusterByFolder,
    collapseScc: graphSettings.collapseScc,
    collapsedFolderIds: graphSettings.collapsedFolderIds,
    hideTestFiles: graphSettings.hideTestFiles,
    memberNodeMode: graphSettings.memberNodeMode,
    highlightOrphanGlobal: graphSettings.highlightOrphanGlobal,
  });
  graphStore.setSemanticSnapshot(overviewGraph.semanticSnapshot ?? null);

  const layoutResult = await processGraphLayout(overviewGraph, {
    fitViewToResult: true,
    fitPadding: 0.1,
    twoPassMeasure: shouldRunTwoPassMeasure(overviewGraph.nodes.length),
  });
  if (layoutResult) {
    graphStore.setOverviewSnapshot(layoutResult);
  }

  performance.mark('graph-init-end');
  measurePerformance('graph-initialization', 'graph-init-start', 'graph-init-end');
};

const requestGraphInitialization = async (): Promise<void> => {
  graphInitQueued = true;
  if (graphInitPromise) {
    await graphInitPromise;
    return;
  }

  graphInitPromise = (async () => {
    while (graphInitQueued) {
      graphInitQueued = false;
      await initializeGraph();
    }
  })();

  try {
    await graphInitPromise;
  } finally {
    graphInitPromise = null;
  }
};

watch(
  () => props.data,
  () => {
    void requestGraphInitialization();
  },
  { immediate: true }
);

watch(
  () => graphSettings.showFps,
  (enabled) => {
    if (enabled) {
      startFps();
      return;
    }
    stopFps();
  },
  { immediate: true }
);

const onNodeClick = ({ node }: { node: unknown }): void => {
  const clickedNode = node as DependencyNode;
  if (selectedNode.value?.id === clickedNode.id) {
    setSelectedNode(null);
  } else {
    setSelectedNode(clickedNode);
  }
};

const handleFocusNode = async (nodeId: string): Promise<void> => {
  const targetNode = nodes.value.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }

  setSelectedNode(targetNode);
  interaction.setCameraMode('fitSelection');

  await fitView({
    nodes: [nodeId],
    duration: 180,
    padding: 0.4,
  });

  const semanticSnapshot = graphStore.semanticSnapshot;
  if (semanticSnapshot) {
    void traverseGraph(nodeId, {
      maxDepth: 1,
      semanticEdges: semanticSnapshot.edges,
      semanticNodes: semanticSnapshot.nodes,
      parentMap: buildParentMap(semanticSnapshot.nodes),
    });
  }

  syncViewportState();
  requestEdgeVirtualizationViewportRecalc(true);
};

const getNodeDims = (n: DependencyNode): { w: number; h: number } => {
  const measured = (n as { measured?: { width?: number; height?: number } }).measured;
  return {
    w: measured?.width ?? (typeof n.width === 'number' ? n.width : 280),
    h: measured?.height ?? (typeof n.height === 'number' ? n.height : 200),
  };
};

const computeIsolateLayout = (
  centerNode: DependencyNode,
  inbound: DependencyNode[],
  outbound: DependencyNode[],
  direction: 'LR' | 'RL' | 'TB' | 'BT'
): Map<string, { x: number; y: number }> => {
  const allNodes = [centerNode, ...inbound, ...outbound];
  const cx = allNodes.reduce((sum, n) => sum + (n.position?.x ?? 0), 0) / allNodes.length;
  const cy = allNodes.reduce((sum, n) => sum + (n.position?.y ?? 0), 0) / allNodes.length;

  const centerDims = getNodeDims(centerNode);
  const GAP = 150;
  const STACK_GAP = 40;
  const isHorizontal = direction === 'LR' || direction === 'RL';
  const isReversed = direction === 'RL' || direction === 'BT';

  // In reversed directions, swap which side inbound/outbound appear on
  const beforeNodes = isReversed ? outbound : inbound;
  const afterNodes = isReversed ? inbound : outbound;

  const positions = new Map<string, { x: number; y: number }>();
  positions.set(centerNode.id, { x: cx, y: cy });

  if (isHorizontal) {
    // Flow axis = X, stack axis = Y
    const stackColumnY = (column: DependencyNode[], alignX: number, alignRight: boolean): void => {
      const totalH = column.reduce((sum, n) => sum + getNodeDims(n).h + STACK_GAP, -STACK_GAP);
      let y = cy + centerDims.h / 2 - totalH / 2;
      for (const node of column) {
        const dims = getNodeDims(node);
        const x = alignRight ? alignX - dims.w : alignX;
        positions.set(node.id, { x, y });
        y += dims.h + STACK_GAP;
      }
    };

    // Before-nodes: right-aligned, right edge is GAP pixels left of center's left edge
    if (beforeNodes.length > 0) {
      const alignX = cx - GAP;
      stackColumnY(beforeNodes, alignX, true);
    }
    // After-nodes: left-aligned, left edge is GAP pixels right of center's right edge
    if (afterNodes.length > 0) {
      const alignX = cx + centerDims.w + GAP;
      stackColumnY(afterNodes, alignX, false);
    }
  } else {
    // Flow axis = Y, stack axis = X
    const stackRowX = (column: DependencyNode[], alignY: number, alignBottom: boolean): void => {
      const totalW = column.reduce((sum, n) => sum + getNodeDims(n).w + STACK_GAP, -STACK_GAP);
      let x = cx + centerDims.w / 2 - totalW / 2;
      for (const node of column) {
        const dims = getNodeDims(node);
        const y = alignBottom ? alignY - dims.h : alignY;
        positions.set(node.id, { x, y });
        x += dims.w + STACK_GAP;
      }
    };

    // Before-nodes: bottom-aligned, bottom edge is GAP pixels above center's top edge
    if (beforeNodes.length > 0) {
      const alignY = cy - GAP;
      stackRowX(beforeNodes, alignY, true);
    }
    // After-nodes: top-aligned, top edge is GAP pixels below center's bottom edge
    if (afterNodes.length > 0) {
      const alignY = cy + centerDims.h + GAP;
      stackRowX(afterNodes, alignY, false);
    }
  }

  return positions;
};

const startIsolateAnimation = (): void => {
  if (isolateAnimatingTimer) clearTimeout(isolateAnimatingTimer);
  isIsolateAnimating.value = true;
  isolateAnimatingTimer = setTimeout(() => {
    isIsolateAnimating.value = false;
    isolateAnimatingTimer = null;
  }, 400);
};

const isolateNeighborhood = async (nodeId: string): Promise<void> => {
  const snapshot = graphStore.overviewSnapshot;
  let sourceNodes = snapshot?.nodes ?? nodes.value;
  let sourceEdges = snapshot?.edges ?? edges.value;
  const semanticSnapshot = graphStore.semanticSnapshot;
  let semanticTraversalNodeIds: Set<string> | null = null;
  let semanticInboundIds: Set<string> | null = null;
  let semanticOutboundIds: Set<string> | null = null;

  if (semanticSnapshot) {
    const semanticResult = traverseGraph(nodeId, {
      maxDepth: 1,
      semanticEdges: semanticSnapshot.edges,
      semanticNodes: semanticSnapshot.nodes,
      parentMap: buildParentMap(semanticSnapshot.nodes),
    });
    semanticTraversalNodeIds = semanticResult.nodeIds;
    semanticInboundIds = semanticResult.inbound;
    semanticOutboundIds = semanticResult.outbound;

    const isolatedSemanticNodes = semanticSnapshot.nodes.filter((node) => semanticResult.nodeIds.has(node.id));
    const isolatedSemanticEdges = semanticResult.edges.filter(
      (edge) => semanticResult.nodeIds.has(edge.source) && semanticResult.nodeIds.has(edge.target)
    );

    if (graphSettings.clusterByFolder) {
      const clustered = clusterByFolder(isolatedSemanticNodes, isolatedSemanticEdges);
      const highwayProjected = applyEdgeHighways(clustered.nodes, clustered.edges, {
        direction: layoutConfig.direction,
      });
      sourceNodes = highwayProjected.nodes;
      sourceEdges = highwayProjected.edges;
    } else {
      sourceNodes = isolatedSemanticNodes;
      sourceEdges = isolatedSemanticEdges;
    }
  }

  const targetNode = sourceNodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }

  const nodeById = new Map(sourceNodes.map((n) => [n.id, n]));

  // Collect direct neighbors.
  const connectedNodeIds = new Set<string>([nodeId]);
  const inboundIds = new Set<string>();
  const outboundIds = new Set<string>();
  if (semanticTraversalNodeIds) {
    semanticTraversalNodeIds.forEach((id) => {
      if (nodeById.has(id)) {
        connectedNodeIds.add(id);
      }
    });
    semanticInboundIds?.forEach((id) => inboundIds.add(id));
    semanticOutboundIds?.forEach((id) => outboundIds.add(id));
  } else {
    sourceEdges.forEach((edge) => {
      if (edge.source === nodeId) {
        connectedNodeIds.add(edge.target);
        outboundIds.add(edge.target);
      } else if (edge.target === nodeId) {
        connectedNodeIds.add(edge.source);
        inboundIds.add(edge.source);
      }
    });
  }

  // Ensure all ancestor containers are present so isolated nodes remain visible.
  connectedNodeIds.forEach((id) => {
    let parent = nodeById.get(id)?.parentNode;
    while (parent) {
      connectedNodeIds.add(parent);
      parent = nodeById.get(parent)?.parentNode;
    }
  });

  const inbound = [...inboundIds]
    .filter((id) => !outboundIds.has(id))
    .map((id) => nodeById.get(id)!)
    .filter(Boolean);
  const outbound = [...outboundIds]
    .filter((id) => !inboundIds.has(id))
    .map((id) => nodeById.get(id)!)
    .filter(Boolean);
  const bidirectional = [...inboundIds]
    .filter((id) => outboundIds.has(id))
    .map((id) => nodeById.get(id)!)
    .filter(Boolean);

  // Distribute bidirectional nodes to the smaller side for balance
  for (const node of bidirectional) {
    if (inbound.length <= outbound.length) {
      inbound.push(node);
    } else {
      outbound.push(node);
    }
  }

  const isolatedSourceNodes = sourceNodes.filter((node) => connectedNodeIds.has(node.id));
  const styleIsolatedNode = (
    node: DependencyNode,
    layoutPositions?: Map<string, { x: number; y: number }>
  ) => {
    const baseNode = stripNodeClass(node);
    const layoutPos = layoutPositions?.get(node.id);
    return {
      ...baseNode,
      position: layoutPos ?? baseNode.position,
      selected: node.id === nodeId,
      style: mergeNodeInteractionStyle(baseNode, {
        opacity: node.id === nodeId ? 1 : 0.9,
        borderColor: node.id === nodeId ? '#22d3ee' : undefined,
        borderWidth: node.id === nodeId ? '2px' : undefined,
      }),
    };
  };

  const provisionalNodes = isolatedSourceNodes.map((node) => styleIsolatedNode(node));

  const isolatedEdges = applyEdgeVisibility(
    sourceEdges
      .filter((edge) => connectedNodeIds.has(edge.source) && connectedNodeIds.has(edge.target))
      .map((edge) => ({
        ...edge,
        style: {
          ...getEdgeStyle(toDependencyEdgeKind(edge.data?.type)),
          opacity: 0.9,
          strokeWidth: edge.source === nodeId || edge.target === nodeId ? 3 : 2,
        },
        zIndex: edge.source === nodeId || edge.target === nodeId ? 5 : 1,
      })),
    graphSettings.activeRelationshipTypes
  );

  startIsolateAnimation();
  const previousLayoutMeasuring = isLayoutMeasuring.value;
  isLayoutMeasuring.value = true;
  try {
    graphStore['setNodes'](provisionalNodes);
    graphStore['setEdges'](isolatedEdges);
    graphStore.setViewMode('isolate');
    interaction.setScopeMode('isolate');
    isolateExpandAll.value = true;

    // Let isolate expansion settle before measuring dimensions.
    await nextTick();
    await waitForNextPaint();
    await nextTick();
    await waitForNextPaint();

    const measuredIsolation = measureAllNodeDimensions(provisionalNodes);
    const measuredNodes = measuredIsolation.nodes;
    const measuredNodeById = new Map(measuredNodes.map((node) => [node.id, node]));
    const measuredTargetNode = measuredNodeById.get(nodeId) ?? targetNode;
    const measuredInbound = inbound.map((node) => measuredNodeById.get(node.id) ?? node);
    const measuredOutbound = outbound.map((node) => measuredNodeById.get(node.id) ?? node);
    const layoutPositions = computeIsolateLayout(
      measuredTargetNode,
      measuredInbound,
      measuredOutbound,
      layoutConfig.direction
    );
    const finalizedNodes = measuredNodes.map((node) => styleIsolatedNode(node, layoutPositions));

    graphStore['setNodes'](finalizedNodes);
    await nextTick();
    const changedNodeIds = collectNodesNeedingInternalsUpdate(provisionalNodes, finalizedNodes);
    if (changedNodeIds.length > 0) {
      updateNodeInternals(changedNodeIds);
    }

    const finalizedTargetNode = finalizedNodes.find((node) => node.id === nodeId) ?? measuredTargetNode;
    setSelectedNode(finalizedTargetNode);
  } finally {
    isLayoutMeasuring.value = previousLayoutMeasuring;
  }

  await fitView({
    duration: 350,
    padding: 0.35,
    nodes: Array.from(connectedNodeIds),
  });
  syncViewportState();
  requestEdgeVirtualizationViewportRecalc(true);
};

const nodeActions = {
  focusNode: (nodeId: string) => void handleFocusNode(nodeId),
  isolateNeighborhood: (nodeId: string) => void isolateNeighborhood(nodeId),
  showContextMenu: (nodeId: string, label: string, event: MouseEvent) => {
    contextMenu.value = {
      nodeId,
      nodeLabel: label,
      x: event.clientX,
      y: event.clientY,
    };
  },
};
const highlightOrphanGlobal = computed(() => graphSettings.highlightOrphanGlobal);

// Provide node actions to child nodes via injection (replaces global CustomEvent)
provide(NODE_ACTIONS_KEY, nodeActions);
provide(ISOLATE_EXPAND_ALL_KEY, isolateExpandAll);
provide(HIGHLIGHT_ORPHAN_GLOBAL_KEY, highlightOrphanGlobal);
provide(FOLDER_COLLAPSE_ACTIONS_KEY, {
  toggleFolderCollapsed: (folderId: string) => {
    graphSettings.toggleFolderCollapsed(folderId);

    // Rebuild graph without resetting viewport — the user toggled a folder
    // in-place and expects the camera to stay put.
    const overviewGraph = buildOverviewGraph({
      data: props.data,
      enabledNodeTypes: getEnabledNodeTypes(),
      enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
      direction: layoutConfig.direction,
      clusterByFolder: graphSettings.clusterByFolder,
      collapseScc: graphSettings.collapseScc,
      collapsedFolderIds: graphSettings.collapsedFolderIds,
      hideTestFiles: graphSettings.hideTestFiles,
      memberNodeMode: graphSettings.memberNodeMode,
      highlightOrphanGlobal: graphSettings.highlightOrphanGlobal,
    });
    graphStore.setSemanticSnapshot(overviewGraph.semanticSnapshot ?? null);

    void processGraphLayout(overviewGraph, {
      fitViewToResult: false,
      twoPassMeasure: false,
    });
  },
});

const handleOpenSymbolUsageGraph = async (nodeId: string): Promise<void> => {
  const targetNode = nodes.value.find((node) => node.id === nodeId) ?? selectedNode.value;
  if (!targetNode) {
    return;
  }

  setSelectedNode(targetNode);
  graphStore.setViewMode('symbolDrilldown');
  interaction.setScopeMode('symbolDrilldown');

  const symbolGraph = buildSymbolDrilldownGraph({
    data: props.data,
    selectedNode: targetNode,
    direction: layoutConfig.direction,
    enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
  });

  await processGraphLayout(symbolGraph, {
    fitViewToResult: true,
    fitPadding: 0.2,
    twoPassMeasure: shouldRunTwoPassMeasure(symbolGraph.nodes.length),
  });
};

const onPaneClick = (): void => {
  setSelectedNode(null);
  contextMenu.value = null;
};

// Context menu is handled directly on BaseNode via @contextmenu + injected showContextMenu action

const handleWheel = (event: WheelEvent): void => {
  if (!isMac.value) return;

  const intent = classifyWheelIntent(event, isMac.value);
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const insideGraphNode = Boolean(target.closest('.vue-flow__node'));
  const overControlSurface = Boolean(target.closest('[data-graph-overlay-scrollable], .vue-flow__panel')) || (
    !insideGraphNode &&
    Boolean(target.closest('input, textarea, select, button, [role="slider"], [contenteditable="true"]'))
  );

  // Pinch-to-zoom should still zoom when over graph nodes, but not when
  // interacting with control surfaces. Prevent default to avoid page zoom.
  if (intent === 'pinch') {
    if (overControlSurface) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const viewport = getViewport();
    const nextZoom = computeZoomFromDelta(viewport.zoom, event.deltaY, MAC_PINCH_ZOOM_SENSITIVITY);
    applyZoomAtPointer(event, viewport, nextZoom);
    return;
  }

  // Let overlays/controls manage their own wheel behavior.
  if (overControlSurface) {
    return;
  }

  event.preventDefault();

  if (intent === 'trackpadScroll') {
    panBy({ x: -event.deltaX, y: -event.deltaY });
    syncViewportState();
    requestEdgeVirtualizationViewportRecalc();
    return;
  }

  const viewport = getViewport();
  const nextZoom = computeZoomFromDelta(viewport.zoom, event.deltaY, MAC_MOUSE_WHEEL_ZOOM_SENSITIVITY);
  applyZoomAtPointer(event, viewport, nextZoom);
};

const handleReturnToOverview = async (): Promise<void> => {
  interaction.setScopeMode('overview');
  graphStore.setViewMode('overview');
  isolateExpandAll.value = false;
  setSelectedNode(null);

  if (graphStore.restoreOverviewSnapshot()) {
    startIsolateAnimation();
    await fitView({ duration: 350, padding: 0.1 });
    syncViewportState();
    requestEdgeVirtualizationViewportRecalc(true);
    return;
  }

  await requestGraphInitialization();
};

const handleResetLayout = async (): Promise<void> => {
  layoutConfig.algorithm = defaultLayoutConfig.algorithm;
  layoutConfig.direction = defaultLayoutConfig.direction;
  layoutConfig.nodeSpacing = defaultLayoutConfig.nodeSpacing;
  layoutConfig.rankSpacing = defaultLayoutConfig.rankSpacing;
  layoutConfig.edgeSpacing = defaultLayoutConfig.edgeSpacing;

  await requestGraphInitialization();
};

const handleResetView = async (): Promise<void> => {
  interaction.setCameraMode('free');
  setSelectedNode(null);
};

const handleRelationshipFilterChange = async (types: string[]) => {
  graphSettings.setEnabledRelationshipTypes(types);
  await requestGraphInitialization();
};

const handleNodeTypeFilterChange = async (types: string[]) => {
  graphSettings.setEnabledNodeTypes(types);
  setSelectedNode(null);
  await requestGraphInitialization();
};

const handleCollapseSccToggle = async (value: boolean) => {
  if (graphSettings.clusterByFolder && value) {
    graphSettings.setCollapseScc(false);
    return;
  }
  graphSettings.setCollapseScc(value);
  await requestGraphInitialization();
};

const handleClusterByFolderToggle = async (value: boolean) => {
  if (value && graphSettings.collapseScc) {
    graphSettings.setCollapseScc(false);
  }
  graphSettings.setClusterByFolder(value);
  await requestGraphInitialization();
};

const handleHideTestFilesToggle = async (value: boolean) => {
  graphSettings.setHideTestFiles(value);
  await requestGraphInitialization();
};

const handleMemberNodeModeChange = async (value: 'compact' | 'graph') => {
  graphSettings.setMemberNodeMode(value);
  await requestGraphInitialization();
};

const handleOrphanGlobalToggle = async (value: boolean) => {
  graphSettings.setHighlightOrphanGlobal(value);
  await requestGraphInitialization();
};

const handleDegreeWeightedLayersToggle = async (value: boolean) => {
  graphSettings.setDegreeWeightedLayers(value);
  await requestGraphInitialization();
};

const handleShowFpsToggle = (value: boolean): void => {
  graphSettings.setShowFps(value);
};

const handleFpsAdvancedToggle = (value: boolean): void => {
  graphSettings.setShowFpsAdvanced(value);
};

// ---- Collision resolution helpers ----

/**
 * Run the deterministic collision resolver against the current node list
 * and apply the results (position/size updates + manual offsets) in a single
 * batched store commit. Guarded by `isApplyingCollisionResolution` to prevent
 * reentrancy from reactive VueFlow `nodes-change` events.
 */
const runCollisionSettle = (anchoredNodeIds: Set<string> | null) => {
  if (isApplyingCollisionResolution.value || isLayoutPending.value || isLayoutMeasuring.value) {
    return;
  }

  const currentNodes = nodes.value;
  if (currentNodes.length === 0) return;

  isApplyingCollisionResolution.value = true;
  try {
    const nodeById = new Map(currentNodes.map((n) => [n.id, n]));
    const activeAnchors = new Set<string>();
    for (const id of activeDraggedNodeIds.value) {
      if (nodeById.has(id)) {
        activeAnchors.add(id);
      }
    }
    if (activeAnchors.size !== activeDraggedNodeIds.value.size) {
      activeDraggedNodeIds.value = activeAnchors;
    }

    const persistentAnchors = new Set<string>();
    for (const id of userPinnedNodeIds.value) {
      if (nodeById.has(id)) {
        persistentAnchors.add(id);
      }
    }
    if (persistentAnchors.size !== userPinnedNodeIds.value.size) {
      userPinnedNodeIds.value = persistentAnchors;
    }

    const resolverAnchors = new Set<string>(persistentAnchors);
    for (const id of activeAnchors) {
      resolverAnchors.add(id);
    }
    if (anchoredNodeIds) {
      for (const id of anchoredNodeIds) {
        if (nodeById.has(id)) {
          resolverAnchors.add(id);
        }
      }
    }

    // Use VueFlow's internal GraphNode objects which have actual DOM-measured
    // dimensions (node.dimensions.width/height). Our store's DependencyNode
    // objects don't carry measured dimensions, so buildPositionMap would fall
    // back to defaults and miss real overlaps.
    const vfNodes = getVueFlowNodes.value ?? getVueFlowNodes;
    const enrichedNodes = (Array.isArray(vfNodes) ? vfNodes : []) as Array<{
      id: string;
      position: { x: number; y: number };
      parentNode?: string;
      style?: unknown;
      dimensions?: { width: number; height: number };
      measured?: { width?: number; height?: number };
      type?: string;
      data?: unknown;
    }>;

    // Map VueFlow dimensions into the BoundsNode.measured shape that
    // buildPositionMap understands.
    const boundsNodes: BoundsNode[] = enrichedNodes.map((n) => {
      const measured = n.dimensions
        ? { width: n.dimensions.width, height: n.dimensions.height }
        : n.measured;
      return {
        id: n.id,
        position: n.position,
        ...(n.parentNode ? { parentNode: n.parentNode } : {}),
        ...(n.style !== undefined ? { style: n.style } : {}),
        ...(n.type ? { type: n.type } : {}),
        ...(n.data !== undefined ? { data: n.data } : {}),
        ...(measured ? { measured } : {}),
      } as BoundsNode;
    });

    // Build mutable position map from current node positions (parent-relative)
    const posMap = buildPositionMap(boundsNodes, {
      defaultNodeWidth: 260,
      defaultNodeHeight: 100,
    });

    // Always include persistent user-pinned nodes as hard anchors so dragged
    // nodes never snap back during later settles.
    const result = resolveCollisions(
      boundsNodes,
      posMap,
      resolverAnchors.size > 0 ? resolverAnchors : null,
      DEFAULT_COLLISION_CONFIG
    );

    if (result.updatedPositions.size === 0 && result.updatedSizes.size === 0) {
      return; // Nothing to do — no overlaps found
    }

    // Build batched node updates — the resolver already excludes anchored
    // nodes from updatedPositions, so every entry here is a node that was
    // repelled away from the anchored node.
    const nodeUpdates = new Map<string, DependencyNode>();
    const offsetUpdates = new Map<string, ManualOffset>();

    for (const [id, newPos] of result.updatedPositions) {
      const node = nodeById.get(id);
      if (!node || !node.position) continue;

      const dx = newPos.x - node.position.x;
      const dy = newPos.y - node.position.y;

      const updatedNode = {
        ...node,
        position: { x: newPos.x, y: newPos.y },
      } as DependencyNode;
      nodeUpdates.set(id, updatedNode);
      offsetUpdates.set(id, { dx, dy });
    }

    // Apply container size updates
    for (const [id, newSize] of result.updatedSizes) {
      const existing = nodeUpdates.get(id) ?? nodeById.get(id);
      if (!existing) continue;

      const currentStyle = typeof existing.style === 'object' ? (existing.style as Record<string, unknown>) : {};
      const parseSize = (value: unknown): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
          const parsed = Number.parseFloat(value);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      };
      const targetWidth = Math.ceil(newSize.width);
      const targetHeight = Math.ceil(newSize.height);
      const currentWidth = parseSize(currentStyle['width']);
      const currentHeight = parseSize(currentStyle['height']);
      if (
        currentWidth !== null &&
        currentHeight !== null &&
        Math.abs(currentWidth - targetWidth) < 1 &&
        Math.abs(currentHeight - targetHeight) < 1
      ) {
        continue;
      }
      const updatedNode = {
        ...existing,
        style: {
          ...currentStyle,
          width: `${targetWidth}px`,
          height: `${targetHeight}px`,
        },
      } as DependencyNode;
      nodeUpdates.set(id, updatedNode);
    }

    // CRITICAL: Remove actively-dragged nodes from nodeUpdates entirely.
    // VueFlow tracks drag state on its internal node object reference.
    // If we replace that object (even with the "correct" position), VueFlow
    // loses its drag state and the node snaps back. The `visualNodes`
    // computed also guards against creating new objects for dragged nodes,
    // but we must not circumvent that by writing the dragged node into the
    // store update either. Size changes for dragged containers are deferred
    // until drag ends — the container will expand then.
    if (activeDraggedNodeIds.value.size > 0) {
      for (const dragId of activeDraggedNodeIds.value) {
        nodeUpdates.delete(dragId);
        offsetUpdates.delete(dragId);
      }
    }

    if (nodeUpdates.size > 0) {
      graphStore['updateNodesById'](nodeUpdates);
    }
    if (offsetUpdates.size > 0) {
      graphStore.mergeManualOffsets(offsetUpdates);
    }

    lastCollisionSettleTime = performance.now();
  } finally {
    isApplyingCollisionResolution.value = false;
  }
};

/**
 * Schedule collision resolution for drag events. Uses rAF for live settling
 * when node count is below threshold; otherwise defers to drag-end.
 */
const scheduleCollisionSettle = (changedNodeIds: Set<string>, isDragging: boolean) => {
  const nodeCount = nodes.value.length;

  // Above hard threshold: only settle on drag-end
  if (nodeCount > DRAG_END_ONLY_THRESHOLD && isDragging) {
    return;
  }

  // Above soft threshold: settle on drag-end only (no live settle)
  if (nodeCount > LIVE_SETTLE_NODE_THRESHOLD && isDragging) {
    return;
  }

  // Throttle live settling
  if (isDragging) {
    const elapsed = performance.now() - lastCollisionSettleTime;
    if (elapsed < LIVE_SETTLE_MIN_INTERVAL_MS) {
      // Already scheduled or too soon — skip
      if (collisionSettleRafId !== null) return;
      collisionSettleRafId = requestAnimationFrame(() => {
        collisionSettleRafId = null;
        runCollisionSettle(changedNodeIds);
      });
      return;
    }
  }

  // Cancel any pending frame
  if (collisionSettleRafId !== null) {
    cancelAnimationFrame(collisionSettleRafId);
    collisionSettleRafId = null;
  }

  runCollisionSettle(changedNodeIds);
};

/**
 * Schedule collision resolution for dimension changes via a short debounce
 * to batch rapid ResizeObserver callbacks.
 */
const scheduleDimensionSettle = () => {
  if (collisionDimensionTimer !== null) {
    clearTimeout(collisionDimensionTimer);
  }
  collisionDimensionTimer = setTimeout(() => {
    collisionDimensionTimer = null;
    const activeAnchors = activeDraggedNodeIds.value;
    runCollisionSettle(activeAnchors.size > 0 ? new Set(activeAnchors) : null);
  }, 60);
};

const handleNodesChange = (changes: NodeChange[]) => {
  if (!changes.length) return;

  // Guard: skip events that are replays from our own collision resolution
  if (isApplyingCollisionResolution.value) return;

  const filteredChanges = filterNodeChangesForFolderMode(changes, nodes.value, graphSettings.clusterByFolder);
  if (!filteredChanges.length) return;

  // Keep app-managed selection as the single source of truth.
  const structuralChanges = filteredChanges.filter((change) => change.type !== 'select');
  if (!structuralChanges.length) return;

  const previousNodes = nodes.value;
  const previousNodeById = new Map(previousNodes.map((node) => [node.id, node]));

  // Classify events by source for collision scheduling
  const dragPositionIds = new Set<string>();
  const dragLifecycleIds = new Set<string>();
  const dragEndedIds = new Set<string>();
  const dragStateById = new Map<string, boolean>();
  let hasLiveDrag = false;
  let hasDragEnd = false;
  let hasDimensionChange = false;

  for (const change of structuralChanges) {
    if (change.type === 'position') {
      const posChange = change as { id: string; dragging?: boolean };
      dragPositionIds.add(posChange.id);
      if (posChange.dragging === true) {
        dragLifecycleIds.add(posChange.id);
        dragStateById.set(posChange.id, true);
        hasLiveDrag = true;
      } else if (posChange.dragging === false) {
        dragLifecycleIds.add(posChange.id);
        dragEndedIds.add(posChange.id);
        dragStateById.set(posChange.id, false);
        // Explicit dragging=false indicates drag-end (not programmatic move).
        hasDragEnd = true;
      }
    } else if (change.type === 'dimensions') {
      hasDimensionChange = true;
    }
  }

  const updatedNodes = applyNodeChanges(
    structuralChanges,
    previousNodes as unknown as never[]
  ) as unknown as DependencyNode[];
  graphStore['setNodes'](updatedNodes);
  reconcileSelectedNodeAfterStructuralChange(updatedNodes);

  // Persist direct user drag movement as manual offsets so relayout cannot
  // snap the dragged node back to layout-computed positions.
  if (dragLifecycleIds.size > 0) {
    const updatedNodeById = new Map(updatedNodes.map((node) => [node.id, node]));
    const dragOffsetUpdates = new Map<string, ManualOffset>();
    for (const nodeId of dragLifecycleIds) {
      const prev = previousNodeById.get(nodeId);
      const next = updatedNodeById.get(nodeId);
      if (!prev?.position || !next?.position) continue;
      const dx = next.position.x - prev.position.x;
      const dy = next.position.y - prev.position.y;
      if (Math.abs(dx) <= DRAG_POSITION_EPSILON && Math.abs(dy) <= DRAG_POSITION_EPSILON) continue;
      dragOffsetUpdates.set(nodeId, { dx, dy });
    }
    if (dragOffsetUpdates.size > 0) {
      graphStore.mergeManualOffsets(dragOffsetUpdates);
    }
  }

  if (dragEndedIds.size > 0) {
    const nextPinned = new Set(userPinnedNodeIds.value);
    dragEndedIds.forEach((id) => nextPinned.add(id));
    userPinnedNodeIds.value = nextPinned;
  }

  if (dragStateById.size > 0) {
    const nextActiveDragged = new Set(activeDraggedNodeIds.value);
    for (const [nodeId, dragging] of dragStateById) {
      if (dragging) {
        nextActiveDragged.add(nodeId);
      } else {
        nextActiveDragged.delete(nodeId);
      }
    }
    activeDraggedNodeIds.value = nextActiveDragged;
  }

  // Schedule collision resolution based on event source
  if (dragPositionIds.size > 0) {
    // Live dragging = at least one change has dragging=true and none ended
    const isDragging = hasLiveDrag && !hasDragEnd;
    const settleAnchors = dragLifecycleIds.size > 0 ? dragLifecycleIds : dragPositionIds;
    scheduleCollisionSettle(settleAnchors, isDragging);
  } else if (hasDimensionChange && !isLayoutPending.value && !isLayoutMeasuring.value) {
    scheduleDimensionSettle();
  }
};

const handleLayoutChange = async (config: {
  algorithm?: string;
  direction?: string;
  nodeSpacing?: number;
  rankSpacing?: number;
}) => {
  if (config.algorithm) {
    layoutConfig.algorithm = config.algorithm as 'layered' | 'radial' | 'force' | 'stress';
  }
  if (config.direction) {
    layoutConfig.direction = config.direction as 'LR' | 'RL' | 'TB' | 'BT';
  }
  if (config.nodeSpacing !== undefined) {
    layoutConfig.nodeSpacing = config.nodeSpacing;
  }
  if (config.rankSpacing !== undefined) {
    layoutConfig.rankSpacing = config.rankSpacing;
  }

  await requestGraphInitialization();
};

const handleSearchResult = (result: SearchResult) => {
  if (PERF_MARKS_ENABLED) {
    performance.mark('search-highlight-start');
  }

  const matchingNodeIds = new Set(result.nodes.map((n) => n.id));
  const pathNodeIds = new Set(result.path?.map((n) => n.id) ?? []);
  const matchingEdgeIds = new Set(result.edges.map((e) => e.id));
  const hasResults = matchingNodeIds.size > 0;
  const hasPath = pathNodeIds.size > 0;

  const shouldRefreshAllNodes =
    hasResults !== searchHighlightState.hasResults ||
    (hasResults && searchHighlightState.hasResults && hasPath !== searchHighlightState.hasPath);
  const shouldRefreshAllEdges = hasResults !== searchHighlightState.hasResults;

  const nodeIdsToUpdate = new Set<string>();
  if (shouldRefreshAllNodes) {
    nodes.value.forEach((node) => nodeIdsToUpdate.add(node.id));
  } else {
    addSetDiff(nodeIdsToUpdate, searchHighlightState.matchingNodeIds, matchingNodeIds);
    addSetDiff(nodeIdsToUpdate, searchHighlightState.pathNodeIds, pathNodeIds);
  }

  const edgeIdsToUpdate = new Set<string>();
  if (shouldRefreshAllEdges) {
    edges.value.forEach((edge) => edgeIdsToUpdate.add(edge.id));
  } else {
    addSetDiff(edgeIdsToUpdate, searchHighlightState.matchingEdgeIds, matchingEdgeIds);
  }

  const nodeUpdates = new Map<string, DependencyNode>();
  const nodeById = new Map(nodes.value.map((node) => [node.id, node]));

  nodeIdsToUpdate.forEach((nodeId) => {
    const node = nodeById.get(nodeId);
    if (!node) {
      return;
    }

    const isMatch = matchingNodeIds.has(node.id);
    const isOnPath = hasPath && pathNodeIds.has(node.id);
    const opacity = !hasResults ? 1 : hasPath ? (isOnPath ? 1 : 0.2) : isMatch ? 1 : 0.2;
    const borderWidth =
      hasPath && isOnPath
        ? graphTheme.edges.sizes.width.selected
        : hasPath
          ? graphTheme.edges.sizes.width.default
          : undefined;
    const currentStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
    const currentOpacity = toDimensionValue(currentStyle['opacity']) ?? 1;
    const currentBorderWidth = currentStyle['borderWidth'];

    const opacityChanged = Math.abs(currentOpacity - opacity) > 0.001;
    const borderWidthChanged = String(currentBorderWidth ?? '') !== String(borderWidth ?? '');
    const classChanged = node.class !== undefined;

    if (!opacityChanged && !borderWidthChanged && !classChanged) {
      return;
    }

    const baseNode = stripNodeClass(node);
    const updatedNode = {
      ...baseNode,
      style: mergeNodeInteractionStyle(baseNode, {
        opacity,
        borderWidth,
      }),
    } as DependencyNode;
    nodeUpdates.set(node.id, updatedNode);
  });

  if (nodeUpdates.size > 0) {
    graphStore['updateNodesById'](nodeUpdates);
  }

  const edgeUpdates = new Map<string, GraphEdge>();
  const edgeById = new Map(edges.value.map((edge) => [edge.id, edge]));

  edgeIdsToUpdate.forEach((edgeId) => {
    const edge = edgeById.get(edgeId);
    if (!edge) {
      return;
    }

    const isMatch = matchingEdgeIds.has(edge.id);
    const opacity = !hasResults ? 1 : isMatch ? 1 : 0.2;
    const currentStyle = typeof edge.style === 'object' ? (edge.style as Record<string, unknown>) : {};
    const currentOpacity = toDimensionValue(currentStyle['opacity']) ?? 1;
    const opacityChanged = Math.abs(currentOpacity - opacity) > 0.001;
    const classChanged = edge.class !== undefined;

    if (!opacityChanged && !classChanged) {
      return;
    }

    const baseEdge = stripEdgeClass(edge);
    edgeUpdates.set(edge.id, {
      ...baseEdge,
      style: {
        ...getEdgeStyle(toDependencyEdgeKind(baseEdge.data?.type)),
        opacity,
      },
    } as GraphEdge);
  });

  if (edgeUpdates.size > 0) {
    const mergedEdges = edges.value.map((edge) => edgeUpdates.get(edge.id) ?? edge);
    graphStore['setEdges'](applyEdgeVisibility(mergedEdges, graphSettings.activeRelationshipTypes));
  }

  searchHighlightState.hasResults = hasResults;
  searchHighlightState.hasPath = hasPath;
  searchHighlightState.matchingNodeIds = new Set(matchingNodeIds);
  searchHighlightState.pathNodeIds = new Set(pathNodeIds);
  searchHighlightState.matchingEdgeIds = new Set(matchingEdgeIds);

  if (PERF_MARKS_ENABLED) {
    performance.mark('search-highlight-end');
    measurePerformance('search-highlight-apply', 'search-highlight-start', 'search-highlight-end');
  }
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && selectedNode.value) {
    setSelectedNode(null);
    return;
  }

  if (
    selectedNode.value &&
    (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
  ) {
    event.preventDefault();
    const connectedEdges = edges.value.filter(
      (edge: GraphEdge) => edge.source === selectedNode.value?.id || edge.target === selectedNode.value?.id
    );
    if (connectedEdges.length > 0) {
      let nextNodeId: string | undefined;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        if (connectedEdges[0]) {
          nextNodeId =
            connectedEdges[0].source === selectedNode.value.id ? connectedEdges[0].target : connectedEdges[0].source;
        }
      } else {
        const lastEdge = connectedEdges[connectedEdges.length - 1];
        if (lastEdge) {
          nextNodeId = lastEdge.source === selectedNode.value.id ? lastEdge.target : lastEdge.source;
        }
      }
      if (nextNodeId) {
        const nextNode = nodes.value.find((node: DependencyNode) => node.id === nextNodeId);
        if (nextNode) {
          setSelectedNode(nextNode);
          void fitView({
            nodes: [nextNode.id],
            duration: 150,
            padding: 0.5,
          }).then(() => {
            syncViewportState();
            requestEdgeVirtualizationViewportRecalc(true);
          });
        }
      }
    }
  }

  // Toggle FPS counter with 'F' key (only when no input is focused)
  if (event.key === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      graphSettings.setShowFps(!graphSettings.showFps);
    }
  }
};

// --- Hover z-index elevation (direct DOM for performance) ---
const HOVER_Z = '9999';

const elevateNodeAndChildren = (nodeId: string): void => {
  const root = graphRootRef.value;
  if (!root) return;

  const el = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (el) {
    el.dataset['prevZ'] = el.style.zIndex;
    el.style.zIndex = HOVER_Z;
  }
  for (const n of nodes.value) {
    if (n.parentNode === nodeId) {
      const child = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`);
      if (child) {
        child.dataset['prevZ'] = child.style.zIndex;
        child.style.zIndex = HOVER_Z;
      }
    }
  }
};

const restoreHoverZIndex = (nodeId: string): void => {
  const root = graphRootRef.value;
  if (!root) return;

  const el = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (el?.dataset['prevZ'] !== undefined) {
    el.style.zIndex = el.dataset['prevZ'];
    delete el.dataset['prevZ'];
  }
  for (const n of nodes.value) {
    if (n.parentNode === nodeId) {
      const child = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`);
      if (child?.dataset['prevZ'] !== undefined) {
        child.style.zIndex = child.dataset['prevZ'];
        delete child.dataset['prevZ'];
      }
    }
  }
};

const clearHoverState = (): void => {
  if (hoveredNodeId.value) {
    restoreHoverZIndex(hoveredNodeId.value);
    hoveredNodeId.value = null;
  }
  applyHoverEdgeHighlight(null);
};

const onNodeMouseEnter = ({ node }: { node: unknown }): void => {
  const entered = node as DependencyNode;
  if (selectedNode.value !== null) {
    clearHoverState();
    return;
  }

  if (entered.type === 'package' || entered.type === 'group') {
    clearHoverState();
    return;
  }
  if (hoveredNodeId.value && hoveredNodeId.value !== entered.id) {
    restoreHoverZIndex(hoveredNodeId.value);
  }
  hoveredNodeId.value = entered.id;
  elevateNodeAndChildren(entered.id);
  applyHoverEdgeHighlight(entered.id);
};

const onNodeMouseLeave = ({ node }: { node: unknown }): void => {
  const left = node as DependencyNode;
  if (left.type === 'package' || left.type === 'group') {
    return;
  }
  if (hoveredNodeId.value === left.id) {
    clearHoverState();
  }
};

onMounted(() => {
  graphRootRef.value?.addEventListener('wheel', handleWheel, { passive: false });
  document.addEventListener('keydown', handleKeyDown);
  if (graphRootRef.value) {
    nodeDimensionTracker.start(graphRootRef.value);
  }

  // Cache the .vue-flow container element and its rect to avoid DOM queries in handleWheel
  const flowContainer = graphRootRef.value?.querySelector('.vue-flow') as HTMLElement | null;
  if (flowContainer) {
    cachedFlowContainer = flowContainer;
    cachedContainerRect = flowContainer.getBoundingClientRect();
    flowResizeObserver = new ResizeObserver(() => {
      cachedContainerRect = cachedFlowContainer?.getBoundingClientRect() ?? null;
    });
    flowResizeObserver.observe(flowContainer);
  }
  syncViewportState();

  // Fetch code issues and insights after graph loads
  void issuesStore.fetchIssues();
  void insightsStore.fetchInsights();
});

onUnmounted(() => {
  if (panEndTimer) {
    clearTimeout(panEndTimer);
    panEndTimer = null;
  }
  if (collisionSettleRafId !== null) {
    cancelAnimationFrame(collisionSettleRafId);
    collisionSettleRafId = null;
  }
  if (collisionDimensionTimer !== null) {
    clearTimeout(collisionDimensionTimer);
    collisionDimensionTimer = null;
  }
  if (selectionHighlightRafId !== null) {
    cancelAnimationFrame(selectionHighlightRafId);
    selectionHighlightRafId = null;
  }
  if (viewportSyncRafId !== null) {
    cancelAnimationFrame(viewportSyncRafId);
    viewportSyncRafId = null;
  }
  if (edgeViewportRecalcTimer) {
    clearTimeout(edgeViewportRecalcTimer);
    edgeViewportRecalcTimer = null;
  }
  stopFps();
  graphRootRef.value?.removeEventListener('wheel', handleWheel);
  document.removeEventListener('keydown', handleKeyDown);
  flowResizeObserver?.disconnect();
  flowResizeObserver = null;
  nodeDimensionTracker.stop();
  cachedFlowContainer = null;
  cachedContainerRect = null;
  disposeEdgeVirtualization();
  clearHoverState();
  if (layoutProcessor) {
    layoutProcessor.dispose();
    layoutProcessor = null;
  }
  layoutCache.clear();
  layoutCacheWeight = 0;
});
</script>

<template>
  <div
    ref="graphRootRef"
    :class="[
      'dependency-graph-root relative h-full w-full',
      {
        'graph-panning': isPanning,
        'graph-heavy-edges': isHeavyEdgeMode,
        'graph-isolate-animating': isIsolateAnimating,
        'graph-layout-measuring': isLayoutMeasuring,
      },
    ]"
    role="application"
    aria-label="TypeScript dependency graph visualization"
    tabindex="0"
    :data-selection-hover-mode="USE_CSS_SELECTION_HOVER ? 'css' : 'store'"
    :data-selected-node-id="selectedNode?.id ?? ''"
    :data-hovered-node-id="hoveredNodeId ?? ''"
  >
    <VueFlow
      :nodes="visualNodes"
      :edges="renderedEdges"
      :node-types="nodeTypes as any"
      :fit-view-on-init="false"
      :min-zoom="0.1"
      :max-zoom="2"
      :default-viewport="DEFAULT_VIEWPORT"
      :only-render-visible-elements="useOnlyRenderVisibleElements"
      :snap-to-grid="edges.length < 1000"
      :snap-grid="[15, 15]"
      :pan-on-scroll="false"
      :zoom-on-scroll="!isMac"
      :zoom-on-pinch="!isMac"
      :prevent-scrolling="true"
      :zoom-on-double-click="false"
      :elevate-edges-on-select="false"
      :default-edge-options="defaultEdgeOptions"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
      @nodes-change="handleNodesChange"
      @node-mouse-enter="onNodeMouseEnter"
      @node-mouse-leave="onNodeMouseLeave"
      @move="onMove"
      @move-start="onMoveStart"
      @move-end="onMoveEnd"
    >
      <Background />
      <GraphControls
        :relationship-availability="graphSettings.relationshipAvailability"
        @relationship-filter-change="handleRelationshipFilterChange"
        @node-type-filter-change="handleNodeTypeFilterChange"
        @layout-change="handleLayoutChange"
        @reset-layout="handleResetLayout"
        @reset-view="handleResetView"
        @toggle-collapse-scc="handleCollapseSccToggle"
        @toggle-cluster-folder="handleClusterByFolderToggle"
        @toggle-hide-test-files="handleHideTestFilesToggle"
        @member-node-mode-change="handleMemberNodeModeChange"
        @toggle-orphan-global="handleOrphanGlobalToggle"
        @toggle-degree-weighted-layers="handleDegreeWeightedLayersToggle"
        @toggle-show-fps="handleShowFpsToggle"
        @toggle-fps-advanced="handleFpsAdvancedToggle"
      />
      <GraphSearch @search-result="handleSearchResult" :nodes="nodes" :edges="edges" />
      <MiniMap
        v-if="showMiniMap"
        position="bottom-right"
        :pannable="true"
        :zoomable="true"
        :node-color="minimapNodeColor"
        :node-stroke-color="minimapNodeStrokeColor"
        :node-stroke-width="2"
        :mask-color="'rgba(7, 10, 18, 0.75)'"
        :mask-stroke-color="'rgba(34, 211, 238, 0.6)'"
        :mask-stroke-width="1.5"
        aria-label="Graph minimap"
        @node-click="handleMinimapNodeClick"
      />
      <Panel v-if="minimapAutoHidden && !isPanning" position="bottom-right" class="minimap-warning-panel">
        <div class="minimap-warning-copy">MiniMap auto-hidden for heavy graph mode</div>
      </Panel>
      <Controls position="bottom-left" :show-interactive="false" />

      <Panel v-if="isLayoutPending" position="top-center">
        <div class="layout-loading-indicator">Updating graph layout...</div>
      </Panel>

      <Panel v-if="graphSettings.showFps" position="bottom-center" class="fps-panel">
        <div class="fps-shell" :class="{ 'fps-shell-advanced': graphSettings.showFpsAdvanced }">
          <div
            class="fps-counter"
            :class="{ 'fps-low': fps < 30, 'fps-ok': fps >= 30 && fps < 55, 'fps-good': fps >= 55 }"
          >
            {{ fps }} <span class="fps-label">FPS</span>
          </div>
          <template v-if="graphSettings.showFpsAdvanced">
            <div class="fps-stats-grid">
              <div class="fps-stat-card">
                <span class="fps-stat-label">Min</span>
                <span class="fps-stat-value">{{ fpsStats.min }}</span>
              </div>
              <div class="fps-stat-card">
                <span class="fps-stat-label">Max</span>
                <span class="fps-stat-value">{{ fpsStats.max }}</span>
              </div>
              <div class="fps-stat-card">
                <span class="fps-stat-label">Avg</span>
                <span class="fps-stat-value">{{ fpsStats.avg.toFixed(1) }}</span>
              </div>
              <div class="fps-stat-card">
                <span class="fps-stat-label">P90</span>
                <span class="fps-stat-value">{{ fpsStats.p90 }}</span>
              </div>
            </div>
            <div class="fps-chart-wrapper">
              <svg
                class="fps-chart"
                :viewBox="`0 0 ${FPS_CHART_WIDTH} ${FPS_CHART_HEIGHT}`"
                preserveAspectRatio="none"
                role="img"
                aria-label="Real-time FPS trend"
              >
                <line x1="0" :y1="fpsTargetLineY" :x2="FPS_CHART_WIDTH" :y2="fpsTargetLineY" class="fps-chart-target" />
                <polyline v-if="fpsChartPoints" :points="fpsChartPoints" class="fps-chart-line" />
              </svg>
              <div class="fps-chart-caption">Last {{ fpsStats.sampleCount }} samples</div>
              <div class="fps-chart-caption">
                Edge virtualization:
                <template v-if="edgeVirtualizationRuntimeMode === 'worker'">
                  worker (visible {{ edgeVirtualizationWorkerStats.lastVisibleCount }}, hidden
                  {{ edgeVirtualizationWorkerStats.lastHiddenCount }}, stale
                  {{ edgeVirtualizationWorkerStats.staleResponses }})
                </template>
                <template v-else>
                  main-thread
                </template>
              </div>
            </div>
          </template>
        </div>
      </Panel>
      <Panel v-if="isHybridCanvasMode" position="top-right" class="renderer-mode-panel">
        <div class="renderer-mode-copy">Hybrid canvas edge renderer active</div>
      </Panel>

      <Panel position="top-right" class="graph-stats-panel">
        <details class="graph-stats-shell">
          <summary class="graph-stats-summary">
            <span>Graph Stats</span>
            <span class="graph-stats-summary-metrics">{{ renderedNodeCount }} nodes · {{ renderedEdgeCount }} edges</span>
          </summary>
          <div class="graph-stats-content">
            <dl class="graph-stats-overview">
              <div class="graph-stats-overview-row">
                <dt>Nodes</dt>
                <dd>{{ renderedNodeCount }}</dd>
              </div>
              <div class="graph-stats-overview-row">
                <dt>Edges</dt>
                <dd>{{ renderedEdgeCount }}</dd>
              </div>
            </dl>

            <section class="graph-stats-section">
              <h4>Node Types</h4>
              <ul class="graph-stats-list">
                <li v-for="entry in renderedNodeTypeCounts" :key="`node-type-${entry.type}`" class="graph-stats-list-row">
                  <span class="graph-stats-type">{{ entry.type }}</span>
                  <span class="graph-stats-count">{{ entry.count }}</span>
                </li>
              </ul>
            </section>

            <section class="graph-stats-section">
              <h4>Edge Types</h4>
              <ul v-if="renderedEdgeTypeCounts.length > 0" class="graph-stats-list">
                <li v-for="entry in renderedEdgeTypeCounts" :key="`edge-type-${entry.type}`" class="graph-stats-list-row">
                  <span class="graph-stats-type">{{ entry.type }}</span>
                  <span class="graph-stats-count">{{ entry.count }}</span>
                </li>
              </ul>
              <div v-else class="graph-stats-empty">No visible edges</div>
            </section>
          </div>
        </details>
      </Panel>

      <Panel v-if="scopeMode !== 'overview'" position="bottom-left">
        <button
          @click="handleReturnToOverview"
          class="px-4 py-2 bg-primary-main text-white rounded-md hover:bg-primary-dark transition-colors shadow-lg border border-primary-light"
          aria-label="Return to full graph view"
        >
          ← Back to Full Graph
        </button>
      </Panel>

      <Panel position="bottom-left" class="insights-dashboard-panel">
        <InsightsDashboard />
      </Panel>
    </VueFlow>
    <CanvasEdgeLayer
      v-if="isHybridCanvasMode"
      :edges="edges"
      :nodes="nodes"
      :viewport="viewportState"
      :highlighted-edge-ids="highlightedEdgeIdList"
      :dim-non-highlighted="true"
      class="absolute inset-0"
      @canvas-unavailable="handleCanvasUnavailable"
    />
    <NodeDetails
      v-if="selectedNode"
      :node="selectedNode"
      :data="props.data"
      :nodes="nodes"
      :edges="edges"
      @open-symbol-usage="handleOpenSymbolUsageGraph"
    />
    <IssuesPanel v-if="issuesStore.panelOpen" />
    <NodeContextMenu
      v-if="contextMenu"
      :node-id="contextMenu.nodeId"
      :node-label="contextMenu.nodeLabel"
      :x="contextMenu.x"
      :y="contextMenu.y"
      @close="contextMenu = null"
      @focus-node="handleFocusNode"
      @isolate-neighborhood="isolateNeighborhood"
    />
  </div>
</template>

<style scoped>
/* ── Pan performance: kill all transitions & pointer-events during active pan ── */
.dependency-graph-root.graph-panning :deep(.vue-flow__edge-path) {
  transition: none !important;
}

.dependency-graph-root.graph-panning :deep(.vue-flow__node) {
  transition: none !important;
  will-change: transform;
}

.dependency-graph-root.graph-layout-measuring :deep(.vue-flow__node) {
  content-visibility: visible !important;
  contain-intrinsic-size: auto !important;
}

.dependency-graph-root.graph-panning :deep(.base-node-container) {
  box-shadow: none !important;
}

.dependency-graph-root.graph-panning :deep(.vue-flow__edge) {
  pointer-events: none !important;
}

.dependency-graph-root.graph-heavy-edges :deep(.vue-flow__edge-path) {
  transition: none !important;
}

.dependency-graph-root.graph-isolate-animating :deep(.vue-flow__node) {
  transition: opacity 140ms linear !important;
}

.dependency-graph-root :deep(.vue-flow__node) {
  transition: opacity 120ms linear;
}

.dependency-graph-root :deep(.vue-flow__edge-path) {
  transition:
    opacity 140ms ease-out,
    stroke-width 140ms ease-out;
}

/* ── Selection highlighting ── */

/* Selected (clicked) node */
.dependency-graph-root :deep(.vue-flow__node.selection-target) {
  z-index: 11 !important;
}

.dependency-graph-root :deep(.vue-flow__node.selection-target .base-node-container) {
  border-color: #22d3ee !important;
  outline: 2px solid rgba(34, 211, 238, 0.34);
  outline-offset: 0;
  box-shadow: 0 2px 6px rgba(2, 6, 23, 0.22) !important;
}

/* Nodes connected to the selection */
.dependency-graph-root :deep(.vue-flow__node.selection-connected) {
  z-index: 10 !important;
}

.dependency-graph-root :deep(.vue-flow__node.selection-connected .base-node-container) {
  border-color: rgba(34, 211, 238, 0.5) !important;
  outline: 1px solid rgba(34, 211, 238, 0.26);
  outline-offset: 0;
  box-shadow: 0 1px 4px rgba(2, 6, 23, 0.16) !important;
}

/* Dimmed non-connected nodes */
.dependency-graph-root :deep(.vue-flow__node.selection-dimmed) {
  opacity: 0.25 !important;
  transition: opacity 180ms ease-out !important;
}

/* Connected edges — highlighted with thicker stroke and increased opacity.
   Uses stroke-width for emphasis instead of expensive drop-shadow filter. */
.dependency-graph-root :deep(.vue-flow__edge.edge-selection-highlighted .vue-flow__edge-path) {
  stroke-width: 3px !important;
  stroke-opacity: 1 !important;
}

/* Dimmed non-connected edges */
.dependency-graph-root :deep(.vue-flow__edge.edge-selection-dimmed .vue-flow__edge-path) {
  opacity: 0.1 !important;
}

@keyframes edge-hover-pulse {
  0%,
  100% {
    stroke: var(--edge-hover-base-stroke, #404040);
  }
  50% {
    stroke: #facc15;
  }
}

/* Hovered node's connected edges are raised and thickened. */
.dependency-graph-root :deep(.vue-flow__edge.edge-hover-highlighted) {
  z-index: 12 !important;
}

.dependency-graph-root :deep(.vue-flow__edge.edge-hover-highlighted .vue-flow__edge-path) {
  stroke-width: 2.8px !important;
  stroke: var(--edge-hover-base-stroke, #404040);
  stroke-opacity: 1;
  animation: edge-hover-pulse 1.4s ease-in-out infinite;
}

/* ── Node Toolbar (teleported outside node DOM) ── */

.dependency-graph-root :deep(.node-toolbar-actions) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.25rem;
  padding: 0.3rem;
  background: rgba(15, 23, 42, 0.97);
  border: 1px solid rgba(var(--border-default-rgb), 0.6);
  border-radius: 0.375rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  opacity: 0;
  transform: translateX(-6px);
  pointer-events: none;
  transition:
    opacity 160ms ease-out,
    transform 160ms ease-out;
}

.dependency-graph-root :deep(.node-toolbar-actions.node-toolbar-visible) {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.dependency-graph-root :deep(.node-toolbar-button) {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid rgba(var(--border-default-rgb), 0.5);
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  font-size: 0.68rem;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 140ms ease-out,
    color 140ms ease-out,
    border-color 140ms ease-out;
}

.dependency-graph-root :deep(.node-toolbar-icon) {
  font-size: 0.8rem;
  line-height: 1;
}

.dependency-graph-root :deep(.node-toolbar-button:hover) {
  background: rgba(255, 255, 255, 0.14);
  color: var(--text-primary);
  border-color: var(--border-hover);
}

.dependency-graph-root :deep(.node-toolbar-button:focus-visible) {
  outline: 2px solid var(--border-focus);
  outline-offset: 1px;
}

/* ── Layout loading ── */

.layout-loading-indicator {
  padding: 0.45rem 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.5);
  background: rgba(15, 23, 42, 0.92);
  border-radius: 0.5rem;
  color: rgba(226, 232, 240, 0.95);
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35);
}

/* ── FPS counter ── */

.fps-panel {
  pointer-events: none;
}

.fps-shell {
  min-width: 5rem;
}

.fps-shell-advanced {
  min-width: 17rem;
}

.fps-counter {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 1.1rem;
  font-weight: 700;
  padding: 0.4rem 0.85rem;
  border-radius: 0.5rem;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.3);
  letter-spacing: 0.05em;
  min-width: 5rem;
  text-align: center;
}

.fps-stats-grid {
  margin-top: 0.4rem;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.35rem;
}

.fps-stat-card {
  border-radius: 0.35rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.84);
  padding: 0.2rem 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.fps-stat-label {
  font-family: 'Inter', 'SF Pro Text', system-ui, sans-serif;
  color: rgba(148, 163, 184, 0.95);
  font-size: 0.62rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.fps-stat-value {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  color: rgba(226, 232, 240, 0.98);
  font-size: 0.78rem;
  font-weight: 650;
  line-height: 1.15;
}

.fps-chart-wrapper {
  margin-top: 0.4rem;
}

.fps-chart {
  width: 100%;
  height: 3.5rem;
  border-radius: 0.4rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: linear-gradient(to top, rgba(34, 211, 238, 0.08), rgba(34, 211, 238, 0.01)), rgba(15, 23, 42, 0.88);
}

.fps-chart-target {
  stroke: rgba(244, 63, 94, 0.5);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.fps-chart-line {
  fill: none;
  stroke: #22d3ee;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.fps-chart-caption {
  margin-top: 0.2rem;
  text-align: right;
  font-size: 0.62rem;
  color: rgba(148, 163, 184, 0.9);
  letter-spacing: 0.01em;
}

.fps-label {
  font-size: 0.8rem;
  opacity: 0.6;
  font-weight: 500;
}

.fps-good {
  color: #4ade80;
}

.fps-ok {
  color: #fbbf24;
}

.fps-low {
  color: #f87171;
}

.graph-stats-panel {
  margin-top: 4.25rem;
  margin-right: 0.5rem;
}

.graph-stats-shell {
  width: min(19rem, calc(100vw - 1.5rem));
  border-radius: 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.94);
  color: rgba(226, 232, 240, 0.95);
  box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35);
}

.graph-stats-summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 0.65rem;
  border-radius: 0.5rem;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.graph-stats-summary::-webkit-details-marker {
  display: none;
}

.graph-stats-summary::marker {
  display: none;
}

.graph-stats-summary::after {
  content: '▸';
  font-size: 0.65rem;
  opacity: 0.9;
  transition: transform 120ms ease-out;
}

.graph-stats-shell[open] .graph-stats-summary::after {
  transform: rotate(90deg);
}

.graph-stats-summary:focus-visible {
  outline: 2px solid rgba(34, 211, 238, 0.65);
  outline-offset: 2px;
}

.graph-stats-summary-metrics {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  color: rgba(148, 163, 184, 0.95);
  font-size: 0.68rem;
  font-weight: 600;
}

.graph-stats-content {
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  padding: 0.55rem 0.65rem 0.6rem;
  max-height: min(23rem, calc(100vh - 9.5rem));
  overflow: auto;
}

.graph-stats-overview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
  margin: 0;
}

.graph-stats-overview-row {
  margin: 0;
  border-radius: 0.35rem;
  border: 1px solid rgba(100, 116, 139, 0.35);
  background: rgba(15, 23, 42, 0.72);
  padding: 0.22rem 0.4rem;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.graph-stats-overview-row dt {
  font-size: 0.62rem;
  color: rgba(148, 163, 184, 0.92);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.graph-stats-overview-row dd {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 0.74rem;
  color: rgba(226, 232, 240, 0.98);
}

.graph-stats-section {
  margin-top: 0.6rem;
}

.graph-stats-section h4 {
  margin: 0 0 0.25rem;
  font-size: 0.64rem;
  color: rgba(148, 163, 184, 0.95);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.graph-stats-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.14rem;
}

.graph-stats-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  font-size: 0.7rem;
}

.graph-stats-type {
  color: rgba(203, 213, 225, 0.96);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-stats-count {
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  color: rgba(148, 163, 184, 0.96);
}

.graph-stats-empty {
  font-size: 0.67rem;
  color: rgba(148, 163, 184, 0.9);
}

.minimap-warning-panel,
.renderer-mode-panel {
  pointer-events: none;
}

.minimap-warning-copy,
.renderer-mode-copy {
  padding: 0.35rem 0.6rem;
  border-radius: 0.4rem;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: rgba(226, 232, 240, 0.9);
  font-size: 0.68rem;
  letter-spacing: 0.02em;
}
</style>
