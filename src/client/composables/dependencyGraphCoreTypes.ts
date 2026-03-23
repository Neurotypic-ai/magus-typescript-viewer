import type { NodeChange } from '@vue-flow/core';
import type { ComputedRef, Ref } from 'vue';

import type { FolderCollapseActions, NodeActions } from '../components/nodes/utils';
import type { useGraphSettings } from '../stores/graphSettings';
import type { useInsightsStore } from '../stores/insightsStore';
import type { useIssuesStore } from '../stores/issuesStore';
import type { DependencyNode } from '../types/DependencyNode';
import type { PackageGraph } from '../../shared/types/Package';
import type { GraphEdge } from '../types/GraphEdge';
import type { SearchResult } from '../types/SearchResult';
import type { LayoutProcessOptions } from './useGraphLayout';

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
  NODE_VISIBLE_RENDER_THRESHOLD: number;
  USE_CSS_SELECTION_HOVER: boolean;
  PERF_MARKS_ENABLED: boolean;
  MAC_TRACKPAD_PAN_SPEED: number;
}

export interface UseDependencyGraphCoreOptions {
  /** Props from the component (data: PackageGraph). */
  propsData: { data: PackageGraph };
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
  isFirefox: Ref<boolean>;
  handleWheel: (e: WheelEvent) => void;
  onMoveStart: () => void;
  onMove: (e: unknown) => void;
  syncViewportState: () => void;
  initContainerCache: (el: HTMLElement) => void;
  viewport: unknown;
  graphLayout: { requestGraphInitialization: (options?: LayoutProcessOptions) => void | Promise<void> };
  isLayoutPending: Ref<boolean>;
  isLayoutMeasuring: Ref<boolean>;
  layoutConfig: { direction: string };
  visualNodes: Ref<DependencyNode[]>;
  visualEdges: Ref<GraphEdge[]>;
  highlightedEdgeIds: Ref<Set<string>>;
  highlightedEdgeIdList: Ref<string[]>;
  renderedEdges: ComputedRef<GraphEdge[]>;
  useOnlyRenderVisibleElements: ComputedRef<boolean>;
  defaultEdgeOptions: ComputedRef<Record<string, unknown>>;
  selectedNode: Ref<DependencyNode | null>;
  hoveredNodeId: Ref<string | null>;
  setSelectedNode: (node: DependencyNode | null) => void;
  clearHoverState: () => void;
  contextMenu: Ref<{ nodeId: string; nodeLabel: string; x: number; y: number } | null>;
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
  onMoveEnd: () => void;
  onNodeClick: (params: { node: unknown }) => void;
  onPaneClick: () => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  onNodeMouseEnter: (params: { node: unknown }) => void;
  onNodeMouseLeave: (params: { node: unknown }) => void;
  handleRelationshipFilterChange: (types: string[]) => Promise<void>;
  handleHideTestFilesToggle: (value: boolean) => Promise<void>;
  handleOrphanGlobalToggle: (value: boolean) => Promise<void>;
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
