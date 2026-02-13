<script setup lang="ts">
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MarkerType, Panel, Position, VueFlow, applyNodeChanges, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';

import { createLogger } from '../../../shared/utils/logger';
import { WebWorkerLayoutProcessor } from '../../layout/WebWorkerLayoutProcessor';
import { useGraphSettings } from '../../stores/graphSettings';
import { useGraphStore } from '../../stores/graphStore';
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
import NodeDetails from './components/NodeDetails.vue';
import { nodeTypes } from './nodes/nodes';
import { ISOLATE_EXPAND_ALL_KEY, NODE_ACTIONS_KEY } from './nodes/utils';
import { useEdgeVirtualization } from './useEdgeVirtualization';
import { useGraphInteractionController } from './useGraphInteractionController';
import { useFpsCounter } from './useFpsCounter';
import { classifyWheelIntent, isMacPlatform } from './utils/wheelIntent';

import type { DefaultEdgeOptions, NodeChange } from '@vue-flow/core';

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
const interaction = useGraphInteractionController();

const EDGE_VISIBLE_RENDER_THRESHOLD = 1800;
const MINIMAP_AUTO_HIDE_EDGE_THRESHOLD = 2800;
const HEAVY_EDGE_STYLE_THRESHOLD = 2200;
const HIGH_EDGE_MARKER_THRESHOLD = 1800;
const LOW_DETAIL_EDGE_ZOOM_THRESHOLD = 0.35;
const EDGE_RENDERER_FALLBACK_EDGE_THRESHOLD = 3000;
const EDGE_RENDERER_MODE =
  (import.meta.env['VITE_EDGE_RENDER_MODE'] as string | undefined) ?? 'svg';
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

const { fitView, updateNodeInternals, panBy, zoomTo, getViewport, setViewport, removeSelectedElements } = useVueFlow();

const isMac = computed(() => isMacPlatform());
const graphRootRef = ref<HTMLElement | null>(null);
const edgeVirtualizationEnabled = ref(true);
const isPanning = ref(false);
const isIsolateAnimating = ref(false);
const isolateExpandAll = ref(false);
let isolateAnimatingTimer: ReturnType<typeof setTimeout> | null = null;
const showFps = computed(() => graphSettings.showFps);
const viewportState = ref({ ...DEFAULT_VIEWPORT });
const { fps, fpsHistory, fpsStats, start: startFps, stop: stopFps } = useFpsCounter(showFps);
const FPS_CHART_WIDTH = 220;
const FPS_CHART_HEIGHT = 56;
let panEndTimer: ReturnType<typeof setTimeout> | null = null;
let selectionHighlightRafId: number | null = null;

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
const {
  onViewportChange: onEdgeVirtualizationViewportChange,
  suspend: suspendEdgeVirtualization,
  resume: resumeEdgeVirtualization,
  dispose: disposeEdgeVirtualization,
} = useEdgeVirtualization({
  nodes: computed(() => graphStore['nodes']),
  edges: computed(() => graphStore['edges']),
  getViewport,
  getContainerRect: () => cachedContainerRect,
  setEdgeVisibility: (visibilityMap) => graphStore.setEdgeVisibility(visibilityMap),
  enabled: edgeVirtualizationEnabled,
});

const syncViewportState = (): void => {
  viewportState.value = { ...getViewport() };
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

  onEdgeVirtualizationViewportChange();
};

const isHybridCanvasMode = computed(() => {
  return EDGE_RENDERER_MODE === 'hybrid-canvas-experimental' &&
    edges.value.length >= EDGE_RENDERER_FALLBACK_EDGE_THRESHOLD;
});

const renderedEdges = computed(() => (isHybridCanvasMode.value ? [] : edges.value));
const useOnlyRenderVisibleElements = computed(() => {
  return !isHybridCanvasMode.value &&
    edgeVirtualizationEnabled.value &&
    edges.value.length >= EDGE_VISIBLE_RENDER_THRESHOLD;
});
const isHeavyEdgeMode = computed(() => edges.value.length >= HEAVY_EDGE_STYLE_THRESHOLD);
const minimapAutoHidden = computed(() => edges.value.length >= MINIMAP_AUTO_HIDE_EDGE_THRESHOLD);
const showMiniMap = computed(() => !isHybridCanvasMode.value && !isPanning.value && !minimapAutoHidden.value);

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
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
    zIndex: 2,
    type: 'smoothstep',
  };
});

const onMoveStart = (): void => {
  if (panEndTimer) clearTimeout(panEndTimer);
  isPanning.value = true;
};

const onMove = (): void => {
  syncViewportState();
  onEdgeVirtualizationViewportChange();
};

const onMoveEnd = (): void => {
  // Short delay before removing panning class to avoid flicker on quick gestures
  if (panEndTimer) clearTimeout(panEndTimer);
  panEndTimer = setTimeout(() => {
    isPanning.value = false;
    syncViewportState();
    // Recalculate edge visibility after pan stops
    onEdgeVirtualizationViewportChange();
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

const searchHighlightState: SearchHighlightState = {
  hasResults: false,
  hasPath: false,
  matchingNodeIds: new Set<string>(),
  pathNodeIds: new Set<string>(),
  matchingEdgeIds: new Set<string>(),
};

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
const TWO_PASS_MEASURE_NODE_THRESHOLD = 240;

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

function computeLayoutCacheKey(
  nodes: DependencyNode[],
  edgeList: GraphEdge[],
  config: typeof layoutConfig
): string {
  // Build a fast hash from node/edge IDs + layout direction/algorithm
  const nodeIds = nodes.map((n) => n.id).sort().join(',');
  const edgeIds = edgeList.map((e) => e.id).sort().join(',');
  return `${config.algorithm}:${config.direction}:${config.nodeSpacing}:${config.rankSpacing}:${config.edgeSpacing}:${nodeIds.length}:${edgeIds.length}:${simpleHash(nodeIds)}:${simpleHash(edgeIds)}`;
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
let resizeObserver: ResizeObserver | null = null;

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
  if (node.class === undefined) {
    return node;
  }
  // VueFlow merges node updates; omitting `class` can leave stale internal classes.
  // Overwrite explicitly to clear previous selection classes.
  return { ...node, class: '' } as DependencyNode;
};

const stripEdgeClass = (edge: GraphEdge): GraphEdge => {
  if (edge.class === undefined) {
    return edge;
  }
  return { ...edge, class: '' } as GraphEdge;
};

const initializeLayoutProcessor = () => {
  layoutRequestVersion += 1;

  if (!layoutProcessor) {
    layoutProcessor = new WebWorkerLayoutProcessor(getLayoutProcessorConfig());
    return;
  }

  layoutProcessor.updateConfig(getLayoutProcessorConfig());
};

const applySelectionHighlight = (selected: DependencyNode | null): void => {
  // Isolation mode manages its own styles
  if (interaction.scopeMode.value === 'isolate') return;

  const connectedNodeIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();

  if (selected) {
    connectedNodeIds.add(selected.id);
    for (const edge of edges.value) {
      if (!edge.hidden && (edge.source === selected.id || edge.target === selected.id)) {
        connectedEdgeIds.add(edge.id);
        connectedNodeIds.add(edge.source);
        connectedNodeIds.add(edge.target);
      }
    }
  }

  const hasSelection = selected !== null;

  const updatedNodes = nodes.value.map((node) => {
    let nodeClass: string | undefined;

    if (hasSelection) {
      if (node.id === selected.id) nodeClass = 'selection-target';
      else if (connectedNodeIds.has(node.id)) nodeClass = 'selection-connected';
      else nodeClass = 'selection-dimmed';
    }

    if (node.class === nodeClass) return node;
    if (!nodeClass) {
      return stripNodeClass(node);
    }
    return { ...node, class: nodeClass } as DependencyNode;
  });

  const updatedEdges = edges.value.map((edge) => {
    let edgeClass: string | undefined;
    if (hasSelection) {
      edgeClass = connectedEdgeIds.has(edge.id) ? 'edge-selection-highlighted' : 'edge-selection-dimmed';
    }
    if (edge.class === edgeClass) return edge;
    if (!edgeClass) {
      return stripEdgeClass(edge);
    }
    return { ...edge, class: edgeClass } as GraphEdge;
  });

  graphStore['setNodes'](updatedNodes);
  graphStore['setEdges'](updatedEdges);
};

const setSelectedNode = (node: DependencyNode | null) => {
  graphStore['setSelectedNode'](node);
  interaction.setSelectionNodeId(node?.id ?? null);
  if (!node) {
    interaction.setCameraMode('free');
    removeSelectedElements();
  }
  // Debounce via rAF to coalesce rapid selection changes (keyboard nav)
  if (selectionHighlightRafId !== null) {
    cancelAnimationFrame(selectionHighlightRafId);
  }
  selectionHighlightRafId = requestAnimationFrame(() => {
    selectionHighlightRafId = null;
    applySelectionHighlight(node);
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

const measureLayoutInsets = (layoutedNodes: DependencyNode[]): { nodes: DependencyNode[]; hasChanges: boolean } => {
  const measurableNodes = layoutedNodes.filter(
    (node) => node.type === 'module' || node.type === 'package' || node.type === 'group' || node.data?.isContainer === true
  );
  if (measurableNodes.length === 0) {
    return { nodes: layoutedNodes, hasChanges: false };
  }

  // Batch only container-node measurements (much smaller set than all graph nodes).
  const measurements = new Map<string, { width: number; height: number; headerH: number; bodyH: number; subnodesH: number }>();
  measurableNodes.forEach((node) => {
    const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(node.id) : node.id;
    const element = document.querySelector<HTMLElement>(`.vue-flow__node[data-id="${escapedId}"]`);
    if (!element) {
      return;
    }

    measurements.set(node.id, {
      width: element.offsetWidth,
      height: element.offsetHeight,
      headerH: element.querySelector<HTMLElement>('.base-node-header')?.offsetHeight ?? 0,
      bodyH: element.querySelector<HTMLElement>('.base-node-body')?.offsetHeight ?? 0,
      subnodesH: element.querySelector<HTMLElement>('.base-node-subnodes')?.offsetHeight ?? 0,
    });
  });

  let hasChanges = false;
  const measuredNodes = layoutedNodes.map((node) => {
    const shouldMeasure = node.type === 'module' || node.type === 'package' || node.type === 'group' || node.data?.isContainer === true;
    if (!shouldMeasure) {
      return node;
    }

    const m = measurements.get(node.id);
    if (!m) {
      return node;
    }

    // Reserve full visible top content so nested children never overlap card sections.
    const measuredTopInset = Math.max(96, Math.round(m.headerH + m.bodyH + m.subnodesH + 12));

    const currentTopInset = (node.data?.layoutInsets as { top?: number } | undefined)?.top ?? 0;
    const currentMeasured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
    const widthDelta = Math.abs((currentMeasured?.width ?? 0) - m.width);
    const heightDelta = Math.abs((currentMeasured?.height ?? 0) - m.height);
    const insetDelta = Math.abs(currentTopInset - measuredTopInset);
    const cached = nodeMeasurementCache.get(node.id);
    const cacheDeltaWidth = Math.abs((cached?.width ?? 0) - m.width);
    const cacheDeltaHeight = Math.abs((cached?.height ?? 0) - m.height);
    const cacheDeltaInset = Math.abs((cached?.topInset ?? 0) - measuredTopInset);
    const changed = widthDelta > 1 || heightDelta > 1 || insetDelta > 1 || cacheDeltaWidth > 1 || cacheDeltaHeight > 1 || cacheDeltaInset > 1;

    if (!changed) {
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
    return {
      ...node,
      data: {
        ...node.data,
        layoutInsets: {
          top: measuredTopInset,
        },
      },
      measured: {
        width: m.width,
        height: m.height,
      },
    } as DependencyNode;
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

    if (prev.sourcePosition !== node.sourcePosition || prev.targetPosition !== node.targetPosition || prev.parentNode !== node.parentNode) {
      changedIds.push(node.id);
      return;
    }

    const prevMeasured = (prev as { measured?: { width?: number; height?: number } }).measured;
    const nextMeasured = (node as { measured?: { width?: number; height?: number } }).measured;
    const prevStyle = typeof prev.style === 'object' ? (prev.style as Record<string, unknown>) : {};
    const nextStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};

    const prevWidth = prevMeasured?.width ?? toDimensionValue(prevStyle['width']) ?? toDimensionValue(prev.width) ?? 0;
    const prevHeight = prevMeasured?.height ?? toDimensionValue(prevStyle['height']) ?? toDimensionValue(prev.height) ?? 0;
    const nextWidth = nextMeasured?.width ?? toDimensionValue(nextStyle['width']) ?? toDimensionValue(node.width) ?? 0;
    const nextHeight = nextMeasured?.height ?? toDimensionValue(nextStyle['height']) ?? toDimensionValue(node.height) ?? 0;

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
    edges: resultEdges,
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
      graphStore['setNodes'](cachedEntry.nodes);
      graphStore['setEdges'](cachedEntry.edges);
      pruneNodeMeasurementCache(cachedEntry.nodes);
      await nextTick();
      const changedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, cachedEntry.nodes);
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

    // First pass commit - needed to render DOM for measurement
    const previousNodes = graphStore['nodes'];
    graphStore['setNodes'](normalized.nodes);
    graphStore['setEdges'](normalized.edges);
    pruneNodeMeasurementCache(normalized.nodes);

    await nextTick();
    const firstPassChangedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, normalized.nodes);
    if (firstPassChangedNodeIds.length > 0) {
      updateNodeInternals(firstPassChangedNodeIds);
    }

    if (twoPassMeasure) {
      const measured = measureLayoutInsets(normalized.nodes);
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
        if (secondPassChangedNodeIds.length > 0) {
          updateNodeInternals(secondPassChangedNodeIds);
        }
      }
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
    hideTestFiles: graphSettings.hideTestFiles,
    memberNodeMode: graphSettings.memberNodeMode,
    highlightOrphanGlobal: graphSettings.highlightOrphanGlobal,
  });

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
  syncViewportState();
  onEdgeVirtualizationViewportChange();
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
  const sourceNodes = snapshot?.nodes ?? nodes.value;
  const sourceEdges = snapshot?.edges ?? edges.value;
  const targetNode = sourceNodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }

  const connectedNodeIds = new Set<string>([nodeId]);
  const inboundIds = new Set<string>();
  const outboundIds = new Set<string>();
  sourceEdges.forEach((edge) => {
    if (edge.source === nodeId) {
      connectedNodeIds.add(edge.target);
      outboundIds.add(edge.target);
    } else if (edge.target === nodeId) {
      connectedNodeIds.add(edge.source);
      inboundIds.add(edge.source);
    }
  });

  const nodeById = new Map(sourceNodes.map((n) => [n.id, n]));
  const inbound = [...inboundIds].filter((id) => !outboundIds.has(id)).map((id) => nodeById.get(id)!).filter(Boolean);
  const outbound = [...outboundIds].filter((id) => !inboundIds.has(id)).map((id) => nodeById.get(id)!).filter(Boolean);
  const bidirectional = [...inboundIds].filter((id) => outboundIds.has(id)).map((id) => nodeById.get(id)!).filter(Boolean);

  // Distribute bidirectional nodes to the smaller side for balance
  for (const node of bidirectional) {
    if (inbound.length <= outbound.length) {
      inbound.push(node);
    } else {
      outbound.push(node);
    }
  }

  const layoutPositions = computeIsolateLayout(targetNode, inbound, outbound, layoutConfig.direction);

  const isolatedNodes = sourceNodes
    .filter((node) => connectedNodeIds.has(node.id))
    .map((node) => {
      const baseNode = stripNodeClass(node);
      const layoutPos = layoutPositions.get(node.id);
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
    });

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
  isolateExpandAll.value = true;
  graphStore['setNodes'](isolatedNodes);
  graphStore['setEdges'](isolatedEdges);
  graphStore.setViewMode('isolate');
  interaction.setScopeMode('isolate');
  setSelectedNode(targetNode);

  await fitView({
    duration: 350,
    padding: 0.35,
    nodes: Array.from(connectedNodeIds),
  });
  syncViewportState();
  onEdgeVirtualizationViewportChange();
};

const nodeActions = {
  focusNode: (nodeId: string) => void handleFocusNode(nodeId),
  isolateNeighborhood: (nodeId: string) => void isolateNeighborhood(nodeId),
};

// Provide node actions to child nodes via injection (replaces global CustomEvent)
provide(NODE_ACTIONS_KEY, nodeActions);
provide(ISOLATE_EXPAND_ALL_KEY, isolateExpandAll);

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
};

const handleWheel = (event: WheelEvent): void => {
  if (!isMac.value) return;

  const intent = classifyWheelIntent(event, isMac.value);
  const target = event.target as HTMLElement;

  // Pinch-to-zoom: prevent browser page zoom everywhere, handle graph zoom ourselves
  if (intent === 'pinch') {
    event.preventDefault();
    const viewport = getViewport();
    const nextZoom = computeZoomFromDelta(viewport.zoom, event.deltaY, MAC_PINCH_ZOOM_SENSITIVITY);
    applyZoomAtPointer(event, viewport, nextZoom);
    return;
  }

  // Allow normal scrolling inside scrollable overlay panels (e.g. NodeDetails)
  if (target.closest('[data-graph-overlay-scrollable]')) return;

  event.preventDefault();

  if (intent === 'trackpadScroll') {
    panBy({ x: -event.deltaX, y: -event.deltaY });
    syncViewportState();
    onEdgeVirtualizationViewportChange();
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
    onEdgeVirtualizationViewportChange();
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

const handleShowFpsToggle = (value: boolean): void => {
  graphSettings.setShowFps(value);
};

const handleFpsAdvancedToggle = (value: boolean): void => {
  graphSettings.setShowFpsAdvanced(value);
};

const handleNodesChange = (changes: NodeChange[]) => {
  if (!changes.length) return;

  const filteredChanges = filterNodeChangesForFolderMode(changes, nodes.value, graphSettings.clusterByFolder);
  if (!filteredChanges.length) return;

  // Keep app-managed selection as the single source of truth.
  const structuralChanges = filteredChanges.filter((change) => change.type !== 'select');
  if (!structuralChanges.length) return;

  const updatedNodes = applyNodeChanges(
    structuralChanges,
    nodes.value as unknown as never[]
  ) as unknown as DependencyNode[];
  graphStore['setNodes'](updatedNodes);
  reconcileSelectedNodeAfterStructuralChange(updatedNodes);
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
  const matchingNodeIds = new Set(result.nodes.map((n) => n.id));
  const pathNodeIds = new Set(result.path?.map((n) => n.id) ?? []);
  const matchingEdgeIds = new Set(result.edges.map((e) => e.id));
  const hasResults = matchingNodeIds.size > 0;
  const hasPath = pathNodeIds.size > 0;

  const shouldRefreshAllNodes =
    hasResults !== searchHighlightState.hasResults || (hasResults && searchHighlightState.hasResults && hasPath !== searchHighlightState.hasPath);
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

  let nodesChanged = false;
  let searchedNodes = nodes.value;
  const nodeIndexById = new Map(nodes.value.map((node, index) => [node.id, index]));

  nodeIdsToUpdate.forEach((nodeId) => {
    const nodeIndex = nodeIndexById.get(nodeId);
    if (nodeIndex === undefined) {
      return;
    }

    const node = searchedNodes[nodeIndex];
    if (!node) {
      return;
    }

    const isMatch = matchingNodeIds.has(node.id);
    const isOnPath = hasPath && pathNodeIds.has(node.id);
    const opacity = !hasResults ? 1 : hasPath ? (isOnPath ? 1 : 0.2) : isMatch ? 1 : 0.2;
    const borderWidth =
      hasPath && isOnPath ? graphTheme.edges.sizes.width.selected : hasPath ? graphTheme.edges.sizes.width.default : undefined;
    const currentStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
    const currentOpacity = toDimensionValue(currentStyle['opacity']) ?? 1;
    const currentBorderWidth = currentStyle['borderWidth'];

    const opacityChanged = Math.abs(currentOpacity - opacity) > 0.001;
    const borderWidthChanged = String(currentBorderWidth ?? '') !== String(borderWidth ?? '');
    const classChanged = node.class !== undefined;

    if (!opacityChanged && !borderWidthChanged && !classChanged) {
      return;
    }

    if (!nodesChanged) {
      searchedNodes = [...searchedNodes];
      nodesChanged = true;
    }

    const baseNode = stripNodeClass(node);
    searchedNodes[nodeIndex] = {
      ...baseNode,
      style: mergeNodeInteractionStyle(baseNode, {
        opacity,
        borderWidth,
      }),
    } as DependencyNode;
  });

  if (nodesChanged) {
    graphStore['setNodes'](searchedNodes);
  }

  let edgesChanged = false;
  let searchedEdges = edges.value;
  const edgeIndexById = new Map(edges.value.map((edge, index) => [edge.id, index]));

  edgeIdsToUpdate.forEach((edgeId) => {
    const edgeIndex = edgeIndexById.get(edgeId);
    if (edgeIndex === undefined) {
      return;
    }

    const edge = searchedEdges[edgeIndex];
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

    if (!edgesChanged) {
      searchedEdges = [...searchedEdges];
      edgesChanged = true;
    }

    const baseEdge = stripEdgeClass(edge);
    searchedEdges[edgeIndex] = {
      ...baseEdge,
      style: {
        ...getEdgeStyle(toDependencyEdgeKind(baseEdge.data?.type)),
        opacity,
      },
    } as GraphEdge;
  });

  if (edgesChanged) {
    graphStore['setEdges'](applyEdgeVisibility(searchedEdges, graphSettings.activeRelationshipTypes));
  }

  searchHighlightState.hasResults = hasResults;
  searchHighlightState.hasPath = hasPath;
  searchHighlightState.matchingNodeIds = new Set(matchingNodeIds);
  searchHighlightState.pathNodeIds = new Set(pathNodeIds);
  searchHighlightState.matchingEdgeIds = new Set(matchingEdgeIds);
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
            onEdgeVirtualizationViewportChange();
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
let hoveredNodeId: string | null = null;
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

const onNodeMouseEnter = ({ node }: { node: unknown }): void => {
  const entered = node as DependencyNode;
  if (hoveredNodeId && hoveredNodeId !== entered.id) {
    restoreHoverZIndex(hoveredNodeId);
  }
  hoveredNodeId = entered.id;
  elevateNodeAndChildren(entered.id);
};

const onNodeMouseLeave = ({ node }: { node: unknown }): void => {
  const left = node as DependencyNode;
  if (hoveredNodeId === left.id) {
    restoreHoverZIndex(left.id);
    hoveredNodeId = null;
  }
};

onMounted(() => {
  graphRootRef.value?.addEventListener('wheel', handleWheel, { passive: false });
  document.addEventListener('keydown', handleKeyDown);

  // Cache the .vue-flow container element and its rect to avoid DOM queries in handleWheel
  const flowContainer = graphRootRef.value?.querySelector('.vue-flow') as HTMLElement | null;
  if (flowContainer) {
    cachedFlowContainer = flowContainer;
    cachedContainerRect = flowContainer.getBoundingClientRect();
    resizeObserver = new ResizeObserver(() => {
      cachedContainerRect = cachedFlowContainer?.getBoundingClientRect() ?? null;
    });
    resizeObserver.observe(flowContainer);
  }
  syncViewportState();
});

onUnmounted(() => {
  if (panEndTimer) {
    clearTimeout(panEndTimer);
    panEndTimer = null;
  }
  if (selectionHighlightRafId !== null) {
    cancelAnimationFrame(selectionHighlightRafId);
    selectionHighlightRafId = null;
  }
  stopFps();
  graphRootRef.value?.removeEventListener('wheel', handleWheel);
  document.removeEventListener('keydown', handleKeyDown);
  resizeObserver?.disconnect();
  resizeObserver = null;
  cachedFlowContainer = null;
  cachedContainerRect = null;
  disposeEdgeVirtualization();
  if (hoveredNodeId) {
    restoreHoverZIndex(hoveredNodeId);
    hoveredNodeId = null;
  }
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
      },
    ]"
    role="application"
    aria-label="TypeScript dependency graph visualization"
    tabindex="0"
  >
    <VueFlow
      :nodes="nodes"
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
          <div class="fps-counter" :class="{ 'fps-low': fps < 30, 'fps-ok': fps >= 30 && fps < 55, 'fps-good': fps >= 55 }">
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
                <line
                  x1="0"
                  :y1="fpsTargetLineY"
                  :x2="FPS_CHART_WIDTH"
                  :y2="fpsTargetLineY"
                  class="fps-chart-target"
                />
                <polyline v-if="fpsChartPoints" :points="fpsChartPoints" class="fps-chart-line" />
              </svg>
              <div class="fps-chart-caption">Last {{ fpsStats.sampleCount }} samples</div>
            </div>
          </template>
        </div>
      </Panel>
      <Panel v-if="isHybridCanvasMode" position="top-right" class="renderer-mode-panel">
        <div class="renderer-mode-copy">Hybrid canvas edge renderer active</div>
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
    </VueFlow>
    <CanvasEdgeLayer
      v-if="isHybridCanvasMode"
      :edges="edges"
      :nodes="nodes"
      :viewport="viewportState"
      class="absolute inset-0"
    />
    <NodeDetails
      v-if="selectedNode"
      :node="selectedNode"
      :data="props.data"
      :nodes="nodes"
      :edges="edges"
      @open-symbol-usage="handleOpenSymbolUsageGraph"
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

.dependency-graph-root.graph-panning :deep(.vue-flow__edge) {
  pointer-events: none !important;
}

.dependency-graph-root.graph-heavy-edges :deep(.vue-flow__edge-path) {
  transition: none !important;
}

.dependency-graph-root.graph-isolate-animating :deep(.vue-flow__node) {
  transition:
    transform 350ms ease-in-out,
    opacity 180ms ease-out,
    filter 180ms ease-out !important;
}

.dependency-graph-root :deep(.vue-flow__node) {
  transition:
    transform 180ms ease-out,
    opacity 180ms ease-out;
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
  box-shadow:
    0 0 0 2px rgba(34, 211, 238, 0.3),
    0 0 20px rgba(34, 211, 238, 0.25),
    0 4px 12px rgba(0, 0, 0, 0.2) !important;
}

/* Nodes connected to the selection */
.dependency-graph-root :deep(.vue-flow__node.selection-connected) {
  z-index: 10 !important;
}

.dependency-graph-root :deep(.vue-flow__node.selection-connected .base-node-container) {
  border-color: rgba(34, 211, 238, 0.5) !important;
  box-shadow:
    0 0 12px rgba(34, 211, 238, 0.15),
    0 4px 12px rgba(0, 0, 0, 0.15) !important;
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
  background:
    linear-gradient(to top, rgba(34, 211, 238, 0.08), rgba(34, 211, 238, 0.01)),
    rgba(15, 23, 42, 0.88);
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
