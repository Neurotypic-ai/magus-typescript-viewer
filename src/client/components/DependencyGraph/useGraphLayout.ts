import { nextTick, ref } from 'vue';

import { optimizeHighwayHandleRouting } from '../../graph/transforms/edgeHighways';
import { WebWorkerLayoutProcessor } from '../../layout/WebWorkerLayoutProcessor';
import { graphTheme } from '../../theme/graphTheme';
import { measurePerformance } from '../../utils/performanceMonitoring';
import { buildOverviewGraph } from './buildGraphView';
import { collectNodesNeedingInternalsUpdate, getEnabledNodeTypes, getHandlePositions, simpleHash } from './graphUtils';
import { isContainerNode } from './useNodeDimensions';

import type { Ref } from 'vue';

import type { DependencyNode, DependencyPackageGraph, GraphEdge } from './types';

// ── Layout configuration ──

export const defaultLayoutConfig = {
  algorithm: 'layered' as 'layered' | 'radial' | 'force' | 'stress',
  direction: 'LR' as 'LR' | 'RL' | 'TB' | 'BT',
  nodeSpacing: 80,
  rankSpacing: 200,
  edgeSpacing: 30,
};

export type LayoutConfig = typeof defaultLayoutConfig;

export interface LayoutProcessOptions {
  fitViewToResult?: boolean;
  fitPadding?: number;
  fitNodes?: string[];
  twoPassMeasure?: boolean;
}

// ── Layout cache ──

interface LayoutCacheEntry {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  weight: number;
}

const MAX_LAYOUT_CACHE_ENTRIES = 8;
const MAX_LAYOUT_CACHE_WEIGHT = 220_000;
const MAX_NODE_MEASUREMENT_CACHE_ENTRIES = 4_000;
const TWO_PASS_MEASURE_NODE_THRESHOLD = 500;

// ── Types ──

interface NodeDimensionTracker {
  refresh: () => void;
  get: (nodeId: string) => {
    width: number;
    height: number;
    headerHeight: number;
    bodyHeight: number;
    subnodesHeight: number;
  } | undefined;
}

export interface UseGraphLayoutOptions {
  propsData: Ref<DependencyPackageGraph>;
  graphStore: {
    nodes: DependencyNode[];
    setNodes: (nodes: DependencyNode[]) => void;
    setEdges: (edges: GraphEdge[]) => void;
    setOverviewSnapshot: (snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] }) => void;
    setSemanticSnapshot: (snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] } | null) => void;
    setViewMode: (mode: string) => void;
    suspendCacheWrites: () => void;
    resumeCacheWrites: () => void;
    manualOffsets: Map<string, { dx: number; dy: number }>;
    applyManualOffsets: (nodes: DependencyNode[]) => DependencyNode[];
  };
  graphSettings: {
    enabledNodeTypes: string[];
    activeRelationshipTypes: string[];
    clusterByFolder: boolean;
    collapseScc: boolean;
    collapsedFolderIds: Set<string>;
    hideTestFiles: boolean;
    memberNodeMode: 'compact' | 'graph';
    highlightOrphanGlobal: boolean;
    degreeWeightedLayers: boolean;
  };
  interaction: {
    resetInteraction: () => void;
  };
  fitView: (opts?: { duration?: number; padding?: number; nodes?: string[] }) => Promise<void>;
  updateNodeInternals: (ids: string[]) => void;
  suspendEdgeVirtualization: () => void;
  resumeEdgeVirtualization: () => void;
  syncViewportState: () => void;
  nodeDimensionTracker: NodeDimensionTracker;
  resetSearchHighlightState: () => void;
}

export interface GraphLayout {
  isLayoutPending: Readonly<Ref<boolean>>;
  isLayoutMeasuring: Readonly<Ref<boolean>>;
  layoutConfig: LayoutConfig;
  processGraphLayout: (
    graphData: { nodes: DependencyNode[]; edges: GraphEdge[] },
    options?: LayoutProcessOptions
  ) => Promise<{ nodes: DependencyNode[]; edges: GraphEdge[] } | null>;
  initializeGraph: () => Promise<void>;
  requestGraphInitialization: () => Promise<void>;
  measureAllNodeDimensions: (
    layoutedNodes: DependencyNode[]
  ) => { nodes: DependencyNode[]; hasChanges: boolean };
  shouldRunTwoPassMeasure: (nodeCount: number) => boolean;
  setLayoutConfig: (partial: Partial<LayoutConfig>) => void;
  resetLayoutConfig: () => void;
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
  } = options;

  const isLayoutPending = ref(false);
  const isLayoutMeasuring = ref(false);

  let layoutProcessor: WebWorkerLayoutProcessor | null = null;
  let layoutRequestVersion = 0;
  let graphInitPromise: Promise<void> | null = null;
  let graphInitQueued = false;
  const nodeMeasurementCache = new Map<string, { width: number; height: number; topInset: number }>();
  const layoutCache = new Map<string, LayoutCacheEntry>();
  let layoutCacheWeight = 0;

  const layoutConfig: LayoutConfig = { ...defaultLayoutConfig };

  // ── Layout processor config ──

  const getLayoutProcessorConfig = () => ({
    algorithm: layoutConfig.algorithm,
    direction: layoutConfig.direction,
    nodeSpacing: layoutConfig.nodeSpacing,
    rankSpacing: layoutConfig.rankSpacing,
    edgeSpacing: layoutConfig.edgeSpacing,
    degreeWeightedLayers: graphSettings.degreeWeightedLayers,
    theme: graphTheme,
    animationDuration: 150,
  });

  const initializeLayoutProcessor = () => {
    layoutRequestVersion += 1;

    if (!layoutProcessor) {
      layoutProcessor = new WebWorkerLayoutProcessor(getLayoutProcessorConfig());
      return;
    }

    layoutProcessor.updateConfig(getLayoutProcessorConfig());
  };

  // ── Cache helpers ──

  const computeLayoutCacheKey = (
    cacheNodes: DependencyNode[],
    edgeList: GraphEdge[]
  ): string => {
    const nodeIds = cacheNodes
      .map((n) => n.id)
      .sort()
      .join(',');
    const edgeIds = edgeList
      .map((e) => e.id)
      .sort()
      .join(',');
    const dwl = graphSettings.degreeWeightedLayers ? 1 : 0;
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

  const shouldRunTwoPassMeasure = (nodeCount: number): boolean => nodeCount <= TWO_PASS_MEASURE_NODE_THRESHOLD;

  const waitForNextPaint = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => { resolve(); });
    });
  };

  const measureAllNodeDimensions = (
    layoutedNodes: DependencyNode[]
  ): { nodes: DependencyNode[]; hasChanges: boolean } => {
    if (layoutedNodes.length === 0) {
      return { nodes: layoutedNodes, hasChanges: false };
    }

    nodeDimensionTracker.refresh();
    const fallbackElementMap = new Map<string, HTMLElement>();

    const measurements = new Map<
      string,
      {
        width: number;
        height: number;
        headerH: number;
        bodyH: number;
        subnodesH: number;
        isContainer: boolean;
      }
    >();

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

      const currentMeasured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
      const widthDelta = Math.abs((currentMeasured?.width ?? 0) - m.width);
      const heightDelta = Math.abs((currentMeasured?.height ?? 0) - m.height);
      const cached = nodeMeasurementCache.get(node.id);
      const cacheDeltaWidth = Math.abs((cached?.width ?? 0) - m.width);
      const cacheDeltaHeight = Math.abs((cached?.height ?? 0) - m.height);

      let insetChanged = false;
      let measuredTopInset = 0;

      if (m.isContainer) {
        measuredTopInset = Math.max(96, Math.round(m.headerH + m.bodyH + m.subnodesH + 12));
        const currentTopInset = (node.data?.layoutInsets as { top?: number } | undefined)?.top ?? 0;
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
      edges: optimizeHighwayHandleRouting(nodesWithHandles, resultEdges),
    };
  };

  // ── Main layout pipeline ──

  const processGraphLayout = async (
    graphData: { nodes: DependencyNode[]; edges: GraphEdge[] },
    layoutOptions: LayoutProcessOptions = {}
  ): Promise<{ nodes: DependencyNode[]; edges: GraphEdge[] } | null> => {
    if (!layoutProcessor) {
      return null;
    }

    const requestVersion = ++layoutRequestVersion;
    const fitViewToResult = layoutOptions.fitViewToResult ?? true;
    const fitPadding = layoutOptions.fitPadding ?? 0.1;
    const twoPassMeasure = layoutOptions.twoPassMeasure ?? shouldRunTwoPassMeasure(graphData.nodes.length);

    isLayoutPending.value = true;
    if (twoPassMeasure) {
      isLayoutMeasuring.value = true;
    }

    suspendEdgeVirtualization();
    graphStore.suspendCacheWrites();

    try {
      performance.mark('layout-start');

      // Check layout cache
      const cacheKey = computeLayoutCacheKey(graphData.nodes, graphData.edges);
      const cachedEntry = layoutCache.get(cacheKey);
      if (cachedEntry) {
        layoutCache.delete(cacheKey);
        layoutCache.set(cacheKey, cachedEntry);

        const previousNodes = graphStore.nodes;
        const cachedNodes = graphStore.manualOffsets.size > 0
          ? graphStore.applyManualOffsets(cachedEntry.nodes)
          : cachedEntry.nodes;
        graphStore.setNodes(cachedNodes);
        graphStore.setEdges(cachedEntry.edges);
        pruneNodeMeasurementCache(cachedNodes);
        await nextTick();
        const changedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, cachedNodes);
        if (changedNodeIds.length > 0) {
          updateNodeInternals(changedNodeIds);
        }

        if (fitViewToResult) {
          await fitView({
            duration: 180,
            padding: fitPadding,
            ...(layoutOptions.fitNodes?.length ? { nodes: layoutOptions.fitNodes } : {}),
          });
        }
        syncViewportState();
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
        if (layoutOptions.fitNodes && layoutOptions.fitNodes.length > 0) {
          await fitView({
            duration: 180,
            padding: fitPadding,
            nodes: layoutOptions.fitNodes,
          });
        } else {
          await fitView({
            duration: 180,
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

      performance.mark('layout-end');
      measurePerformance('graph-layout', 'layout-start', 'layout-end');

      return normalized;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error during layout processing');
      console.error('Layout processing failed:', error);
      return null;
    } finally {
      isLayoutMeasuring.value = false;
      graphStore.resumeCacheWrites();
      resumeEdgeVirtualization();
      if (requestVersion === layoutRequestVersion) {
        isLayoutPending.value = false;
      }
    }
  };

  // ── Graph initialization ──

  const initializeGraph = async () => {
    performance.mark('graph-init-start');
    resetSearchHighlightState();
    interaction.resetInteraction();
    graphStore.setViewMode('overview');
    initializeLayoutProcessor();

    const overviewGraph = buildOverviewGraph({
      data: propsData.value,
      enabledNodeTypes: getEnabledNodeTypes(graphSettings.enabledNodeTypes),
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

  // ── Config management ──

  const setLayoutConfig = (partial: Partial<LayoutConfig>): void => {
    if (partial.algorithm) {
      layoutConfig.algorithm = partial.algorithm;
    }
    if (partial.direction) {
      layoutConfig.direction = partial.direction;
    }
    if (partial.nodeSpacing !== undefined) {
      layoutConfig.nodeSpacing = partial.nodeSpacing;
    }
    if (partial.rankSpacing !== undefined) {
      layoutConfig.rankSpacing = partial.rankSpacing;
    }
    if (partial.edgeSpacing !== undefined) {
      layoutConfig.edgeSpacing = partial.edgeSpacing;
    }
  };

  const resetLayoutConfig = (): void => {
    layoutConfig.algorithm = defaultLayoutConfig.algorithm;
    layoutConfig.direction = defaultLayoutConfig.direction;
    layoutConfig.nodeSpacing = defaultLayoutConfig.nodeSpacing;
    layoutConfig.rankSpacing = defaultLayoutConfig.rankSpacing;
    layoutConfig.edgeSpacing = defaultLayoutConfig.edgeSpacing;
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
    setLayoutConfig,
    resetLayoutConfig,
    dispose,
  };
}
