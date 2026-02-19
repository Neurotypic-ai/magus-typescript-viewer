<script setup lang="ts">
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { Panel, VueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { onMounted, onUnmounted, provide, ref, watch } from 'vue';

import { parseEnvBoolean, parseEnvFloat, parseEnvInt } from '../utils/env';
import {
  FOLDER_COLLAPSE_ACTIONS_KEY,
  HIGHLIGHT_ORPHAN_GLOBAL_KEY,
  ISOLATE_EXPAND_ALL_KEY,
  NODE_ACTIONS_KEY,
} from './nodes/utils';
import IntraFolderEdge from './edges/IntraFolderEdge.vue';
import GroupNode from './nodes/GroupNode.vue';
import ModuleNode from './nodes/ModuleNode.vue';
import PackageNode from './nodes/PackageNode.vue';
import SymbolNode from './nodes/SymbolNode.vue';
import { useDependencyGraphCore, DEFAULT_VIEWPORT } from '../composables/useDependencyGraphCore';
import CanvasEdgeLayer from './CanvasEdgeLayer.vue';
import DebugBoundsOverlay from './DebugBoundsOverlay.vue';
import { useGraphSearch } from '../composables/useGraphSearch';
import GraphControls from './GraphControls.vue';
import InsightsDashboard from './InsightsDashboard.vue';
import IssuesPanel from './IssuesPanel.vue';
import NodeContextMenu from './NodeContextMenu.vue';
import NodeDetails from './NodeDetails.vue';

import type { Component } from 'vue';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';

import '@vue-flow/controls/dist/style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

export interface DependencyGraphProps {
  data: DependencyPackageGraph;
}

const props = defineProps<DependencyGraphProps>();
const graphRootRef = ref<HTMLElement | null>(null);

const env = {
  EDGE_VISIBLE_RENDER_THRESHOLD: parseEnvInt('VITE_EDGE_VISIBLE_RENDER_THRESHOLD', 1400),
  MINIMAP_AUTO_HIDE_EDGE_THRESHOLD: 2800,
  HEAVY_EDGE_STYLE_THRESHOLD: 2200,
  HIGH_EDGE_MARKER_THRESHOLD: 1800,
  LOW_DETAIL_EDGE_ZOOM_THRESHOLD: 0.35,
  EDGE_RENDERER_FALLBACK_EDGE_THRESHOLD: parseEnvInt('VITE_CANVAS_EDGE_THRESHOLD', 0),
  NODE_VISIBLE_RENDER_THRESHOLD: parseEnvInt('VITE_NODE_VISIBLE_RENDER_THRESHOLD', 320),
  EDGE_RENDERER_MODE: (import.meta.env['VITE_EDGE_RENDER_MODE'] as string | undefined) ?? 'hybrid-canvas',
  EDGE_VIRTUALIZATION_MODE:
    ((import.meta.env['VITE_EDGE_VIRTUALIZATION_MODE'] as string | undefined) === 'main' ? 'main' : 'worker') as
      | 'main'
      | 'worker',
  USE_CSS_SELECTION_HOVER: parseEnvBoolean('VITE_USE_CSS_SELECTION_HOVER', true),
  PERF_MARKS_ENABLED: parseEnvBoolean('VITE_PERF_MARKS', false),
  EDGE_VIEWPORT_RECALC_THROTTLE_MS: parseEnvInt('VITE_EDGE_VIEWPORT_RECALC_THROTTLE_MS', 80),
  MAC_TRACKPAD_PAN_SPEED: parseEnvFloat('VITE_MAC_TRACKPAD_PAN_SPEED', 1.6),
};

const core = useDependencyGraphCore({
  propsData: props,
  graphRootRef,
  env,
});

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
  activeCollisionConfig,
  lastCollisionResult,
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
  edgeVirtualizationRuntimeMode,
  edgeVirtualizationWorkerStats,
  isLayoutPending,
  isLayoutMeasuring,
  selectedNode,
  hoveredNodeId,
  contextMenu,
  canvasRendererAvailable,
  isHybridCanvasMode,
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
  nodeActions,
  highlightOrphanGlobal,
  folderCollapseActions,
  minimapNodeColor,
  minimapNodeStrokeColor,
  nodeDimensionTracker,
  renderedNodeCount,
  renderedEdgeCount,
  renderedNodeTypeCounts,
  renderedEdgeTypeCounts,
  scopeMode,
  highlightedEdgeIdList,
  startFps,
  stopFps,
  dispose,
} = core;

const USE_CSS_SELECTION_HOVER = env.USE_CSS_SELECTION_HOVER;

const nodeTypes: Record<string, Component> = Object.freeze({
  package: PackageNode,
  module: ModuleNode,
  class: SymbolNode,
  interface: SymbolNode,
  enum: SymbolNode,
  type: SymbolNode,
  function: SymbolNode,
  group: GroupNode,
  property: SymbolNode,
  method: SymbolNode,
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used in template as :edge-types
const edgeTypes: Record<string, Component> = Object.freeze({
  intraFolder: IntraFolderEdge,
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

onMounted(() => {
  graphRootRef.value?.addEventListener('wheel', handleWheel, { passive: false });
  document.addEventListener('keydown', handleKeyDown);
  if (graphRootRef.value) {
    nodeDimensionTracker.start(graphRootRef.value);
    initContainerCache(graphRootRef.value);
  }
  syncViewportState();
  void issuesStore.fetchIssues();
  void core.insightsStore.fetchInsights();
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
        :canvas-renderer-available="canvasRendererAvailable"
        :graph-search-context="graphSearchContext"
        @relationship-filter-change="handleRelationshipFilterChange"
        @node-type-filter-change="handleNodeTypeFilterChange"
        @toggle-collapse-scc="handleCollapseSccToggle"
        @toggle-cluster-folder="handleClusterByFolderToggle"
        @toggle-hide-test-files="handleHideTestFilesToggle"
        @member-node-mode-change="handleMemberNodeModeChange"
        @toggle-orphan-global="handleOrphanGlobalToggle"
        @toggle-show-fps="handleShowFpsToggle"
        @toggle-fps-advanced="handleFpsAdvancedToggle"
        @rendering-strategy-change="handleRenderingStrategyChange"
        @rendering-strategy-option-change="handleRenderingStrategyOptionChange"
      />
      <MiniMap
        v-if="showMiniMap && !isLayoutPending && !isLayoutMeasuring"
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
    <DebugBoundsOverlay
      v-if="(graphSettings.showDebugBounds || graphSettings.showDebugHandles || graphSettings.showDebugNodeIds) && !isLayoutPending && !isLayoutMeasuring"
      :nodes="nodes"
      :edges="renderedEdges"
      :viewport="viewportState"
      :show-bounds="graphSettings.showDebugBounds"
      :show-handles="graphSettings.showDebugHandles"
      :show-node-ids="graphSettings.showDebugNodeIds"
      :collision-config="activeCollisionConfig"
      :last-collision-result="lastCollisionResult"
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
