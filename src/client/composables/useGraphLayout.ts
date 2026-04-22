import { nextTick, ref } from 'vue';

import { consola } from 'consola';

import { buildOverviewGraph } from '../graph/buildGraphView';
import { getHandlePositions } from '../graph/handleRouting';
import { collectNodesNeedingInternalsUpdate } from '../graph/nodeDiff';
import { parseDimension } from '../layout/geometryBounds';
import { computeSimpleHierarchicalLayout } from '../layout/simpleHierarchicalLayout';

import type { Ref } from 'vue';

import type { PackageGraph } from '../../shared/types/Package';
import type { ManualOffset } from '../../shared/types/graph/ManualOffset';
import type { GraphViewMode } from '../stores/graphStore';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';
import type { NodePremeasure, NodePremeasureResult } from './nodePremeasureTypes';

const layoutLogger = consola.withTag('GraphLayout');

export interface LayoutProcessOptions {
  fitViewToResult?: boolean;
  fitPadding?: number;
  fitNodes?: string[];
  twoPassMeasure?: boolean;
}

/** Result of measureAllNodeDimensions. */
interface MeasureNodesResult {
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
  edges: GraphEdge[];
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
  subscribe?: (listener: (changedNodeIds: string[]) => void) => () => void;
}

export interface UseGraphLayoutOptions {
  propsData: Ref<PackageGraph>;
  graphStore: GraphLayoutStore;
  graphSettings: GraphSettings;
  interaction: GraphLayoutInteraction;
  fitView: FitView;
  updateNodeInternals: UpdateNodeInternals;
  syncViewportState: SyncViewportState;
  nodeDimensionTracker: NodeDimensionTracker;
  nodePremeasure?: NodePremeasure;
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

interface GraphLayout {
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
    nodeDimensionTracker,
    nodePremeasure,
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
  let nodeMeasurementRelayoutRafId: number | null = null;
  let hasPendingMeasurementRelayout = false;

  // ── Stub measurement functions (kept for API compatibility with useIsolationMode) ──

  const shouldRunTwoPassMeasure = (nodeCount: number): boolean => nodeCount > 0;

  const getNodeWidth = (node: DependencyNode): number => {
    const measured = (node as { measured?: { width?: number } }).measured?.width;
    const style =
      typeof node.style === 'object' && !Array.isArray(node.style)
        ? parseDimension((node.style as Record<string, unknown>)['width'])
        : undefined;
    return measured ?? style ?? parseDimension(node.width) ?? 0;
  };

  const getNodeHeight = (node: DependencyNode): number => {
    const measured = (node as { measured?: { height?: number } }).measured?.height;
    const style =
      typeof node.style === 'object' && !Array.isArray(node.style)
        ? parseDimension((node.style as Record<string, unknown>)['height'])
        : undefined;
    return measured ?? style ?? parseDimension(node.height) ?? 0;
  };

  const applyNodeDimensions = (node: DependencyNode, dimensions: NodePremeasureResult): DependencyNode => {
    const styleBase =
      node.style && typeof node.style === 'object' && !Array.isArray(node.style)
        ? (node.style as Record<string, string | number>)
        : undefined;

    return {
      ...node,
      measured: {
        width: dimensions.width,
        height: dimensions.height,
      },
      style: {
        ...(styleBase ?? {}),
        width: `${String(dimensions.width)}px`,
        height: `${String(dimensions.height)}px`,
      },
    } as DependencyNode;
  };

  const measureAllNodeDimensions = (layoutedNodes: DependencyNode[]): MeasureNodesResult => {
    let hasChanges = false;

    const nodes = layoutedNodes.map((node) => {
      const dimensions = nodeDimensionTracker.get(node.id);
      if (!dimensions) {
        return node;
      }

      const currentWidth = getNodeWidth(node);
      const currentHeight = getNodeHeight(node);
      if (Math.abs(currentWidth - dimensions.width) > 1 || Math.abs(currentHeight - dimensions.height) > 1) {
        hasChanges = true;
      }

      return applyNodeDimensions(node, dimensions);
    });

    return { nodes, hasChanges };
  };

  const scheduleMeasurementDrivenRelayout = (): void => {
    if (isLayoutPending.value || isLayoutMeasuring.value) {
      hasPendingMeasurementRelayout = true;
      return;
    }

    if (nodeMeasurementRelayoutRafId !== null) {
      return;
    }

    nodeMeasurementRelayoutRafId = requestAnimationFrame(() => {
      void (async () => {
      nodeMeasurementRelayoutRafId = null;
      if (isLayoutPending.value || isLayoutMeasuring.value || graphStore.nodes.length === 0) {
        return;
      }

      const measuredNodes = measureAllNodeDimensions(graphStore.nodes);
      if (!measuredNodes.hasChanges) {
        return;
      }

      const previousLayoutMeasuring = isLayoutMeasuring.value;
      isLayoutMeasuring.value = true;
      try {
        await processGraphLayout(
          {
            nodes: measuredNodes.nodes,
            edges: graphStore.edges,
          },
          { fitViewToResult: false }
        );
      } finally {
        isLayoutMeasuring.value = previousLayoutMeasuring;
        if (hasPendingMeasurementRelayout) {
          hasPendingMeasurementRelayout = false;
          scheduleMeasurementDrivenRelayout();
        }
      }
      })();
    });
  };

  nodeDimensionTracker.subscribe?.(() => {
    scheduleMeasurementDrivenRelayout();
  });

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
      edges: resultEdges,
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
      // Compute positions and parent sizes synchronously using the simple hierarchical layout.
      const layoutResult = computeSimpleHierarchicalLayout(graphData.nodes, graphData.edges) as unknown as {
        positions: Map<string, { x: number; y: number }>;
        sizes: Map<string, { width: number; height: number }>;
      };

      // Phase 5: SCC supernodes carry their members' relative positions and
      // the supernode's bounding-box size on node.data. If present, override
      // the simple hierarchical layout's decisions for both the members and
      // the supernode itself. This mirrors how folders get their sizes
      // computed separately but keeps the code out of
      // computeSimpleHierarchicalLayout (which Phase 1 owns).
      const sccMemberPositionOverrides = new Map<string, { x: number; y: number }>();
      const sccParentSizeOverrides = new Map<string, { width: number; height: number }>();
      for (const node of graphData.nodes) {
        if (node.type !== 'scc') continue;
        const rawPositions = node.data?.sccMemberPositions;
        const size = node.data?.sccSize;
        if (size) sccParentSizeOverrides.set(node.id, size);
        if (rawPositions && typeof rawPositions === 'object') {
          for (const [memberId, pos] of Object.entries(rawPositions)) {
            if (
              pos &&
              typeof pos === 'object' &&
              typeof (pos as { x?: unknown }).x === 'number' &&
              typeof (pos as { y?: unknown }).y === 'number'
            ) {
              const typed = pos as { x: number; y: number };
              sccMemberPositionOverrides.set(memberId, { x: typed.x, y: typed.y });
            }
          }
        }
      }

      // Apply computed positions and explicit sizes to nodes.
      // Children get relative positions within their parent; parents get explicit
      // CSS width/height strings so Vue Flow renders them large enough to enclose
      // children. Using CSS strings in node.style is the same format Vue Flow's
      // own handleParentExpand uses, ensuring consistent dimension tracking.
      const positionedNodes = graphData.nodes.map((node) => {
        // SCC overrides take priority over simpleHierarchicalLayout's decisions.
        const overridePos = sccMemberPositionOverrides.get(node.id);
        const overrideSize = sccParentSizeOverrides.get(node.id);
        const pos = overridePos ?? layoutResult.positions.get(node.id);
        const rawSize = overrideSize ?? layoutResult.sizes.get(node.id);
        const sz =
          rawSize && typeof rawSize.width === 'number' && typeof rawSize.height === 'number' ? rawSize : undefined;
        const styleBase =
          node.style && typeof node.style === 'object' && !Array.isArray(node.style)
            ? (node.style as Record<string, string | number>)
            : undefined;
        return {
          ...node,
          ...(pos ? { position: pos } : {}),
          ...(sz
            ? {
                style: {
                  ...(styleBase ?? {}),
                  width: `${String(sz.width)}px`,
                  height: `${String(sz.height)}px`,
                },
              }
            : {}),
        };
      });

      const normalized = normalizeLayoutResult(positionedNodes, graphData.edges);

      const previousNodes = graphStore.nodes;

      const finalNodes =
        graphStore.manualOffsets.size > 0 ? graphStore.applyManualOffsets(normalized.nodes) : normalized.nodes;

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
      layoutLogger.error('Layout processing failed:', error);
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

      let graphForLayout = overviewGraph;
      if (nodePremeasure) {
        const previousLayoutMeasuring = isLayoutMeasuring.value;
        isLayoutMeasuring.value = true;
        try {
          const measuredNodes = await nodePremeasure.measureBatch(overviewGraph.nodes);
          if (measuredNodes.size > 0) {
            graphForLayout = {
              ...overviewGraph,
              nodes: overviewGraph.nodes.map((node) => {
                if (node.type === 'group') {
                  return node;
                }
                const dimensions = measuredNodes.get(node.id);
                return dimensions ? applyNodeDimensions(node, dimensions) : node;
              }),
            };
          }
        } finally {
          nodePremeasure.clearBatch();
          isLayoutMeasuring.value = previousLayoutMeasuring;
          if (hasPendingMeasurementRelayout) {
            hasPendingMeasurementRelayout = false;
            scheduleMeasurementDrivenRelayout();
          }
        }
      }

      const fitViewToResult = overrides.fitViewToResult ?? true;
      const fitPadding = overrides.fitPadding ?? 0.1;
      const layoutResult = await processGraphLayout(graphForLayout, {
        fitViewToResult,
        fitPadding,
        ...(overrides.fitNodes ? { fitNodes: overrides.fitNodes } : {}),
      });
      if (layoutResult) {
        graphStore.setOverviewSnapshot(layoutResult);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error during graph initialization');
      layoutLogger.error('Graph initialization failed:', error);
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
    if (nodeMeasurementRelayoutRafId !== null) {
      cancelAnimationFrame(nodeMeasurementRelayoutRafId);
      nodeMeasurementRelayoutRafId = null;
    }
    hasPendingMeasurementRelayout = false;
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
