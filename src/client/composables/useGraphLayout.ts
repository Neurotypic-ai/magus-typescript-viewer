import { nextTick, ref } from 'vue';

import { buildFolderDistributorGraph, buildOverviewGraph } from '../graph/buildGraphView';
import { getHandlePositions } from '../graph/handleRouting';
import { collectNodesNeedingInternalsUpdate } from '../graph/nodeDiff';
import { optimizeHighwayHandleRouting } from '../graph/transforms/edgeHighways';
import { WebWorkerLayoutProcessor } from '../layout/WebWorkerLayoutProcessor';
import { defaultLayoutConfig } from '../layout/config';
import { getRenderingStrategy } from '../rendering/strategyRegistry';
import { waitForNextPaint } from '../utils/dom';
import { simpleHash } from '../utils/hash';
import { measurePerformance } from '../utils/performanceMonitoring';
import { isContainerNode } from './useNodeDimensions';

import type { Ref } from 'vue';

import type { WebWorkerLayoutConfig } from '../layout/WebWorkerLayoutProcessor';
import type { LayoutConfig } from '../layout/config';
import type { RenderingStrategyId, RenderingStrategyOptionsById } from '../rendering/RenderingStrategy';
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

/** Internal: one measurement entry (width, height, header/body/subnodes, isContainer). */
interface NodeMeasurementEntry {
  width: number;
  height: number;
  headerH: number;
  bodyH: number;
  subnodesH: number;
  isContainer: boolean;
}

/** Measured width/height on a node (node.measured). */
export interface NodeMeasuredData {
  width?: number;
  height?: number;
}

const MAX_LAYOUT_CACHE_ENTRIES = 8;
const MAX_LAYOUT_CACHE_WEIGHT = 220_000;
const MAX_NODE_MEASUREMENT_CACHE_ENTRIES = 4_000;
let perfMarkSequence = 0;

const createPerfMarkNames = (scope: string): { start: string; end: string } => {
  const id = `${String(Date.now())}-${String(++perfMarkSequence)}`;
  return {
    start: `${scope}-start-${id}`,
    end: `${scope}-end-${id}`,
  };
};

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

/** How member nodes are displayed inside container nodes. */
export type MemberNodeMode = 'compact' | 'graph';

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

function getActiveDegreeWeightedLayers(
  strategyId: RenderingStrategyId,
  strategyOptionsById: RenderingStrategyOptionsById
): boolean {
  const opts = strategyOptionsById[strategyId];
  return typeof opts['degreeWeightedLayers'] === 'boolean' ? opts['degreeWeightedLayers'] : false;
}

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
  enabledNodeTypes: string[];
  activeRelationshipTypes: string[];
  clusterByFolder: boolean;
  collapseScc: boolean;
  collapsedFolderIds: Set<string>;
  hideTestFiles: boolean;
  memberNodeMode: MemberNodeMode;
  highlightOrphanGlobal: boolean;
  renderingStrategyId: RenderingStrategyId;
  strategyOptionsById: RenderingStrategyOptionsById;
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

/** Suspends edge virtualization (e.g. during layout). */
export type SuspendEdgeVirtualization = () => void;

/** Resumes edge virtualization. */
export type ResumeEdgeVirtualization = () => void;

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

/** Result of measureAllNodeDimensions. */
export interface MeasureNodesResult {
  nodes: DependencyNode[];
  hasChanges: boolean;
}

export interface UseGraphLayoutOptions {
  propsData: Ref<DependencyPackageGraph>;
  graphStore: GraphLayoutStore;
  graphSettings: GraphSettings;
  interaction: GraphLayoutInteraction;
  fitView: FitView;
  updateNodeInternals: UpdateNodeInternals;
  suspendEdgeVirtualization: SuspendEdgeVirtualization;
  resumeEdgeVirtualization: ResumeEdgeVirtualization;
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

export function useGraphLayout(options: UseGraphLayoutOptions): GraphLayout {
  const {
    propsData,
    graphStore,
    graphSettings,
    interaction,
    fitView,
    updateNodeInternals,
    suspendEdgeVirtualization,
    resumeEdgeVirtualization,
    syncViewportState,
    nodeDimensionTracker,
    resetSearchHighlightState,
    isFirefox,
    graphRootRef,
  } = options;

  const isLayoutPending = ref(false);
  const isLayoutMeasuring = ref(false);

  let layoutProcessor: WebWorkerLayoutProcessor | null = null;
  let layoutRequestVersion = 0;
  let graphInitPromise: Promise<void> | null = null;
  let graphInitQueued = false;
  let queuedGraphInitOverrides: LayoutProcessOptions | undefined;
  const nodeMeasurementCache = new Map<string, NodeMeasurementCacheEntry>();
  const layoutCache = new Map<string, LayoutCacheEntry>();
  let layoutCacheWeight = 0;

  const layoutConfig = defaultLayoutConfig;

  // ── Layout processor config ──

  const getLayoutProcessorConfig = (): WebWorkerLayoutConfig => {
    const degreeWeightedLayers = getActiveDegreeWeightedLayers(
      graphSettings.renderingStrategyId,
      graphSettings.strategyOptionsById
    );
    return {
      algorithm: layoutConfig.algorithm,
      direction: layoutConfig.direction,
      nodeSpacing: layoutConfig.nodeSpacing,
      rankSpacing: layoutConfig.rankSpacing,
      edgeSpacing: layoutConfig.edgeSpacing,
      degreeWeightedLayers,
      theme: layoutConfig.theme,
      animationDuration: layoutConfig.animationDuration,
    };
  };

  const initializeLayoutProcessor = () => {
    layoutRequestVersion += 1;

    if (!layoutProcessor) {
      layoutProcessor = new WebWorkerLayoutProcessor(getLayoutProcessorConfig());
      return;
    }

    layoutProcessor.updateConfig(getLayoutProcessorConfig());
  };

  // ── Cache helpers ──

  const computeLayoutCacheKey = (cacheNodes: DependencyNode[], edgeList: GraphEdge[]): string => {
    const nodeIds = cacheNodes
      .map((n) => n.id)
      .sort()
      .join(',');
    const edgeIds = edgeList
      .map((e) => e.id)
      .sort()
      .join(',');
    const dwl = getActiveDegreeWeightedLayers(graphSettings.renderingStrategyId, graphSettings.strategyOptionsById)
      ? 1
      : 0;
    return `${layoutConfig.algorithm}:${layoutConfig.direction}:${String(layoutConfig.nodeSpacing)}:${String(layoutConfig.rankSpacing)}:${String(layoutConfig.edgeSpacing)}:dwl${String(dwl)}:${String(nodeIds.length)}:${String(edgeIds.length)}:${String(simpleHash(nodeIds))}:${String(simpleHash(edgeIds))}`;
  };

  const estimateLayoutCacheWeight = (cacheNodes: DependencyNode[], edgeList: GraphEdge[]): number => {
    return cacheNodes.length * 18 + edgeList.length * 10;
  };

  const trimLayoutCache = (nextEntryWeight: number): void => {
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
  };

  const pruneNodeMeasurementCache = (liveNodes: DependencyNode[]): void => {
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
  };

  // ── Measurement ──

  const shouldRunTwoPassMeasure = (_nodeCount: number): boolean => true;

  const measureAllNodeDimensions = (layoutedNodes: DependencyNode[]): MeasureNodesResult => {
    if (layoutedNodes.length === 0) {
      return { nodes: layoutedNodes, hasChanges: false };
    }

    nodeDimensionTracker.refresh();
    const fallbackElementMap = new Map<string, HTMLElement>();

    const measurements = new Map<string, NodeMeasurementEntry>();

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

      const currentMeasured = (node as unknown as { measured?: NodeMeasuredData }).measured;
      const widthDelta = Math.abs((currentMeasured?.width ?? 0) - m.width);
      const heightDelta = Math.abs((currentMeasured?.height ?? 0) - m.height);
      const cached = nodeMeasurementCache.get(node.id);
      const cacheDeltaWidth = Math.abs((cached?.width ?? 0) - m.width);
      const cacheDeltaHeight = Math.abs((cached?.height ?? 0) - m.height);

      let insetChanged = false;
      let measuredTopInset = 0;

      if (m.isContainer) {
        measuredTopInset = Math.max(96, Math.round(m.headerH + m.bodyH + m.subnodesH + 12));
        const currentTopInset = node.data?.layoutInsets?.top ?? 0;
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
    if (!layoutProcessor) {
      return null;
    }

    const requestVersion = ++layoutRequestVersion;
    const fitViewToResult = layoutOptions.fitViewToResult ?? true;
    const fitPadding = layoutOptions.fitPadding ?? 0.1;
    const twoPassMeasure = layoutOptions.twoPassMeasure ?? shouldRunTwoPassMeasure(graphData.nodes.length);
    const layoutPerfMarks = createPerfMarkNames('layout');
    let didMeasureLayout = false;

    isLayoutPending.value = true;
    if (twoPassMeasure) {
      isLayoutMeasuring.value = true;
    }

    suspendEdgeVirtualization();
    graphStore.suspendCacheWrites();
    nodeDimensionTracker.pause();

    try {
      performance.mark(layoutPerfMarks.start);

      // Check layout cache
      const cacheKey = computeLayoutCacheKey(graphData.nodes, graphData.edges);
      const cachedEntry = layoutCache.get(cacheKey);
      if (cachedEntry) {
        layoutCache.delete(cacheKey);
        layoutCache.set(cacheKey, cachedEntry);

        const previousNodes = graphStore.nodes;
        const cachedNodes =
          graphStore.manualOffsets.size > 0 ? graphStore.applyManualOffsets(cachedEntry.nodes) : cachedEntry.nodes;
        graphStore.setNodes(cachedNodes);
        graphStore.setEdges(cachedEntry.edges);
        pruneNodeMeasurementCache(cachedNodes);
        await nextTick();
        const changedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, cachedNodes);
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
        resumeEdgeVirtualization();

        performance.mark(layoutPerfMarks.end);
        measurePerformance('graph-layout', layoutPerfMarks.start, layoutPerfMarks.end);
        didMeasureLayout = true;
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

      const previousNodes = graphStore.nodes;
      graphStore.setNodes(normalized.nodes);
      graphStore.setEdges(normalized.edges);
      pruneNodeMeasurementCache(normalized.nodes);

      await nextTick();
      const firstPassChangedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, normalized.nodes);
      firstPassChangedNodeIds.forEach((id) => pendingNodeInternalUpdates.add(id));

      if (twoPassMeasure) {
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

          graphStore.setNodes(normalized.nodes);
          graphStore.setEdges(normalized.edges);
          pruneNodeMeasurementCache(normalized.nodes);
          await nextTick();
          const secondPassChangedNodeIds = collectNodesNeedingInternalsUpdate(firstPassNodes, normalized.nodes);
          secondPassChangedNodeIds.forEach((id) => pendingNodeInternalUpdates.add(id));
        }
      }

      if (pendingNodeInternalUpdates.size > 0) {
        updateNodeInternals(Array.from(pendingNodeInternalUpdates));
      }

      if (graphStore.manualOffsets.size > 0) {
        const offsetNodes = graphStore.applyManualOffsets(normalized.nodes);
        graphStore.setNodes(offsetNodes);
        normalized = { nodes: offsetNodes, edges: normalized.edges };
      }

      if (fitViewToResult) {
        const fitDuration = isFirefox.value ? 0 : 180;
        if (layoutOptions.fitNodes && layoutOptions.fitNodes.length > 0) {
          await fitView({
            duration: fitDuration,
            padding: fitPadding,
            nodes: layoutOptions.fitNodes,
          });
        } else {
          await fitView({
            duration: fitDuration,
            padding: fitPadding,
          });
        }
      }
      syncViewportState();
      resumeEdgeVirtualization();

      const cacheEntryWeight = estimateLayoutCacheWeight(normalized.nodes, normalized.edges);
      trimLayoutCache(cacheEntryWeight);
      layoutCache.set(cacheKey, {
        nodes: normalized.nodes,
        edges: normalized.edges,
        weight: cacheEntryWeight,
      });
      layoutCacheWeight += cacheEntryWeight;

      performance.mark(layoutPerfMarks.end);
      measurePerformance('graph-layout', layoutPerfMarks.start, layoutPerfMarks.end);
      didMeasureLayout = true;

      return normalized;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error during layout processing');
      console.error('Layout processing failed:', error);
      return null;
    } finally {
      if (!didMeasureLayout) {
        performance.clearMarks(layoutPerfMarks.start);
        performance.clearMarks(layoutPerfMarks.end);
      }
      isLayoutMeasuring.value = false;
      nodeDimensionTracker.resume();
      graphStore.resumeCacheWrites();
      resumeEdgeVirtualization();
      if (requestVersion === layoutRequestVersion) {
        isLayoutPending.value = false;
      }
      // Enable content-visibility culling after layout stabilizes (skipped
      // on Firefox where the feature causes severe toggle-thrash regressions).
      if (!isFirefox.value) {
        graphRootRef.value?.classList.add('cv-ready');
      }
    }
  };

  // ── Graph initialization ──

  const initializeGraph = async (overrides: LayoutProcessOptions = {}) => {
    const graphInitPerfMarks = createPerfMarkNames('graph-init');
    performance.mark(graphInitPerfMarks.start);
    try {
      resetSearchHighlightState();
      interaction.resetInteraction();
      graphStore.setViewMode('overview');
      initializeLayoutProcessor();

      const strategy = getRenderingStrategy(graphSettings.renderingStrategyId);
      const strategyOptions = graphSettings.strategyOptionsById[strategy.id];
      const sharedBuildOptions = {
        data: propsData.value,
        enabledNodeTypes: new Set(graphSettings.enabledNodeTypes),
        enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
        direction: layoutConfig.direction,
        clusterByFolder: graphSettings.clusterByFolder,
        collapseScc: graphSettings.collapseScc,
        collapsedFolderIds: graphSettings.collapsedFolderIds,
        hideTestFiles: graphSettings.hideTestFiles,
        memberNodeMode: graphSettings.memberNodeMode,
        highlightOrphanGlobal: graphSettings.highlightOrphanGlobal,
      };
      const overviewGraph =
        strategy.runtime.buildMode === 'folderDistributor'
          ? buildFolderDistributorGraph({
              ...sharedBuildOptions,
              strategyOptions,
            })
          : buildOverviewGraph(sharedBuildOptions);
      graphStore.setSemanticSnapshot(overviewGraph.semanticSnapshot ?? null);

      const fitViewToResult = overrides.fitViewToResult ?? true;
      const fitPadding = overrides.fitPadding ?? 0.1;
      const twoPassMeasure = overrides.twoPassMeasure ?? shouldRunTwoPassMeasure(overviewGraph.nodes.length);
      const layoutResult = await processGraphLayout(overviewGraph, {
        fitViewToResult,
        fitPadding,
        ...(overrides.fitNodes ? { fitNodes: overrides.fitNodes } : {}),
        twoPassMeasure,
      });
      if (layoutResult) {
        graphStore.setOverviewSnapshot(layoutResult);
      }
    } finally {
      performance.mark(graphInitPerfMarks.end);
      measurePerformance('graph-initialization', graphInitPerfMarks.start, graphInitPerfMarks.end);
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
    if (layoutProcessor) {
      layoutProcessor.dispose();
      layoutProcessor = null;
    }
    layoutCache.clear();
    layoutCacheWeight = 0;
    nodeMeasurementCache.clear();
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
