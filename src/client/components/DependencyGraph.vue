<script setup lang="ts">
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MarkerType, Panel, VueFlow, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';

import { buildParentMap } from '../graph/cluster/folderMembership';
import { traverseGraph } from '../graph/traversal';
import { parseEnvBoolean, parseEnvInt } from '../utils/env';
import { buildOverviewGraph } from '../graph/buildGraphView';
import { nodeTypes } from '../nodes/nodes';
import {
  FOLDER_COLLAPSE_ACTIONS_KEY,
  HIGHLIGHT_ORPHAN_GLOBAL_KEY,
  ISOLATE_EXPAND_ALL_KEY,
  NODE_ACTIONS_KEY,
} from '../nodes/utils';
import { useGraphSettings } from '../stores/graphSettings';
import { useGraphStore } from '../stores/graphStore';
import { useInsightsStore } from '../stores/insightsStore';
import { useIssuesStore } from '../stores/issuesStore';
import { graphTheme } from '../theme/graphTheme';
import { useCollisionResolution } from '../composables/useCollisionResolution';
import { useEdgeVirtualizationOrchestrator } from '../composables/useEdgeVirtualizationOrchestrator';
import { useFpsCounter } from '../composables/useFpsCounter';
import { useGraphInteractionController } from '../composables/useGraphInteractionController';
import { useGraphLayout } from '../composables/useGraphLayout';
import { useGraphViewport, DEFAULT_VIEWPORT } from '../composables/useGraphViewport';
import { useIsolationMode } from '../composables/useIsolationMode';
import { createNodeDimensionTracker } from '../composables/useNodeDimensions';
import { useNodeHoverZIndex } from '../composables/useNodeHoverZIndex';
import { useSearchHighlighting } from '../composables/useSearchHighlighting';
import { useSelectionHighlighting } from '../composables/useSelectionHighlighting';
import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../layout/edgeGeometryPolicy';
import CanvasEdgeLayer from './CanvasEdgeLayer.vue';
import GraphControls from './GraphControls.vue';
import GraphSearch from './GraphSearch.vue';
import InsightsDashboard from './InsightsDashboard.vue';
import IssuesPanel from './IssuesPanel.vue';
import NodeContextMenu from './NodeContextMenu.vue';
import NodeDetails from './NodeDetails.vue';

import type { DefaultEdgeOptions } from '@vue-flow/core';
import type { LayoutConfig } from '../composables/useGraphLayout';
import type { DependencyNode, DependencyPackageGraph, GraphEdge } from '../types';

import '@vue-flow/controls/dist/style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

// ── Props & stores ──

export interface DependencyGraphProps {
  data: DependencyPackageGraph;
}

const props = defineProps<DependencyGraphProps>();

const graphStore = useGraphStore();
const graphSettings = useGraphSettings();
const issuesStore = useIssuesStore();
const insightsStore = useInsightsStore();
const interaction = useGraphInteractionController();

// ── Environment configuration ──

const EDGE_VISIBLE_RENDER_THRESHOLD = parseEnvInt('VITE_EDGE_VISIBLE_RENDER_THRESHOLD', 1400);
const MINIMAP_AUTO_HIDE_EDGE_THRESHOLD = 2800;
const HEAVY_EDGE_STYLE_THRESHOLD = 2200;
const HIGH_EDGE_MARKER_THRESHOLD = 1800;
const LOW_DETAIL_EDGE_ZOOM_THRESHOLD = 0.35;
const EDGE_RENDERER_FALLBACK_EDGE_THRESHOLD = parseEnvInt('VITE_CANVAS_EDGE_THRESHOLD', 2200);
const NODE_VISIBLE_RENDER_THRESHOLD = parseEnvInt('VITE_NODE_VISIBLE_RENDER_THRESHOLD', 320);
const EDGE_RENDERER_MODE = (import.meta.env['VITE_EDGE_RENDER_MODE'] as string | undefined) ?? 'svg';
const EDGE_VIRTUALIZATION_MODE =
  (import.meta.env['VITE_EDGE_VIRTUALIZATION_MODE'] as string | undefined) === 'worker' ? 'worker' : 'main';
const USE_CSS_SELECTION_HOVER = parseEnvBoolean('VITE_USE_CSS_SELECTION_HOVER', true);
const PERF_MARKS_ENABLED = parseEnvBoolean('VITE_PERF_MARKS', false);
const EDGE_VIEWPORT_RECALC_THROTTLE_MS = parseEnvInt('VITE_EDGE_VIEWPORT_RECALC_THROTTLE_MS', 80);

// ── VueFlow core ──

const {
  fitView,
  updateNodeInternals,
  panBy,
  zoomTo,
  getViewport,
  setViewport,
  removeSelectedElements,
  getNodes: vfGetNodes,
} = useVueFlow();

// ── Reactive store projections ──

const nodes = computed(() => graphStore['nodes']);
const edges = computed(() => graphStore['edges']);
const selectedNode = computed(() => graphStore['selectedNode']);
const scopeMode = computed(() => interaction.scopeMode.value);

// ── Local UI state ──

const graphRootRef = ref<HTMLElement | null>(null);
const contextMenu = ref<{ nodeId: string; nodeLabel: string; x: number; y: number } | null>(null);
const canvasRendererAvailable = ref(true);
const nodeDimensionTracker = createNodeDimensionTracker();

// ── FPS counter ──

const showFps = computed(() => graphSettings.showFps);
const { fps, fpsHistory, fpsStats, start: startFps, stop: stopFps } = useFpsCounter(showFps);
const FPS_CHART_WIDTH = 220;
const FPS_CHART_HEIGHT = 56;

const fpsChartScaleMax = computed(() => {
  if (!fpsHistory.value.length) return 60;
  return Math.max(60, ...fpsHistory.value);
});

const fpsChartPoints = computed(() => {
  const samples = fpsHistory.value;
  if (!samples.length) return '';

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

// ══════════════════════════════════════════════════════════════════
// Composable instantiation — order matters (dependency graph below)
//
//  graphUtils (pure, no deps)
//    ├── useGraphViewport (leaf)
//    ├── useEdgeVirtualizationOrchestrator (wraps existing composables)
//    ├── useSearchHighlighting (leaf)
//    ├── useNodeHoverZIndex (leaf)
//    ├── useGraphLayout (← viewport, edgeVirtualization, search)
//    ├── useCollisionResolution (← layout state)
//    ├── useSelectionHighlighting (← search, collision, hoverZIndex)
//    └── useIsolationMode (← layout, selection, viewport, edgeVirtualization)
// ══════════════════════════════════════════════════════════════════

// 1. Viewport — zoom, pan, viewport state
const viewport = useGraphViewport({
  getViewport,
  setViewport,
  zoomTo,
  panBy,
  onViewportChange: () => edgeVirtualization.requestViewportRecalc(),
});

const { viewportState, isPanning, isMac, handleWheel, onMoveStart, onMove, syncViewportState, initContainerCache } =
  viewport;

// 2. Edge virtualization orchestrator — mode switching, throttled recalc
const edgeVirtualization = useEdgeVirtualizationOrchestrator({
  nodes,
  edges,
  getViewport,
  getContainerRect: () => viewport.getContainerRect(),
  setEdgeVisibility: (map) => graphStore.setEdgeVisibility(map),
  initialMode: EDGE_VIRTUALIZATION_MODE,
  throttleMs: EDGE_VIEWPORT_RECALC_THROTTLE_MS,
  perfMarksEnabled: PERF_MARKS_ENABLED,
});

const { edgeVirtualizationEnabled, edgeVirtualizationRuntimeMode, edgeVirtualizationWorkerStats } = edgeVirtualization;

// 3. Search highlighting — search result visualization
const searchHighlighting = useSearchHighlighting({
  nodes,
  edges,
  graphTheme,
  updateNodesById: (updates) => graphStore['updateNodesById'](updates),
  setEdges: (e) => graphStore['setEdges'](e),
  activeRelationshipTypes: computed(() => graphSettings.activeRelationshipTypes),
  perfMarksEnabled: PERF_MARKS_ENABLED,
});

const { handleSearchResult, searchHighlightState } = searchHighlighting;

// 4. Node hover z-index — DOM-level z-index elevation on hover
const nodeHoverZIndex = useNodeHoverZIndex({ graphRootRef, nodes });
const { elevateNodeAndChildren, restoreHoverZIndex } = nodeHoverZIndex;

// 5. Graph layout — layout pipeline, caching, two-pass measurement
const graphLayout = useGraphLayout({
  propsData: computed(() => props.data),
  graphStore: {
    get nodes() {
      return graphStore['nodes'];
    },
    setNodes: (n) => graphStore['setNodes'](n),
    setEdges: (e) => graphStore['setEdges'](e),
    setOverviewSnapshot: (s) => graphStore.setOverviewSnapshot(s),
    setSemanticSnapshot: (s) => graphStore.setSemanticSnapshot(s),
    setViewMode: (m) => graphStore.setViewMode(m),
    suspendCacheWrites: () => graphStore.suspendCacheWrites(),
    resumeCacheWrites: () => graphStore.resumeCacheWrites(),
    get manualOffsets() {
      return graphStore.manualOffsets;
    },
    applyManualOffsets: (n) => graphStore.applyManualOffsets(n),
  },
  graphSettings: {
    get enabledNodeTypes() {
      return graphSettings.enabledNodeTypes;
    },
    get activeRelationshipTypes() {
      return graphSettings.activeRelationshipTypes;
    },
    get clusterByFolder() {
      return graphSettings.clusterByFolder;
    },
    get collapseScc() {
      return graphSettings.collapseScc;
    },
    get collapsedFolderIds() {
      return graphSettings.collapsedFolderIds;
    },
    get hideTestFiles() {
      return graphSettings.hideTestFiles;
    },
    get memberNodeMode() {
      return graphSettings.memberNodeMode;
    },
    get highlightOrphanGlobal() {
      return graphSettings.highlightOrphanGlobal;
    },
    get degreeWeightedLayers() {
      return graphSettings.degreeWeightedLayers;
    },
  },
  interaction: { resetInteraction: () => interaction.resetInteraction() },
  fitView,
  updateNodeInternals,
  suspendEdgeVirtualization: () => edgeVirtualization.suspend(),
  resumeEdgeVirtualization: () => edgeVirtualization.resume(),
  syncViewportState,
  nodeDimensionTracker,
  resetSearchHighlightState: () => searchHighlighting.resetSearchHighlightState(),
});

const { isLayoutPending, isLayoutMeasuring, layoutConfig } = graphLayout;

// 6. Collision resolution — drag-aware collision detection & resolution
//    Circular dep: needs reconcileSelectedNodeAfterStructuralChange from
//    selectionHighlighting (created next). Resolved via indirect callback.
let reconcileSelectedNodeFn: (updatedNodes: DependencyNode[]) => void = () => {};

const collisionResolution = useCollisionResolution({
  nodes,
  isLayoutPending: graphLayout.isLayoutPending,
  isLayoutMeasuring: graphLayout.isLayoutMeasuring,
  clusterByFolder: computed(() => graphSettings.clusterByFolder),
  getVueFlowNodes: () => (vfGetNodes.value ?? []) as unknown as DependencyNode[],
  setNodes: (n) => graphStore['setNodes'](n),
  updateNodesById: (updates) => graphStore['updateNodesById'](updates),
  mergeManualOffsets: (offsets) => graphStore.mergeManualOffsets(offsets),
  reconcileSelectedNodeAfterStructuralChange: (updatedNodes) => reconcileSelectedNodeFn(updatedNodes),
});

const { handleNodesChange } = collisionResolution;

// 7. Selection highlighting — CSS classes for selection, hover, dimming
const selectionHighlighting = useSelectionHighlighting({
  nodes,
  edges,
  selectedNode,
  scopeMode: interaction.scopeMode,
  searchHighlightState,
  activeDraggedNodeIds: collisionResolution.activeDraggedNodeIds,
  useCssSelectionHover: USE_CSS_SELECTION_HOVER,
  perfMarksEnabled: PERF_MARKS_ENABLED,
  graphStore: {
    setSelectedNode: (node) => graphStore['setSelectedNode'](node),
    updateNodesById: (updates) => graphStore['updateNodesById'](updates),
    updateEdgesById: (updates) => graphStore['updateEdgesById'](updates),
  },
  interaction: {
    setSelectionNodeId: (id) => interaction.setSelectionNodeId(id),
    setCameraMode: (mode) => interaction.setCameraMode(mode),
  },
  removeSelectedElements,
  restoreHoverZIndex,
});

// Wire the deferred callback now that selectionHighlighting is created
reconcileSelectedNodeFn = selectionHighlighting.reconcileSelectedNodeAfterStructuralChange;

const {
  visualNodes,
  visualEdges,
  highlightedEdgeIds,
  highlightedEdgeIdList,
  hoveredNodeId,
  setSelectedNode,
  clearHoverState,
  applyHoverEdgeHighlight,
} = selectionHighlighting;

// 8. Isolation mode — neighborhood isolation & symbol drilldown
const isolationMode = useIsolationMode({
  propsData: computed(() => props.data),
  nodes,
  edges,
  graphStore: {
    setNodes: (n) => graphStore['setNodes'](n),
    setEdges: (e) => graphStore['setEdges'](e),
    setViewMode: (m) => graphStore.setViewMode(m),
    get overviewSnapshot() {
      return graphStore.overviewSnapshot;
    },
    get semanticSnapshot() {
      return graphStore.semanticSnapshot;
    },
    restoreOverviewSnapshot: () => graphStore.restoreOverviewSnapshot(),
  },
  graphSettings: {
    get clusterByFolder() {
      return graphSettings.clusterByFolder;
    },
    get activeRelationshipTypes() {
      return graphSettings.activeRelationshipTypes;
    },
  },
  interaction: {
    setScopeMode: (mode) => interaction.setScopeMode(mode),
    scopeMode: interaction.scopeMode,
  },
  layoutConfig,
  isLayoutMeasuring,
  fitView,
  updateNodeInternals,
  syncViewportState,
  requestEdgeVirtualizationViewportRecalc: (force) => edgeVirtualization.requestViewportRecalc(force),
  setSelectedNode,
  processGraphLayout: graphLayout.processGraphLayout,
  measureAllNodeDimensions: graphLayout.measureAllNodeDimensions,
  shouldRunTwoPassMeasure: graphLayout.shouldRunTwoPassMeasure,
  requestGraphInitialization: graphLayout.requestGraphInitialization,
});

const { isIsolateAnimating, isolateExpandAll, isolateNeighborhood, handleOpenSymbolUsageGraph, handleReturnToOverview } =
  isolationMode;

// ── Template-facing computeds ──

const isCanvasModeRequested = computed(
  () => EDGE_RENDERER_MODE === 'hybrid-canvas' || EDGE_RENDERER_MODE === 'hybrid-canvas-experimental'
);

const isHybridCanvasMode = computed(
  () =>
    canvasRendererAvailable.value &&
    isCanvasModeRequested.value &&
    edges.value.length >= EDGE_RENDERER_FALLBACK_EDGE_THRESHOLD
);

const renderedEdges = computed(() => {
  if (!isHybridCanvasMode.value) return visualEdges.value;
  if (highlightedEdgeIds.value.size === 0) return [];
  return visualEdges.value.filter((edge) => highlightedEdgeIds.value.has(edge.id));
});

const useOnlyRenderVisibleElements = computed(() => {
  if (isLayoutMeasuring.value) return false;
  if (isHybridCanvasMode.value) return false;
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
    return { zIndex: 2, type: 'straight' };
  }
  return {
    markerEnd: { type: MarkerType.ArrowClosed, width: EDGE_MARKER_WIDTH_PX, height: EDGE_MARKER_HEIGHT_PX },
    zIndex: 2,
    type: 'smoothstep',
  };
});

// ── Graph stat computeds ──

interface TypeCountEntry {
  type: string;
  count: number;
}

const toSortedTypeCounts = (counts: Map<string, number>): TypeCountEntry[] =>
  [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.type.localeCompare(b.type)));

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
    if (edge.hidden) return;
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

// ── Minimap helpers ──

const minimapNodeColor = (node: { type?: string }): string => {
  if (node.type === 'package') return 'rgba(20, 184, 166, 0.8)';
  if (node.type === 'module') return 'rgba(59, 130, 246, 0.75)';
  if (node.type === 'class' || node.type === 'interface') return 'rgba(217, 119, 6, 0.7)';
  return 'rgba(148, 163, 184, 0.6)';
};

const minimapNodeStrokeColor = (node: { id?: string }): string =>
  node.id === selectedNode.value?.id ? '#22d3ee' : 'rgba(226, 232, 240, 0.8)';

const handleMinimapNodeClick = (params: { node: { id: string } }): void => {
  void handleFocusNode(params.node.id);
};

// ── Canvas renderer fallback ──

const handleCanvasUnavailable = (): void => {
  if (!canvasRendererAvailable.value) return;
  canvasRendererAvailable.value = false;
};

// ── VueFlow move event handlers ──

const onMoveEnd = (): void => {
  viewport.onMoveEnd();
  edgeVirtualization.requestViewportRecalc(true);
};

// ── Node click / pane click ──

const onNodeClick = ({ node }: { node: unknown }): void => {
  const clickedNode = node as DependencyNode;
  setSelectedNode(selectedNode.value?.id === clickedNode.id ? null : clickedNode);
};

const onPaneClick = (): void => {
  setSelectedNode(null);
  contextMenu.value = null;
};

// ── Focus & keyboard navigation ──

const handleFocusNode = async (nodeId: string): Promise<void> => {
  const targetNode = nodes.value.find((node) => node.id === nodeId);
  if (!targetNode) return;

  setSelectedNode(targetNode);
  interaction.setCameraMode('fitSelection');

  await fitView({ nodes: [nodeId], duration: 180, padding: 0.4 });

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
  edgeVirtualization.requestViewportRecalc(true);
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
          void fitView({ nodes: [nextNode.id], duration: 150, padding: 0.5 }).then(() => {
            syncViewportState();
            edgeVirtualization.requestViewportRecalc(true);
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

// ── Mouse enter/leave (coordinates hover z-index + selection highlighting) ──

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
  if (left.type === 'package' || left.type === 'group') return;
  if (hoveredNodeId.value === left.id) {
    clearHoverState();
  }
};

// ── Settings change handlers ──

const handleLayoutChange = async (config: {
  algorithm?: string;
  direction?: string;
  nodeSpacing?: number;
  rankSpacing?: number;
}) => {
  graphLayout.setLayoutConfig(config as Partial<LayoutConfig>);
  await graphLayout.requestGraphInitialization();
};

const handleResetLayout = async (): Promise<void> => {
  graphLayout.resetLayoutConfig();
  await graphLayout.requestGraphInitialization();
};

const handleResetView = (): void => {
  interaction.setCameraMode('free');
  setSelectedNode(null);
};

const handleRelationshipFilterChange = async (types: string[]) => {
  graphSettings.setEnabledRelationshipTypes(types);
  await graphLayout.requestGraphInitialization();
};

const handleNodeTypeFilterChange = async (types: string[]) => {
  graphSettings.setEnabledNodeTypes(types);
  setSelectedNode(null);
  await graphLayout.requestGraphInitialization();
};

const handleCollapseSccToggle = async (value: boolean) => {
  if (graphSettings.clusterByFolder && value) {
    graphSettings.setCollapseScc(false);
    return;
  }
  graphSettings.setCollapseScc(value);
  await graphLayout.requestGraphInitialization();
};

const handleClusterByFolderToggle = async (value: boolean) => {
  if (value && graphSettings.collapseScc) {
    graphSettings.setCollapseScc(false);
  }
  graphSettings.setClusterByFolder(value);
  await graphLayout.requestGraphInitialization();
};

const handleHideTestFilesToggle = async (value: boolean) => {
  graphSettings.setHideTestFiles(value);
  await graphLayout.requestGraphInitialization();
};

const handleMemberNodeModeChange = async (value: 'compact' | 'graph') => {
  graphSettings.setMemberNodeMode(value);
  await graphLayout.requestGraphInitialization();
};

const handleOrphanGlobalToggle = async (value: boolean) => {
  graphSettings.setHighlightOrphanGlobal(value);
  await graphLayout.requestGraphInitialization();
};

const handleDegreeWeightedLayersToggle = async (value: boolean) => {
  graphSettings.setDegreeWeightedLayers(value);
  await graphLayout.requestGraphInitialization();
};

const handleShowFpsToggle = (value: boolean): void => {
  graphSettings.setShowFps(value);
};

const handleFpsAdvancedToggle = (value: boolean): void => {
  graphSettings.setShowFpsAdvanced(value);
};

// ── provide() — inject context for child nodes ──

const nodeActions = {
  focusNode: (nodeId: string) => void handleFocusNode(nodeId),
  isolateNeighborhood: (nodeId: string) => void isolateNeighborhood(nodeId),
  showContextMenu: (nodeId: string, label: string, event: MouseEvent) => {
    contextMenu.value = { nodeId, nodeLabel: label, x: event.clientX, y: event.clientY };
  },
};

const highlightOrphanGlobal = computed(() => graphSettings.highlightOrphanGlobal);

provide(NODE_ACTIONS_KEY, nodeActions);
provide(ISOLATE_EXPAND_ALL_KEY, isolateExpandAll);
provide(HIGHLIGHT_ORPHAN_GLOBAL_KEY, highlightOrphanGlobal);
provide(FOLDER_COLLAPSE_ACTIONS_KEY, {
  toggleFolderCollapsed: (folderId: string) => {
    graphSettings.toggleFolderCollapsed(folderId);

    const overviewGraph = buildOverviewGraph({
      data: props.data,
      enabledNodeTypes: new Set(graphSettings.enabledNodeTypes),
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

    void graphLayout.processGraphLayout(overviewGraph, {
      fitViewToResult: false,
      twoPassMeasure: false,
    });
  },
});

// ── Watchers ──

watch(
  () => props.data,
  () => {
    void graphLayout.requestGraphInitialization();
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

// ── Lifecycle ──

onMounted(() => {
  graphRootRef.value?.addEventListener('wheel', handleWheel, { passive: false });
  document.addEventListener('keydown', handleKeyDown);
  if (graphRootRef.value) {
    nodeDimensionTracker.start(graphRootRef.value);
    initContainerCache(graphRootRef.value);
  }
  syncViewportState();
  void issuesStore.fetchIssues();
  void insightsStore.fetchInsights();
});

onUnmounted(() => {
  stopFps();
  graphRootRef.value?.removeEventListener('wheel', handleWheel);
  document.removeEventListener('keydown', handleKeyDown);
  nodeDimensionTracker.stop();

  // Dispose all composables
  viewport.dispose();
  edgeVirtualization.dispose();
  selectionHighlighting.dispose();
  collisionResolution.dispose();
  graphLayout.dispose();
  isolationMode.dispose();

  clearHoverState();
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
