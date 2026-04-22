<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from 'vue';

import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { Panel, VueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';

import { DEFAULT_VIEWPORT, useDependencyGraphCore } from '../composables/useDependencyGraphCore';
import { useGraphSearch } from '../composables/useGraphSearch';
import { useMetricsStore } from '../stores/metricsStore';
import { parseEnvBoolean, parseEnvFloat, parseEnvInt } from '../utils/env';
import DebugBoundsOverlay from './DebugBoundsOverlay.vue';
import FpsPanel from './FpsPanel.vue';
import GraphControls from './GraphControls.vue';
import GraphStatsPanel from './GraphStatsPanel.vue';
import InsightsPanel from './InsightsPanel.vue';
import MetricsDashboard from './MetricsDashboard.vue';
import RankDebugPanel from './RankDebugPanel.vue';
import IssuesPanel from './IssuesPanel.vue';
import NodeContextMenu from './NodeContextMenu.vue';
import NodeDetails from './NodeDetails.vue';
import CrossFolderEdge from './edges/CrossFolderEdge.vue';
import FanInStubEdge from './edges/FanInStubEdge.vue';
import FanInTrunkEdge from './edges/FanInTrunkEdge.vue';
import FolderStubEdge from './edges/FolderStubEdge.vue';
import IntraFolderEdge from './edges/IntraFolderEdge.vue';
import NodePremeasureHost from './nodes/measure/NodePremeasureHost.vue';
import ExternalPackageNode from './nodes/ExternalPackageNode.vue';
import GroupNode from './nodes/GroupNode.vue';
import ModuleNode from './nodes/ModuleNode.vue';
import PackageNode from './nodes/PackageNode.vue';
import SymbolNode from './nodes/SymbolNode.vue';
import {
  FOLDER_COLLAPSE_ACTIONS_KEY,
  HIGHLIGHT_ORPHAN_GLOBAL_KEY,
  ISOLATE_EXPAND_ALL_KEY,
  NODE_ACTIONS_KEY,
} from './nodes/utils';

import type { Component, Ref } from 'vue';

import type { PackageGraph } from '../../shared/types/Package';
import type { DependencyNode } from '../types/DependencyNode';

import '@vue-flow/controls/dist/style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

export interface DependencyGraphProps {
  data: PackageGraph;
}

const props = defineProps<DependencyGraphProps>();
const graphRootRef = ref<HTMLElement | null>(null);

const env = {
  EDGE_VISIBLE_RENDER_THRESHOLD: parseEnvInt('VITE_EDGE_VISIBLE_RENDER_THRESHOLD', 1400),
  MINIMAP_AUTO_HIDE_EDGE_THRESHOLD: 2800,
  HEAVY_EDGE_STYLE_THRESHOLD: 2200,
  HIGH_EDGE_MARKER_THRESHOLD: 1800,
  LOW_DETAIL_EDGE_ZOOM_THRESHOLD: 0.35,
  NODE_VISIBLE_RENDER_THRESHOLD: parseEnvInt('VITE_NODE_VISIBLE_RENDER_THRESHOLD', 320),
  USE_CSS_SELECTION_HOVER: parseEnvBoolean('VITE_USE_CSS_SELECTION_HOVER', true),
  PERF_MARKS_ENABLED: parseEnvBoolean('VITE_PERF_MARKS', false),
  MAC_TRACKPAD_PAN_SPEED: parseEnvFloat('VITE_MAC_TRACKPAD_PAN_SPEED', 1.6),
};

const core = useDependencyGraphCore({
  propsData: props,
  graphRootRef,
  env,
});

const metricsStore = useMetricsStore();

const graphSearchContext = useGraphSearch({
  nodes: core.nodes,
  edges: core.edges,
  onSearchResult: core.handleSearchResult,
  debounceMs: 300,
});

const {
  nodes,
  edges,
  graphSettings,
  issuesStore,
  visualNodes,
  renderedEdges,
  useOnlyRenderVisibleElements,
  defaultEdgeOptions,
  viewportState,
  isPanning,
  isMac,
  handleWheel,
  onMoveStart,
  onMove,
  syncViewportState,
  initContainerCache,
  isLayoutPending,
  isLayoutMeasuring,
  selectedNode,
  hoveredNodeId,
  contextMenu,
  isHeavyEdgeMode,
  minimapAutoHidden,
  showMiniMap,
  fps,
  fpsStats,
  fpsChartPoints,
  fpsTargetLineY,
  FPS_CHART_WIDTH,
  FPS_CHART_HEIGHT,
  isIsolateAnimating,
  isolateExpandAll,
  isolateNeighborhood,
  handleOpenSymbolUsageGraph,
  handleReturnToOverview,
  handleNodesChange,
  handleFocusNode,
  handleMinimapNodeClick,
  onMoveEnd,
  onNodeClick,
  onPaneClick,
  handleKeyDown,
  onNodeMouseEnter,
  onNodeMouseLeave,
  handleRelationshipFilterChange,
  handleHideTestFilesToggle,
  handleOrphanGlobalToggle,
  handleShowFpsToggle,
  handleFpsAdvancedToggle,
  nodeActions,
  highlightOrphanGlobal,
  folderCollapseActions,
  minimapNodeColor,
  minimapNodeStrokeColor,
  nodeDimensionTracker,
  nodePremeasure,
  renderedNodeCount,
  renderedEdgeCount,
  renderedNodeTypeCounts,
  renderedEdgeTypeCounts,
  scopeMode,
  startFps,
  stopFps,
  dispose,
} = core;

const USE_CSS_SELECTION_HOVER = env.USE_CSS_SELECTION_HOVER;
const premeasureNodes = nodePremeasure.batchNodes as Ref<DependencyNode[]>;

const nodeTypes: Record<string, Component> = Object.freeze({
  package: PackageNode,
  module: ModuleNode,
  externalPackage: ExternalPackageNode,
  class: SymbolNode,
  interface: SymbolNode,
  enum: SymbolNode,
  type: SymbolNode,
  function: SymbolNode,
  group: GroupNode,
  property: SymbolNode,
  method: SymbolNode,
});

const edgeTypes: Record<string, Component> = Object.freeze({
  crossFolder: CrossFolderEdge,
  folderStub: FolderStubEdge,
  intraFolder: IntraFolderEdge,
  fanInTrunk: FanInTrunkEdge,
  fanInStub: FanInStubEdge,
});

provide(NODE_ACTIONS_KEY, nodeActions);
provide(ISOLATE_EXPAND_ALL_KEY, isolateExpandAll);
provide(HIGHLIGHT_ORPHAN_GLOBAL_KEY, highlightOrphanGlobal);
provide(FOLDER_COLLAPSE_ACTIONS_KEY, folderCollapseActions);

watch(
  () => props.data,
  () => {
    void core.graphLayout.requestGraphInitialization();
  },
  { immediate: false }
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

onMounted(() => {
  graphRootRef.value?.addEventListener('wheel', handleWheel, { passive: false });
  document.addEventListener('keydown', handleKeyDown);
  if (graphRootRef.value) {
    nodeDimensionTracker.start(graphRootRef.value);
    initContainerCache(graphRootRef.value);
  }
  void core.graphLayout.requestGraphInitialization();
  syncViewportState();
  void issuesStore.fetchIssues();
  void core.insightsStore.fetchInsights();
  void metricsStore.fetchMetricsBundle();
});

onUnmounted(() => {
  stopFps();
  graphRootRef.value?.removeEventListener('wheel', handleWheel);
  document.removeEventListener('keydown', handleKeyDown);
  nodeDimensionTracker.stop();
  dispose();
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
        'graph-layout-active': isLayoutPending,
      },
    ]"
    role="application"
    aria-label="TypeScript dependency graph visualization"
    tabindex="0"
    :data-selection-hover-mode="USE_CSS_SELECTION_HOVER ? 'css' : 'store'"
    :data-selected-node-id="selectedNode?.id ?? ''"
    :data-hovered-node-id="hoveredNodeId ?? ''"
  >
    <NodePremeasureHost :nodes="premeasureNodes" />
    <VueFlow
      :nodes="visualNodes"
      :edges="renderedEdges"
      :node-types="nodeTypes as any"
      :edge-types="edgeTypes as any"
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
        :graph-search-context="graphSearchContext"
        @relationship-filter-change="handleRelationshipFilterChange"
        @toggle-hide-test-files="handleHideTestFilesToggle"
        @toggle-orphan-global="handleOrphanGlobalToggle"
        @toggle-show-fps="handleShowFpsToggle"
        @toggle-fps-advanced="handleFpsAdvancedToggle"
      />
      <Panel position="top-right" class="right-panels-stack">
        <div class="right-panels-column">
          <FpsPanel
            v-if="graphSettings.showFps"
            :fps="fps"
            :fps-stats="fpsStats"
            :fps-chart-points="fpsChartPoints"
            :fps-target-line-y="fpsTargetLineY"
            :fps-chart-width="FPS_CHART_WIDTH"
            :fps-chart-height="FPS_CHART_HEIGHT"
          />
          <GraphStatsPanel
            :rendered-node-count="renderedNodeCount"
            :rendered-edge-count="renderedEdgeCount"
            :rendered-node-type-counts="renderedNodeTypeCounts"
            :rendered-edge-type-counts="renderedEdgeTypeCounts"
          />
          <RankDebugPanel
            v-if="graphSettings.showDebugNodeIds"
            :selected-node="selectedNode"
          />
          <InsightsPanel />
          <button
            type="button"
            class="metrics-dashboard-toggle nodrag"
            :aria-pressed="metricsStore.dashboardOpen"
            aria-label="Toggle metrics dashboard"
            @click="metricsStore.toggleDashboard()"
          >
            <span>Metrics</span>
            <span class="metrics-dashboard-toggle-chevron">{{ metricsStore.dashboardOpen ? '▾' : '▸' }}</span>
          </button>
          <MetricsDashboard v-if="metricsStore.dashboardOpen" />
        </div>
      </Panel>
      <MiniMap
        v-if="showMiniMap && !isLayoutPending && !isLayoutMeasuring"
        position="bottom-right"
        :pannable="true"
        :zoomable="true"
        :node-color="minimapNodeColor"
        :node-stroke-color="minimapNodeStrokeColor"
        :node-stroke-width="2"
        :mask-color="'var(--graph-minimap-mask)'"
        :mask-stroke-color="'var(--graph-minimap-mask-stroke)'"
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

      <Panel v-if="scopeMode !== 'overview'" position="bottom-left">
        <button
          class="px-4 py-2 bg-primary-main text-white rounded-md hover:bg-primary-dark transition-colors shadow-lg border border-primary-light"
          aria-label="Return to full graph view"
          @click="handleReturnToOverview"
        >
          ← Back to Full Graph
        </button>
      </Panel>

    </VueFlow>
    <DebugBoundsOverlay
      v-if="graphSettings.showDebugNodeIds && !isLayoutPending && !isLayoutMeasuring"
      :nodes="nodes"
      :edges="renderedEdges"
      :viewport="viewportState"
      :show-node-ids="graphSettings.showDebugNodeIds"
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

/* ── Layout performance: suppress transitions during layout to avoid mass-
     transition compositor overhead when hundreds of nodes are inserted. ── */
.dependency-graph-root.graph-layout-active :deep(.vue-flow__node),
.dependency-graph-root.graph-layout-active :deep(.vue-flow__edge-path) {
  transition: none !important;
}

.dependency-graph-root.graph-panning :deep(.base-node-container) {
  box-shadow: none !important;
}

/* VueFlow container must stack above the canvas edge layer (sibling with z-index: 1). */
.dependency-graph-root :deep(.vue-flow) {
  position: relative;
  z-index: 2;
}

.dependency-graph-root :deep(.vue-flow__panel),
.dependency-graph-root :deep(.vue-flow__controls),
.dependency-graph-root :deep(.vue-flow__minimap) {
  z-index: 20 !important;
}

.dependency-graph-root :deep(.vue-flow__panel) {
  background-color: var(--color-background-paper) !important;
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
  border-color: var(--graph-selection-target-border) !important;
  outline: 2px solid var(--graph-selection-target-outline);
  outline-offset: 0;
  box-shadow: 0 2px 6px rgba(2, 6, 23, 0.22) !important;
}

/* Nodes connected to the selection */
.dependency-graph-root :deep(.vue-flow__node.selection-connected) {
  z-index: 10 !important;
}

.dependency-graph-root :deep(.vue-flow__node.selection-connected .base-node-container) {
  border-color: var(--graph-selection-connected-border) !important;
  outline: 1px solid var(--graph-selection-connected-outline);
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
  stroke-width: var(--graph-edge-width-highlighted) !important;
  stroke-opacity: 1 !important;
}

/* Dimmed non-connected edges */
.dependency-graph-root :deep(.vue-flow__edge.edge-selection-dimmed .vue-flow__edge-path) {
  opacity: 0.1 !important;
}

@keyframes edge-hover-pulse {
  0%,
  100% {
    stroke: var(--edge-hover-base-stroke, var(--graph-edge-default));
  }
  50% {
    stroke: var(--graph-selection-hover-pulse);
  }
}

/* Hovered node's connected edges are raised and thickened. */
.dependency-graph-root :deep(.vue-flow__edge.edge-hover-highlighted) {
  z-index: 12 !important;
}

.dependency-graph-root :deep(.vue-flow__edge.edge-hover-highlighted .vue-flow__edge-path) {
  stroke-width: var(--graph-edge-width-hover) !important;
  stroke: var(--edge-hover-base-stroke, var(--graph-edge-default));
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

.renderer-mode-panel {
  z-index: 21 !important;
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

/* ── Right-side panel stack ── */

.right-panels-stack {
  /* Override the blanket panel background set by .vue-flow__panel — the
     individual card shells supply their own backgrounds. */
  background-color: transparent !important;
}

.right-panels-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: calc(100vh - 1.5rem);
  overflow-y: auto;
  scrollbar-width: none;
}

.right-panels-column::-webkit-scrollbar {
  display: none;
}

.metrics-dashboard-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  width: min(22rem, calc(100vw - 1.5rem));
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background-color: var(--color-background-paper);
  color: var(--text-primary);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  transition:
    background-color 140ms ease-out,
    color 140ms ease-out;
}

.metrics-dashboard-toggle:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

.metrics-dashboard-toggle[aria-pressed='true'] {
  background-color: rgba(255, 255, 255, 0.08);
}

.metrics-dashboard-toggle-chevron {
  font-size: 0.7rem;
  color: var(--text-secondary);
}
</style>
