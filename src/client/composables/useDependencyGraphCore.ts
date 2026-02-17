/**
 * useDependencyGraphCore — single composable that wires viewport, edge virtualization,
 * search, layout, collision, selection, and isolation mode for the dependency graph.
 * DependencyGraph.vue calls this and uses the returned API.
 */

import { MarkerType, useVueFlow } from '@vue-flow/core';
import { computed, ref } from 'vue';

import { buildParentMap } from '../graph/cluster/folderMembership';
import { traverseGraph } from '../graph/traversal';
import { buildOverviewGraph } from '../graph/buildGraphView';
import {
  FOLDER_COLLAPSE_ACTIONS_KEY,
  HIGHLIGHT_ORPHAN_GLOBAL_KEY,
  ISOLATE_EXPAND_ALL_KEY,
  NODE_ACTIONS_KEY,
  type FolderCollapseActions,
  type NodeActions,
} from '../components/nodes/utils';
import { storeToRefs } from 'pinia';
import { useGraphSettings } from '../stores/graphSettings';
import { useGraphStore } from '../stores/graphStore';
import { useInsightsStore } from '../stores/insightsStore';
import { useIssuesStore } from '../stores/issuesStore';
import { graphTheme } from '../theme/graphTheme';
import { useCollisionResolution } from './useCollisionResolution';
import { useEdgeVirtualizationOrchestrator } from './useEdgeVirtualizationOrchestrator';
import { useFpsCounter } from './useFpsCounter';
import { useGraphInteractionController } from './useGraphInteractionController';
import { useGraphLayout } from './useGraphLayout';
import { useGraphViewport, DEFAULT_VIEWPORT } from './useGraphViewport';
import { useIsolationMode } from './useIsolationMode';
import { createNodeDimensionTracker } from './useNodeDimensions';
import { useNodeHoverZIndex } from './useNodeHoverZIndex';
import { useSearchHighlighting } from './useSearchHighlighting';
import { useSelectionHighlighting } from './useSelectionHighlighting';
import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../layout/edgeGeometryPolicy';

import type { ComputedRef, Ref } from 'vue';
import type { DefaultEdgeOptions, NodeChange } from '@vue-flow/core';
import type { LayoutConfig } from '../layout/config';
import type { DependencyNode } from '../types/DependencyNode';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { GraphEdge } from '../types/GraphEdge';
import type { SearchResult } from '../types/SearchResult';

export { DEFAULT_VIEWPORT };
export type { LayoutConfig };

/** Type for graph/edge stat count entries (avoids exporting local interface). */
export interface GraphStatCountEntry {
  type: string;
  count: number;
}

export interface DependencyGraphCoreEnv {
  EDGE_VISIBLE_RENDER_THRESHOLD: number;
  MINIMAP_AUTO_HIDE_EDGE_THRESHOLD: number;
  HEAVY_EDGE_STYLE_THRESHOLD: number;
  HIGH_EDGE_MARKER_THRESHOLD: number;
  LOW_DETAIL_EDGE_ZOOM_THRESHOLD: number;
  EDGE_RENDERER_FALLBACK_EDGE_THRESHOLD: number;
  NODE_VISIBLE_RENDER_THRESHOLD: number;
  EDGE_RENDERER_MODE: string;
  EDGE_VIRTUALIZATION_MODE: 'main' | 'worker';
  USE_CSS_SELECTION_HOVER: boolean;
  PERF_MARKS_ENABLED: boolean;
  EDGE_VIEWPORT_RECALC_THROTTLE_MS: number;
  MAC_TRACKPAD_PAN_SPEED: number;
}

export interface UseDependencyGraphCoreOptions {
  /** Props from the component (data: DependencyPackageGraph). */
  propsData: { data: DependencyPackageGraph };
  graphRootRef: Ref<HTMLElement | null>;
  env: DependencyGraphCoreEnv;
}

export interface DependencyGraphCoreReturn {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  graphStore: unknown;
  graphSettings: ReturnType<typeof useGraphSettings>;
  issuesStore: ReturnType<typeof useIssuesStore>;
  insightsStore: ReturnType<typeof useInsightsStore>;
  interaction: unknown;
  viewportState: Ref<{ x: number; y: number; zoom: number }>;
  isPanning: Ref<boolean>;
  isMac: Ref<boolean>;
  handleWheel: (e: WheelEvent) => void;
  onMoveStart: () => void;
  onMove: (e: unknown) => void;
  syncViewportState: () => void;
  initContainerCache: (el: HTMLElement) => void;
  viewport: unknown;
  edgeVirtualization: unknown;
  edgeVirtualizationEnabled: Ref<boolean>;
  edgeVirtualizationRuntimeMode: Ref<string>;
  edgeVirtualizationWorkerStats: Ref<{ lastVisibleCount: number; lastHiddenCount: number; staleResponses: number }>;
  graphLayout: { requestGraphInitialization: () => void | Promise<void> };
  isLayoutPending: Ref<boolean>;
  isLayoutMeasuring: Ref<boolean>;
  layoutConfig: { direction: string };
  visualNodes: Ref<DependencyNode[]>;
  visualEdges: Ref<GraphEdge[]>;
  highlightedEdgeIds: Ref<Set<string>>;
  highlightedEdgeIdList: Ref<string[]>;
  renderedEdges: ComputedRef<GraphEdge[]>;
  useOnlyRenderVisibleElements: ComputedRef<boolean>;
  defaultEdgeOptions: ComputedRef<DefaultEdgeOptions>;
  selectedNode: Ref<DependencyNode | null>;
  hoveredNodeId: Ref<string | null>;
  setSelectedNode: (node: DependencyNode | null) => void;
  clearHoverState: () => void;
  contextMenu: Ref<{ nodeId: string; nodeLabel: string; x: number; y: number } | null>;
  canvasRendererAvailable: Ref<boolean>;
  isCanvasModeRequested: ComputedRef<boolean>;
  isHybridCanvasMode: ComputedRef<boolean>;
  isHeavyEdgeMode: ComputedRef<boolean>;
  minimapAutoHidden: ComputedRef<boolean>;
  showMiniMap: ComputedRef<boolean>;
  fps: Ref<number>;
  fpsHistory: Ref<number[]>;
  fpsStats: Ref<{ min: number; max: number; avg: number; p90: number; sampleCount: number }>;
  fpsChartScaleMax: ComputedRef<number>;
  fpsChartPoints: ComputedRef<string>;
  fpsTargetLineY: ComputedRef<string>;
  FPS_CHART_WIDTH: number;
  FPS_CHART_HEIGHT: number;
  startFps: () => void;
  stopFps: () => void;
  isIsolateAnimating: Ref<boolean>;
  isolateExpandAll: Ref<boolean>;
  isolateNeighborhood: (nodeId: string) => Promise<void>;
  handleOpenSymbolUsageGraph: (nodeId: string) => Promise<void>;
  handleReturnToOverview: () => Promise<void>;
  handleNodesChange: (changes: NodeChange[]) => void;
  handleSearchResult: (result: SearchResult) => void;
  handleFocusNode: (nodeId: string) => Promise<void>;
  handleMinimapNodeClick: (params: { node: { id: string } }) => void;
  handleCanvasUnavailable: () => void;
  onMoveEnd: () => void;
  onNodeClick: (params: { node: unknown }) => void;
  onPaneClick: () => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  onNodeMouseEnter: (params: { node: unknown }) => void;
  onNodeMouseLeave: (params: { node: unknown }) => void;
  handleLayoutChange: (config: { algorithm?: string; direction?: string; nodeSpacing?: number; rankSpacing?: number }) => Promise<void>;
  handleResetLayout: () => Promise<void>;
  handleResetView: () => void;
  handleRelationshipFilterChange: (types: string[]) => Promise<void>;
  handleNodeTypeFilterChange: (types: string[]) => Promise<void>;
  handleCollapseSccToggle: (value: boolean) => Promise<void>;
  handleClusterByFolderToggle: (value: boolean) => Promise<void>;
  handleHideTestFilesToggle: (value: boolean) => Promise<void>;
  handleMemberNodeModeChange: (value: 'compact' | 'graph') => Promise<void>;
  handleOrphanGlobalToggle: (value: boolean) => Promise<void>;
  handleDegreeWeightedLayersToggle: (value: boolean) => Promise<void>;
  handleShowFpsToggle: (value: boolean) => void;
  handleFpsAdvancedToggle: (value: boolean) => void;
  nodeActions: NodeActions;
  highlightOrphanGlobal: ComputedRef<boolean>;
  folderCollapseActions: FolderCollapseActions;
  NODE_ACTIONS_KEY: symbol;
  ISOLATE_EXPAND_ALL_KEY: symbol;
  HIGHLIGHT_ORPHAN_GLOBAL_KEY: symbol;
  FOLDER_COLLAPSE_ACTIONS_KEY: symbol;
  minimapNodeColor: (node: { type?: string }) => string;
  minimapNodeStrokeColor: (node: { id?: string }) => string;
  nodeDimensionTracker: { start: (root: HTMLElement) => void; stop: () => void };
  renderedNodeCount: ComputedRef<number>;
  renderedEdgeCount: ComputedRef<number>;
  renderedNodeTypeCounts: Ref<GraphStatCountEntry[]>;
  renderedEdgeTypeCounts: Ref<GraphStatCountEntry[]>;
  scopeMode: Ref<string>;
  dispose: () => void;
}

export function useDependencyGraphCore(options: UseDependencyGraphCoreOptions): DependencyGraphCoreReturn {
  const { propsData, graphRootRef, env } = options;
  const props = { data: computed(() => propsData.data) };

  const graphStore = useGraphStore();
  const graphSettings = useGraphSettings();
  const issuesStore = useIssuesStore();
  const insightsStore = useInsightsStore();
  const interaction = useGraphInteractionController();

  const { nodes, edges, selectedNode } = storeToRefs(graphStore);

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

  const contextMenu = ref<{ nodeId: string; nodeLabel: string; x: number; y: number } | null>(null);
  const canvasRendererAvailable = ref(true);
  const nodeDimensionTracker = createNodeDimensionTracker();

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
      const onlySample = samples[0];
      if (onlySample === undefined) return '';
      const normalized = Math.max(0, Math.min(onlySample / maxScale, 1));
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

  const viewport = useGraphViewport({
    getViewport,
    setViewport,
    zoomTo,
    panBy,
    trackpadPanSpeed: env.MAC_TRACKPAD_PAN_SPEED,
    onViewportChange: () => {
      edgeVirtualization.requestViewportRecalc();
    },
  });

  const {
    viewportState,
    isPanning,
    isMac,
    isFirefox,
    handleWheel,
    onMoveStart,
    onMove,
    syncViewportState,
    initContainerCache,
  } =
    viewport;

  const edgeVirtualization = useEdgeVirtualizationOrchestrator({
    nodes,
    edges,
    getViewport,
    getContainerRect: () => viewport.getContainerRect(),
    setEdgeVisibility: (map) => {
      graphStore.setEdgeVisibility(map);
    },
    initialMode: env.EDGE_VIRTUALIZATION_MODE,
    throttleMs: env.EDGE_VIEWPORT_RECALC_THROTTLE_MS,
    perfMarksEnabled: env.PERF_MARKS_ENABLED,
  });

  const { edgeVirtualizationEnabled, edgeVirtualizationRuntimeMode, edgeVirtualizationWorkerStats } = edgeVirtualization;

  const searchHighlighting = useSearchHighlighting({
    nodes,
    edges,
    graphTheme,
    updateNodesById: (updates) => {
      graphStore.updateNodesById(updates);
    },
    setEdges: (e) => {
      graphStore.setEdges(e);
    },
    activeRelationshipTypes: computed(() => graphSettings.activeRelationshipTypes),
    perfMarksEnabled: env.PERF_MARKS_ENABLED,
  });

  const { handleSearchResult, searchHighlightState } = searchHighlighting;

  const nodeHoverZIndex = useNodeHoverZIndex({ graphRootRef, nodes });
  const { elevateNodeAndChildren, restoreHoverZIndex } = nodeHoverZIndex;

  const graphLayout = useGraphLayout({
    propsData: computed(() => props.data.value),
    graphStore: {
      get nodes() {
        return graphStore.nodes;
      },
      setNodes: (n) => {
        graphStore.setNodes(n);
      },
      setEdges: (e) => {
        graphStore.setEdges(e);
      },
      setOverviewSnapshot: (s) => {
        graphStore.setOverviewSnapshot(s);
      },
      setSemanticSnapshot: (s) => {
        graphStore.setSemanticSnapshot(s);
      },
      setViewMode: (m) => {
        graphStore.setViewMode(m);
      },
      suspendCacheWrites: () => {
        graphStore.suspendCacheWrites();
      },
      resumeCacheWrites: () => {
        graphStore.resumeCacheWrites();
      },
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
    interaction: {
      resetInteraction: () => {
        interaction.resetInteraction();
      },
    },
    fitView,
    updateNodeInternals,
    suspendEdgeVirtualization: () => {
      edgeVirtualization.suspend();
    },
    resumeEdgeVirtualization: () => {
      edgeVirtualization.resume();
    },
    syncViewportState,
    nodeDimensionTracker,
    resetSearchHighlightState: () => {
      searchHighlighting.resetSearchHighlightState();
    },
  });

  const { isLayoutPending, isLayoutMeasuring, layoutConfig } = graphLayout;

  let reconcileSelectedNodeFn: (updatedNodes: DependencyNode[]) => void = (_updatedNodes) => undefined;

  const collisionResolution = useCollisionResolution({
    nodes,
    isLayoutPending: graphLayout.isLayoutPending,
    isLayoutMeasuring: graphLayout.isLayoutMeasuring,
    clusterByFolder: computed(() => graphSettings.clusterByFolder),
    getVueFlowNodes: () => vfGetNodes.value as unknown as DependencyNode[],
    setNodes: (n) => {
      graphStore.setNodes(n);
    },
    updateNodesById: (updates) => {
      graphStore.updateNodesById(updates);
    },
    mergeManualOffsets: (offsets) => {
      graphStore.mergeManualOffsets(offsets);
    },
    reconcileSelectedNodeAfterStructuralChange: (updatedNodes) => {
      reconcileSelectedNodeFn(updatedNodes);
    },
  });

  const { handleNodesChange } = collisionResolution;

  const selectionHighlighting = useSelectionHighlighting({
    nodes,
    edges,
    selectedNode,
    scopeMode: interaction.scopeMode,
    searchHighlightState,
    activeDraggedNodeIds: collisionResolution.activeDraggedNodeIds,
    useCssSelectionHover: env.USE_CSS_SELECTION_HOVER,
    perfMarksEnabled: env.PERF_MARKS_ENABLED,
    graphStore: {
      setSelectedNode: (node) => {
        graphStore.setSelectedNode(node);
      },
      updateNodesById: (updates) => {
        graphStore.updateNodesById(updates);
      },
      updateEdgesById: (updates) => {
        graphStore.updateEdgesById(updates);
      },
    },
    interaction: {
      setSelectionNodeId: (id) => {
        interaction.setSelectionNodeId(id);
      },
      setCameraMode: (mode) => {
        interaction.setCameraMode(mode);
      },
    },
    removeSelectedElements,
    restoreHoverZIndex,
  });

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

  const isolationMode = useIsolationMode({
    propsData: computed(() => props.data.value),
    nodes,
    edges,
    graphStore: {
      setNodes: (n) => {
        graphStore.setNodes(n);
      },
      setEdges: (e) => {
        graphStore.setEdges(e);
      },
      setViewMode: (m) => {
        graphStore.setViewMode(m);
      },
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
      setScopeMode: (mode) => {
        interaction.setScopeMode(mode);
      },
      scopeMode: interaction.scopeMode,
    },
    layoutConfig,
    isLayoutMeasuring,
    fitView,
    updateNodeInternals,
    syncViewportState,
    requestEdgeVirtualizationViewportRecalc: (force) => {
      edgeVirtualization.requestViewportRecalc(force);
    },
    setSelectedNode,
    processGraphLayout: graphLayout.processGraphLayout,
    measureAllNodeDimensions: graphLayout.measureAllNodeDimensions,
    shouldRunTwoPassMeasure: graphLayout.shouldRunTwoPassMeasure,
    requestGraphInitialization: graphLayout.requestGraphInitialization,
  });

  const { isIsolateAnimating, isolateExpandAll, isolateNeighborhood, handleOpenSymbolUsageGraph, handleReturnToOverview } =
    isolationMode;

  const isCanvasModeRequested = computed(
    () => env.EDGE_RENDERER_MODE === 'hybrid-canvas' || env.EDGE_RENDERER_MODE === 'hybrid-canvas-experimental'
  );

  const isHybridCanvasMode = computed(
    () =>
      canvasRendererAvailable.value &&
      isCanvasModeRequested.value
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
      (edgeVirtualizationEnabled.value && edges.value.length >= env.EDGE_VISIBLE_RENDER_THRESHOLD) ||
      nodes.value.length >= env.NODE_VISIBLE_RENDER_THRESHOLD
    );
  });

  const isHeavyEdgeMode = computed(() => edges.value.length >= env.HEAVY_EDGE_STYLE_THRESHOLD);
  const minimapAutoHidden = computed(() => edges.value.length >= env.MINIMAP_AUTO_HIDE_EDGE_THRESHOLD);
  const showMiniMap = computed(() => !isFirefox.value && !isHybridCanvasMode.value && !minimapAutoHidden.value);

  const defaultEdgeOptions = computed<DefaultEdgeOptions>(() => {
    const lowDetailEdges =
      edges.value.length >= env.HIGH_EDGE_MARKER_THRESHOLD ||
      viewportState.value.zoom < env.LOW_DETAIL_EDGE_ZOOM_THRESHOLD;

    if (lowDetailEdges) {
      return { zIndex: 2, type: 'straight' };
    }
    return {
      markerEnd: { type: MarkerType.ArrowClosed, width: EDGE_MARKER_WIDTH_PX, height: EDGE_MARKER_HEIGHT_PX },
      zIndex: 2,
      type: 'smoothstep',
    };
  });

  const toSortedTypeCounts = (counts: Map<string, number>): GraphStatCountEntry[] =>
    [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.type.localeCompare(b.type)));

  const renderedNodeCount = computed(() => visualNodes.value.length);
  const renderedEdgeCount = computed(() => visualEdges.value.filter((edge) => !edge.hidden).length);

  const renderedNodeTypeCounts = computed<GraphStatCountEntry[]>(() => {
    const counts = new Map<string, number>();
    visualNodes.value.forEach((node) => {
      const type = node.type ?? 'unknown';
      counts.set(type, (counts.get(type) ?? 0) + 1);
    });
    return toSortedTypeCounts(counts);
  });

  const renderedEdgeTypeCounts = computed<GraphStatCountEntry[]>(() => {
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

  const handleCanvasUnavailable = (): void => {
    if (!canvasRendererAvailable.value) return;
    canvasRendererAvailable.value = false;
  };

  const onMoveEnd = (): void => {
    viewport.onMoveEnd();
    edgeVirtualization.requestViewportRecalc(true);
  };

  const onNodeClick = ({ node }: { node: unknown }): void => {
    const clickedNode = node as DependencyNode;
    setSelectedNode(selectedNode.value?.id === clickedNode.id ? null : clickedNode);
  };

  const onPaneClick = (): void => {
    setSelectedNode(null);
    contextMenu.value = null;
  };

  const handleFocusNode = async (nodeId: string): Promise<void> => {
    const targetNode = nodes.value.find((node: DependencyNode) => node.id === nodeId);
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

    if (event.key === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const target = event.target;
      const tag = target instanceof HTMLElement ? target.tagName : '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        graphSettings.setShowFps(!graphSettings.showFps);
      }
    }
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
    if (left.type === 'package' || left.type === 'group') return;
    if (hoveredNodeId.value === left.id) {
      clearHoverState();
    }
  };

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

  const nodeActions = {
    focusNode: (nodeId: string) => void handleFocusNode(nodeId),
    isolateNeighborhood: (nodeId: string) => void isolateNeighborhood(nodeId),
    showContextMenu: (nodeId: string, label: string, event: MouseEvent) => {
      contextMenu.value = { nodeId, nodeLabel: label, x: event.clientX, y: event.clientY };
    },
  };

  const highlightOrphanGlobal = computed(() => graphSettings.highlightOrphanGlobal);

  const folderCollapseActions = {
    toggleFolderCollapsed: (folderId: string) => {
      graphSettings.toggleFolderCollapsed(folderId);

      const overviewGraph = buildOverviewGraph({
        data: props.data.value,
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
        twoPassMeasure: true,
      });
    },
  };

  function dispose() {
    viewport.dispose();
    edgeVirtualization.dispose();
    selectionHighlighting.dispose();
    collisionResolution.dispose();
    graphLayout.dispose();
    isolationMode.dispose();
    clearHoverState();
  }

  return {
    // Vue Flow / store
    nodes,
    edges,
    graphStore,
    graphSettings,
    issuesStore,
    insightsStore,
    interaction,

    // Viewport
    viewportState,
    isPanning,
    isMac,
    handleWheel,
    onMoveStart,
    onMove,
    syncViewportState,
    initContainerCache,
    viewport,

    // Edge virtualization
    edgeVirtualization,
    edgeVirtualizationEnabled,
    edgeVirtualizationRuntimeMode,
    edgeVirtualizationWorkerStats,

    // Layout
    graphLayout,
    isLayoutPending,
    isLayoutMeasuring,
    layoutConfig,

    // Visual state
    visualNodes,
    visualEdges,
    highlightedEdgeIds,
    highlightedEdgeIdList,
    renderedEdges,
    useOnlyRenderVisibleElements,
    defaultEdgeOptions,
    selectedNode,
    setSelectedNode,
    hoveredNodeId,
    clearHoverState,

    // Stats
    renderedNodeCount,
    renderedEdgeCount,
    renderedNodeTypeCounts,
    renderedEdgeTypeCounts,

    // UI state
    contextMenu,
    canvasRendererAvailable,
    isCanvasModeRequested,
    isHybridCanvasMode,
    isHeavyEdgeMode,
    minimapAutoHidden,
    showMiniMap,

    // FPS
    fps,
    fpsHistory,
    fpsStats,
    fpsChartScaleMax,
    fpsChartPoints,
    fpsTargetLineY,
    FPS_CHART_WIDTH,
    FPS_CHART_HEIGHT,
    startFps,
    stopFps,

    // Isolation
    isIsolateAnimating,
    isolateExpandAll,
    isolateNeighborhood,
    handleOpenSymbolUsageGraph,
    handleReturnToOverview,

    // Handlers
    handleNodesChange,
    handleSearchResult,
    handleFocusNode,
    handleMinimapNodeClick,
    handleCanvasUnavailable,
    onMoveEnd,
    onNodeClick,
    onPaneClick,
    handleKeyDown,
    onNodeMouseEnter,
    onNodeMouseLeave,
    handleLayoutChange,
    handleResetLayout,
    handleResetView,
    handleRelationshipFilterChange,
    handleNodeTypeFilterChange,
    handleCollapseSccToggle,
    handleClusterByFolderToggle,
    handleHideTestFilesToggle,
    handleMemberNodeModeChange,
    handleOrphanGlobalToggle,
    handleDegreeWeightedLayersToggle,
    handleShowFpsToggle,
    handleFpsAdvancedToggle,

    // Provide values
    nodeActions,
    highlightOrphanGlobal,
    folderCollapseActions,
    NODE_ACTIONS_KEY,
    ISOLATE_EXPAND_ALL_KEY,
    HIGHLIGHT_ORPHAN_GLOBAL_KEY,
    FOLDER_COLLAPSE_ACTIONS_KEY,

    // Helpers
    minimapNodeColor,
    minimapNodeStrokeColor,
    nodeDimensionTracker,
    scopeMode: interaction.scopeMode,

    // Lifecycle
    dispose,
  };
}
