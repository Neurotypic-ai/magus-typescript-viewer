import { nextTick, ref } from 'vue';

import { buildOverviewGraph } from '../graph/buildGraphView';
import { getHandlePositions } from '../graph/handleRouting';
import { collectNodesNeedingInternalsUpdate } from '../graph/nodeDiff';
import { optimizeHighwayHandleRouting } from '../graph/transforms/edgeHighways';
import { computeSimpleHierarchicalLayout } from '../layout/simpleHierarchicalLayout';

import type { Ref } from 'vue';

import type { GraphViewMode } from '../stores/graphStore';
import type { DependencyNode } from '../types/DependencyNode';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { GraphEdge } from '../types/GraphEdge';
import type { ManualOffset } from '../types/ManualOffset';

export interface LayoutProcessOptions {
  fitViewToResult?: boolean;
  fitPadding?: number;
  fitNodes?: string[];
  twoPassMeasure?: boolean;
}

// ── Layout cache ──

/** One entry in the layout cache (nodes, edges, weight). */
export interface LayoutCacheEntry {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  weight: number;
}

/** Measured width/height on a node (node.measured). */
export interface NodeMeasuredData {
  width?: number;
  height?: number;
}

/** Result of measureAllNodeDimensions. */
export interface MeasureNodesResult {
  nodes: DependencyNode[];
  hasChanges: boolean;
}

// ── Types ──

/** Snapshot of graph nodes and edges (overview or semantic). */
export interface GraphSnapshot {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

/** Sets the overview snapshot. */
export type SetOverviewSnapshot = (snapshot: GraphSnapshot) => void;

/** Sets the semantic snapshot (null to clear). */
export type SetSemanticSnapshot = (snapshot: GraphSnapshot | null) => void;

/** Map of node id → manual offset. */
export type ManualOffsetsMap = Map<string, ManualOffset>;

/** Applies manual offsets to a list of nodes; returns new array. */
export type ApplyManualOffsets = (nodes: DependencyNode[]) => DependencyNode[];

/** Sets the nodes array in the graph store. */
export type SetNodes = (nodes: DependencyNode[]) => void;

/** Sets the edges array in the graph store. */
export type SetEdges = (edges: GraphEdge[]) => void;

/** Sets the current view mode (e.g. 'overview', 'isolate'). */
export type SetViewMode = (mode: GraphViewMode) => void;

/** Suspends cache writes (e.g. during layout). */
export type SuspendCacheWrites = () => void;

/** Resumes cache writes. */
export type ResumeCacheWrites = () => void;

export interface GraphLayoutStore {
  nodes: DependencyNode[];
  setNodes: SetNodes;
  setEdges: SetEdges;
  setOverviewSnapshot: SetOverviewSnapshot;
  setSemanticSnapshot: SetSemanticSnapshot;
  setViewMode: SetViewMode;
  suspendCacheWrites: SuspendCacheWrites;
  resumeCacheWrites: ResumeCacheWrites;
  manualOffsets: ManualOffsetsMap;
  applyManualOffsets: ApplyManualOffsets;
}

export interface GraphSettings {
  activeRelationshipTypes: string[];
  collapsedFolderIds: Set<string>;
  hideTestFiles: boolean;
  highlightOrphanGlobal: boolean;
}

/** Options passed to fitView (duration, padding, node ids to fit). */
export interface FitViewOptions {
  duration?: number;
  padding?: number;
  nodes?: string[];
}

/** Fits the viewport to the graph or to given nodes. */
export type FitView = (opts?: FitViewOptions) => Promise<boolean>;

// ── Callbacks & interaction ──

/** Resets pan/zoom/selection interaction state. */
export type ResetInteraction = () => void;

/** Updates Vue Flow node internals for given node ids. */
export type UpdateNodeInternals = (ids: string[]) => void;

/** Syncs viewport state to external store. */
export type SyncViewportState = () => void;

/** Clears search highlight state. */
export type ResetSearchHighlightState = () => void;

/** Interaction API passed into layout composable. */
export interface GraphLayoutInteraction {
  resetInteraction: ResetInteraction;
}

// ── Node dimensions (tracker & measurement) ──

/** Dimensions for a single node from the dimension tracker. */
export interface NodeDimensions {
  width: number;
  height: number;
  headerHeight: number;
  bodyHeight: number;
  subnodesHeight: number;
}

/** Tracks node dimensions (from DOM or measured). */
export interface NodeDimensionTracker {
  refresh: () => void;
  get: (nodeId: string) => NodeDimensions | undefined;
  pause: () => void;
  resume: () => void;
}

/** One entry in the node measurement cache (width, height, topInset). */
export interface NodeMeasurementCacheEntry {
  width: number;
  height: number;
  topInset: number;
}

export interface UseGraphLayoutOptions {
  propsData: Ref<DependencyPackageGraph>;
  graphStore: GraphLayoutStore;
  graphSettings: GraphSettings;
  interaction: GraphLayoutInteraction;
  fitView: FitView;
  updateNodeInternals: UpdateNodeInternals;
  syncViewportState: SyncViewportState;
  nodeDimensionTracker: NodeDimensionTracker;
  resetSearchHighlightState: ResetSearchHighlightState;
  isFirefox: Ref<boolean>;
  graphRootRef: Ref<HTMLElement | null>;
}

/** Processes graph layout; returns normalized nodes/edges or null. */
export type ProcessGraphLayout = (
  graphData: GraphSnapshot,
  options?: LayoutProcessOptions
) => Promise<GraphSnapshot | null>;

/** Measures all node dimensions; returns updated nodes and hasChanges. */
export type MeasureAllNodeDimensions = (layoutedNodes: DependencyNode[]) => MeasureNodesResult;

/** Returns whether two-pass measurement should run for the given node count. */
export type ShouldRunTwoPassMeasure = (nodeCount: number) => boolean;

/** Simplified layout config; direction is always 'LR'. */
export interface LayoutConfig {
  direction: 'TB' | 'LR' | 'BT' | 'RL';
}

export interface GraphLayout {
  isLayoutPending: Readonly<Ref<boolean>>;
  isLayoutMeasuring: Readonly<Ref<boolean>>;
  layoutConfig: LayoutConfig;
  processGraphLayout: ProcessGraphLayout;
  initializeGraph: (overrides?: LayoutProcessOptions) => Promise<void>;
  requestGraphInitialization: (overrides?: LayoutProcessOptions) => Promise<void>;
  measureAllNodeDimensions: MeasureAllNodeDimensions;
  shouldRunTwoPassMeasure: ShouldRunTwoPassMeasure;
  dispose: () => void;
}

const HARDCODED_LAYOUT_CONFIG: LayoutConfig = { direction: 'LR' };

export function useGraphLayout(options: UseGraphLayoutOptions): GraphLayout {
  const {
    propsData,
    graphStore,
    graphSettings,
    interaction,
    fitView,
    updateNodeInternals,
    syncViewportState,
    resetSearchHighlightState,
    isFirefox,
    graphRootRef,
  } = options;

  const layoutConfig = HARDCODED_LAYOUT_CONFIG;

  const isLayoutPending = ref(false);
  // Always false — no two-pass measurement in the simple layout.
  const isLayoutMeasuring = ref(false);

  let graphInitPromise: Promise<void> | null = null;
  let graphInitQueued = false;
  let queuedGraphInitOverrides: LayoutProcessOptions | undefined;

  // ── Stub measurement functions (kept for API compatibility with useIsolationMode) ──

  const shouldRunTwoPassMeasure = (_nodeCount: number): boolean => false;

  const measureAllNodeDimensions = (layoutedNodes: DependencyNode[]): MeasureNodesResult => {
    return { nodes: layoutedNodes, hasChanges: false };
  };

  // ── Layout normalization ──

  const normalizeLayoutResult = (resultNodes: DependencyNode[], resultEdges: GraphEdge[]): GraphSnapshot => {
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

  // ── Main layout pipeline ──

  const processGraphLayout = async (
    graphData: GraphSnapshot,
    layoutOptions: LayoutProcessOptions = {}
  ): Promise<GraphSnapshot | null> => {
    const fitViewToResult = layoutOptions.fitViewToResult ?? true;
    const fitPadding = layoutOptions.fitPadding ?? 0.1;

    isLayoutPending.value = true;
    graphStore.suspendCacheWrites();

    try {
      // Compute positions and parent sizes synchronously using the simple hierarchical layout
      const { positions, sizes } = computeSimpleHierarchicalLayout(graphData.nodes, graphData.edges);

      // Apply computed positions and explicit sizes to nodes.
      // Children get relative positions within their parent; parents get explicit
      // CSS width/height strings so Vue Flow renders them large enough to enclose
      // children. Using CSS strings in node.style is the same format Vue Flow's
      // own handleParentExpand uses, ensuring consistent dimension tracking.
      const positionedNodes = graphData.nodes.map((node) => {
        const pos = positions.get(node.id);
        const sz = sizes.get(node.id);
        return {
          ...node,
          ...(pos ? { position: pos } : {}),
          ...(sz
            ? {
                style: { ...node.style, width: `${sz.width}px`, height: `${sz.height}px` },
              }
            : {}),
        };
      });

      const normalized = normalizeLayoutResult(positionedNodes, graphData.edges);

      const previousNodes = graphStore.nodes;

      const finalNodes =
        graphStore.manualOffsets.size > 0
          ? graphStore.applyManualOffsets(normalized.nodes)
          : normalized.nodes;

      graphStore.setNodes(finalNodes);
      graphStore.setEdges(normalized.edges);

      await nextTick();

      const changedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, finalNodes);
      if (changedNodeIds.length > 0) {
        updateNodeInternals(changedNodeIds);
      }

      if (fitViewToResult) {
        const fitDuration = isFirefox.value ? 0 : 180;
        await fitView({
          duration: fitDuration,
          padding: fitPadding,
          ...(layoutOptions.fitNodes?.length ? { nodes: layoutOptions.fitNodes } : {}),
        });
      }

      syncViewportState();

      return { nodes: finalNodes, edges: normalized.edges };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error during layout processing');
      console.error('Layout processing failed:', error);
      return null;
    } finally {
      graphStore.resumeCacheWrites();
      isLayoutPending.value = false;
      // Enable content-visibility culling after layout stabilizes (skipped
      // on Firefox where the feature causes severe toggle-thrash regressions).
      if (!isFirefox.value) {
        graphRootRef.value?.classList.add('cv-ready');
      }
    }
  };

  // ── Graph initialization ──

  const initializeGraph = async (overrides: LayoutProcessOptions = {}) => {
    try {
      resetSearchHighlightState();
      interaction.resetInteraction();
      graphStore.setViewMode('overview');

      const overviewGraph = buildOverviewGraph({
        data: propsData.value,
        enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
        direction: layoutConfig.direction,
        collapsedFolderIds: graphSettings.collapsedFolderIds,
        hideTestFiles: graphSettings.hideTestFiles,
        highlightOrphanGlobal: graphSettings.highlightOrphanGlobal,
      });
      graphStore.setSemanticSnapshot(overviewGraph.semanticSnapshot ?? null);

      const fitViewToResult = overrides.fitViewToResult ?? true;
      const fitPadding = overrides.fitPadding ?? 0.1;
      const layoutResult = await processGraphLayout(overviewGraph, {
        fitViewToResult,
        fitPadding,
        ...(overrides.fitNodes ? { fitNodes: overrides.fitNodes } : {}),
      });
      if (layoutResult) {
        graphStore.setOverviewSnapshot(layoutResult);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error during graph initialization');
      console.error('Graph initialization failed:', error);
    }
  };

  const requestGraphInitialization = async (overrides?: LayoutProcessOptions): Promise<void> => {
    queuedGraphInitOverrides = overrides;
    graphInitQueued = true;
    if (graphInitPromise) {
      await graphInitPromise;
      return;
    }

    graphInitPromise = (async () => {
      while (graphInitQueued) {
        graphInitQueued = false;
        const nextOverrides = queuedGraphInitOverrides;
        queuedGraphInitOverrides = undefined;
        await initializeGraph(nextOverrides);
      }
    })();

    try {
      await graphInitPromise;
    } finally {
      graphInitPromise = null;
    }
  };

  // ── Cleanup ──

  const dispose = (): void => {
    // Nothing to dispose in the simple synchronous layout.
  };

  return {
    isLayoutPending,
    isLayoutMeasuring,
    layoutConfig,
    processGraphLayout,
    initializeGraph,
    requestGraphInitialization,
    measureAllNodeDimensions,
    shouldRunTwoPassMeasure,
    dispose,
  };
}
