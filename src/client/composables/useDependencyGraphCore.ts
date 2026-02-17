/**
 * useDependencyGraphCore — single composable that wires viewport, edge virtualization,
 * search, layout, collision, selection, and isolation mode for the dependency graph.
 * DependencyGraph.vue calls this and uses the returned API.
 */

import { useVueFlow } from '@vue-flow/core';
import { computed, ref } from 'vue';

import {
  FOLDER_COLLAPSE_ACTIONS_KEY,
  HIGHLIGHT_ORPHAN_GLOBAL_KEY,
  ISOLATE_EXPAND_ALL_KEY,
  NODE_ACTIONS_KEY,
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
import { useFpsChart } from './useFpsChart';
import { useGraphInteractionController } from './useGraphInteractionController';
import { useGraphLayout } from './useGraphLayout';
import { useGraphNavigationHandlers } from './useGraphNavigationHandlers';
import { useGraphRenderedStats } from './useGraphRenderedStats';
import { useGraphRenderingState } from './useGraphRenderingState';
import { useGraphSelectionHandlers } from './useGraphSelectionHandlers';
import { useGraphSettingsHandlers } from './useGraphSettingsHandlers';
import { useMinimapHelpers } from './useMinimapHelpers';
import { useGraphViewport, DEFAULT_VIEWPORT } from './useGraphViewport';
import { useIsolationMode } from './useIsolationMode';
import { createNodeDimensionTracker } from './useNodeDimensions';
import { createGraphLayoutOptions } from './createGraphLayoutOptions';
import { createGraphNodeActions } from './createGraphNodeActions';
import { useNodeHoverZIndex } from './useNodeHoverZIndex';
import { useSearchHighlighting } from './useSearchHighlighting';
import { useSelectionHighlighting } from './useSelectionHighlighting';
import { getActiveCollisionConfig } from '../layout/collisionResolver';
import { getRenderingStrategy } from '../rendering/strategyRegistry';
import type { RenderingStrategyId } from '../rendering/RenderingStrategy';
import type {
  DependencyGraphCoreReturn,
  UseDependencyGraphCoreOptions,
} from './dependencyGraphCoreTypes';

import type { DependencyNode } from '../types/DependencyNode';

export { DEFAULT_VIEWPORT };
export type {
  DependencyGraphCoreEnv,
  DependencyGraphCoreReturn,
  GraphStatCountEntry,
  UseDependencyGraphCoreOptions,
} from './dependencyGraphCoreTypes';

export function useDependencyGraphCore(options: UseDependencyGraphCoreOptions): DependencyGraphCoreReturn {
  const { propsData, graphRootRef, env } = options;
  const props = { data: computed(() => propsData.data) };

  const graphStore = useGraphStore();
  const graphSettings = useGraphSettings();
  const envDefaultRendererMode: RenderingStrategyId = env.EDGE_RENDERER_MODE === 'vue-flow' ? 'vueflow' : 'canvas';
  graphSettings.initializeRenderingStrategyId(envDefaultRendererMode);
  const startupStrategy = getRenderingStrategy(graphSettings.renderingStrategyId);
  if (startupStrategy.runtime.forcesClusterByFolder && !graphSettings.clusterByFolder) {
    graphSettings.setClusterByFolder(true);
  }
  if (startupStrategy.runtime.forcesClusterByFolder && graphSettings.collapseScc) {
    graphSettings.setCollapseScc(false);
  }
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
  const { fpsChartScaleMax, fpsChartPoints, fpsTargetLineY, FPS_CHART_WIDTH, FPS_CHART_HEIGHT } = useFpsChart({
    fpsHistory,
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

  // Tag <html> so CSS can apply Firefox-specific overrides (e.g. text-rendering).
  if (isFirefox.value) {
    document.documentElement.setAttribute('data-firefox', '');
  }

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

  const graphLayout = useGraphLayout(
    createGraphLayoutOptions({
      propsData: computed(() => props.data.value),
      graphStore,
      graphSettings,
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
      isFirefox,
      graphRootRef,
    })
  );

  const { isLayoutPending, isLayoutMeasuring, layoutConfig } = graphLayout;
  const activeCollisionConfig = computed(() =>
    getActiveCollisionConfig(graphSettings.renderingStrategyId, graphSettings.strategyOptionsById)
  );

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
    collisionConfigInputs: {
      renderingStrategyId: computed(() => graphSettings.renderingStrategyId),
      strategyOptionsById: computed(() => graphSettings.strategyOptionsById),
    },
  });

  const { handleNodesChange, lastCollisionResult } = collisionResolution;

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

  const {
    isCanvasModeRequested,
    isHybridCanvasMode,
    renderedEdges,
    useOnlyRenderVisibleElements,
    isHeavyEdgeMode,
    minimapAutoHidden,
    showMiniMap,
    defaultEdgeOptions,
  } = useGraphRenderingState({
    env,
    nodes,
    edges,
    viewportState,
    isLayoutMeasuring,
    visualEdges,
    highlightedEdgeIds,
    edgeVirtualizationEnabled,
    isFirefox,
    canvasRendererAvailable,
    renderingStrategyId: computed(() => graphSettings.renderingStrategyId),
  });

  const { renderedNodeCount, renderedEdgeCount, renderedNodeTypeCounts, renderedEdgeTypeCounts } = useGraphRenderedStats({
    visualNodes,
    visualEdges,
  });

  const { minimapNodeColor, minimapNodeStrokeColor } = useMinimapHelpers({ selectedNode });

  const { handleFocusNode, handleMinimapNodeClick, handleCanvasUnavailable, onMoveEnd } = useGraphNavigationHandlers({
    nodes,
    setSelectedNode,
    fitView,
    interaction: {
      setCameraMode: (mode) => {
        interaction.setCameraMode(mode);
      },
    },
    graphStore: {
      get semanticSnapshot() {
        return graphStore.semanticSnapshot;
      },
    },
    graphSettings: {
      get renderingStrategyId() {
        return graphSettings.renderingStrategyId;
      },
      setRenderingStrategyId: (id) => {
        graphSettings.setRenderingStrategyId(id);
      },
    },
    graphLayout: {
      requestGraphInitialization: () => graphLayout.requestGraphInitialization(),
    },
    canvasRendererAvailable,
    viewport: {
      onMoveEnd: () => {
        viewport.onMoveEnd();
      },
    },
    edgeVirtualization: {
      requestViewportRecalc: (force) => {
        edgeVirtualization.requestViewportRecalc(force);
      },
    },
    syncViewportState,
  });

  const { onNodeClick, onPaneClick, handleKeyDown, onNodeMouseEnter, onNodeMouseLeave } = useGraphSelectionHandlers({
    state: {
      selectedNode,
      hoveredNodeId,
      contextMenu,
    },
    actions: {
      setSelectedNode,
      clearHoverState,
      applyHoverEdgeHighlight,
      restoreHoverZIndex,
      elevateNodeAndChildren,
    },
    graphSettings: {
      get showFps() {
        return graphSettings.showFps;
      },
      setShowFps: (value) => {
        graphSettings.setShowFps(value);
      },
    },
    interaction: {
      setCameraMode: (mode) => {
        interaction.setCameraMode(mode);
      },
    },
    nodes,
    edges,
    fitView,
    syncViewportState,
    requestViewportRecalc: (force) => {
      edgeVirtualization.requestViewportRecalc(force);
    },
  });

  const {
    handleRelationshipFilterChange,
    handleNodeTypeFilterChange,
    handleCollapseSccToggle,
    handleClusterByFolderToggle,
    handleHideTestFilesToggle,
    handleMemberNodeModeChange,
    handleOrphanGlobalToggle,
    handleShowFpsToggle,
    handleFpsAdvancedToggle,
    handleRenderingStrategyChange,
    handleRenderingStrategyOptionChange,
  } = useGraphSettingsHandlers({
    graphLayout,
    graphSettings,
    setSelectedNode,
    syncViewportState,
    requestViewportRecalc: (force) => {
      edgeVirtualization.requestViewportRecalc(force);
    },
  });

  const { nodeActions, folderCollapseActions } = createGraphNodeActions({
    handleFocusNode,
    isolateNeighborhood,
    contextMenu,
    toggleFolderCollapsed: (folderId) => {
      graphSettings.toggleFolderCollapsed(folderId);
    },
    requestGraphInitialization: (layoutOptions) => graphLayout.requestGraphInitialization(layoutOptions),
  });

  const highlightOrphanGlobal = computed(() => graphSettings.highlightOrphanGlobal);

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
    isFirefox,
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
    activeCollisionConfig,
    lastCollisionResult,
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
    handleRelationshipFilterChange,
    handleNodeTypeFilterChange,
    handleCollapseSccToggle,
    handleClusterByFolderToggle,
    handleHideTestFilesToggle,
    handleMemberNodeModeChange,
    handleOrphanGlobalToggle,
    handleShowFpsToggle,
    handleFpsAdvancedToggle,
    handleRenderingStrategyChange,
    handleRenderingStrategyOptionChange,

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
