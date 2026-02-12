<script setup lang="ts">
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MarkerType, Panel, Position, VueFlow, applyNodeChanges, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';

import { createLogger } from '../../../shared/utils/logger';
import { WebWorkerLayoutProcessor } from '../../layout/WebWorkerLayoutProcessor';
import { useGraphSettings } from '../../stores/graphSettings';
import { useGraphStore } from '../../stores/graphStore';
import { getEdgeStyle, getNodeStyle, graphTheme } from '../../theme/graphTheme';
import { measurePerformance } from '../../utils/performanceMonitoring';
import {
  applyEdgeVisibility,
  buildOverviewGraph,
  buildSymbolDrilldownGraph,
  filterNodeChangesForFolderMode,
  toDependencyEdgeKind,
} from './buildGraphView';
import GraphControls from './components/GraphControls.vue';
import GraphMiniMap from './components/GraphMiniMap.vue';
import GraphSearch from './components/GraphSearch.vue';
import NodeDetails from './components/NodeDetails.vue';
import { nodeTypes } from './nodes/nodes';
import { NODE_ACTIONS_KEY } from './nodes/utils';
import { useGraphInteractionController } from './useGraphInteractionController';
import { classifyWheelIntent, isMacPlatform } from './utils/wheelIntent';

import type { NodeChange } from '@vue-flow/core';

import type { DependencyKind, DependencyNode, DependencyPackageGraph, GraphEdge, SearchResult } from './types';

import '@vue-flow/controls/dist/style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

const graphLogger = createLogger('DependencyGraph');

export interface DependencyGraphProps {
  data: DependencyPackageGraph;
}

interface LayoutProcessOptions {
  fitViewToResult?: boolean;
  fitPadding?: number;
  fitNodes?: string[];
  twoPassMeasure?: boolean;
}

const props = defineProps<DependencyGraphProps>();

const graphStore = useGraphStore();
const graphSettings = useGraphSettings();
const interaction = useGraphInteractionController();

const nodes = computed(() => graphStore['nodes']);
const edges = computed(() => graphStore['edges']);
const selectedNode = computed(() => graphStore['selectedNode']);
const scopeMode = computed(() => interaction.scopeMode.value);
const isLayoutPending = ref(false);

const { fitView, updateNodeInternals, panBy, zoomTo, getViewport, setViewport } = useVueFlow();

const isMac = computed(() => isMacPlatform());
const graphRootRef = ref<HTMLElement | null>(null);

let layoutProcessor: WebWorkerLayoutProcessor | null = null;
let layoutRequestVersion = 0;
let graphInitPromise: Promise<void> | null = null;
let graphInitQueued = false;
const nodeMeasurementCache = new Map<string, { width: number; height: number; topInset: number }>();

interface SearchHighlightState {
  hasResults: boolean;
  hasPath: boolean;
  matchingNodeIds: Set<string>;
  pathNodeIds: Set<string>;
  matchingEdgeIds: Set<string>;
}

const searchHighlightState: SearchHighlightState = {
  hasResults: false,
  hasPath: false,
  matchingNodeIds: new Set<string>(),
  pathNodeIds: new Set<string>(),
  matchingEdgeIds: new Set<string>(),
};

// Layout result cache keyed by hash of node IDs + edge IDs + config.
// Prevents expensive ELK re-layout when only toggling visual settings.
const layoutCache = new Map<string, { nodes: DependencyNode[]; edges: GraphEdge[] }>();
const MAX_LAYOUT_CACHE_ENTRIES = 8;

const addSetDiff = (target: Set<string>, previous: Set<string>, next: Set<string>): void => {
  previous.forEach((id) => {
    if (!next.has(id)) {
      target.add(id);
    }
  });
  next.forEach((id) => {
    if (!previous.has(id)) {
      target.add(id);
    }
  });
};

const resetSearchHighlightState = (): void => {
  searchHighlightState.hasResults = false;
  searchHighlightState.hasPath = false;
  searchHighlightState.matchingNodeIds = new Set<string>();
  searchHighlightState.pathNodeIds = new Set<string>();
  searchHighlightState.matchingEdgeIds = new Set<string>();
};

function computeLayoutCacheKey(
  nodes: DependencyNode[],
  edgeList: GraphEdge[],
  config: typeof layoutConfig
): string {
  // Build a fast hash from node/edge IDs + layout direction/algorithm
  const nodeIds = nodes.map((n) => n.id).sort().join(',');
  const edgeIds = edgeList.map((e) => e.id).sort().join(',');
  return `${config.algorithm}:${config.direction}:${config.nodeSpacing}:${config.rankSpacing}:${config.edgeSpacing}:${nodeIds.length}:${edgeIds.length}:${simpleHash(nodeIds)}:${simpleHash(edgeIds)}`;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

// Cached DOM references for handleWheel (Issue #19: avoid querySelector/getBoundingClientRect per event)
let cachedFlowContainer: HTMLElement | null = null;
let cachedContainerRect: DOMRect | null = null;
let resizeObserver: ResizeObserver | null = null;

const DEFAULT_NODE_TYPE_SET = new Set(['module']);
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.5 };

const useBuiltinMinimap = import.meta.env['VITE_USE_BUILTIN_MINIMAP'] === 'true';

const minimapNodeColor = (node: { type?: string }): string => {
  if (node.type === 'package') return 'rgba(20, 184, 166, 0.55)';
  if (node.type === 'module') return 'rgba(59, 130, 246, 0.5)';
  if (node.type === 'class' || node.type === 'interface') return 'rgba(217, 119, 6, 0.45)';
  return 'rgba(148, 163, 184, 0.4)';
};

const minimapNodeStrokeColor = (node: { id?: string }): string => {
  return node.id === selectedNode.value?.id ? '#22d3ee' : 'rgba(226, 232, 240, 0.5)';
};

const handleMinimapNodeClick = (params: { node: { id: string } }): void => {
  void handleFocusNode(params.node.id);
};

const defaultLayoutConfig = {
  algorithm: 'layered' as 'layered' | 'radial' | 'force' | 'stress',
  direction: 'LR' as 'LR' | 'RL' | 'TB' | 'BT',
  nodeSpacing: 80,
  rankSpacing: 200,
  edgeSpacing: 30,
};
const layoutConfig = { ...defaultLayoutConfig };

const getLayoutProcessorConfig = () => ({
  algorithm: layoutConfig.algorithm,
  direction: layoutConfig.direction,
  nodeSpacing: layoutConfig.nodeSpacing,
  rankSpacing: layoutConfig.rankSpacing,
  edgeSpacing: layoutConfig.edgeSpacing,
  theme: graphTheme,
  animationDuration: 150,
});

const getHandlePositions = (
  direction: 'LR' | 'RL' | 'TB' | 'BT'
): { sourcePosition: Position; targetPosition: Position } => {
  switch (direction) {
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    case 'TB':
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
  }
};

const getEnabledNodeTypes = (): Set<string> => {
  const configuredTypes = graphSettings.enabledNodeTypes.length
    ? graphSettings.enabledNodeTypes
    : Array.from(DEFAULT_NODE_TYPE_SET);

  const typeSet = new Set(configuredTypes);
  if (typeSet.size === 0) {
    typeSet.add('module');
  }
  return typeSet;
};

const mergeNodeInteractionStyle = (
  node: DependencyNode,
  interactionStyle: Record<string, string | number | undefined>
): Record<string, string | number | undefined> => {
  const currentStyle =
    typeof node.style === 'object' ? (node.style as Record<string, string | number | undefined>) : {};

  // If no interaction changes vs current style, return existing style unchanged (same reference = no reactivity trigger)
  if (Object.keys(interactionStyle).every((key) => currentStyle[key] === interactionStyle[key])) {
    return currentStyle;
  }

  const baseStyle = getNodeStyle(node.type as DependencyKind);

  const preservedSizing = {
    width: currentStyle['width'],
    height: currentStyle['height'],
    minWidth: currentStyle['minWidth'],
    minHeight: currentStyle['minHeight'],
    maxWidth: currentStyle['maxWidth'],
    maxHeight: currentStyle['maxHeight'],
    overflow: currentStyle['overflow'],
    zIndex: currentStyle['zIndex'],
  };

  return {
    ...baseStyle,
    ...preservedSizing,
    ...interactionStyle,
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

const applySelectionHighlight = (selected: DependencyNode | null): void => {
  // Isolation mode manages its own styles
  if (interaction.scopeMode.value === 'isolate') return;

  const connectedNodeIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();

  if (selected) {
    connectedNodeIds.add(selected.id);
    for (const edge of edges.value) {
      if (!edge.hidden && (edge.source === selected.id || edge.target === selected.id)) {
        connectedEdgeIds.add(edge.id);
        connectedNodeIds.add(edge.source);
        connectedNodeIds.add(edge.target);
      }
    }
  }

  const hasSelection = selected !== null;

  const updatedNodes = nodes.value.map((node) => {
    let nodeClass: string | undefined;

    if (hasSelection) {
      if (node.id === selected.id) nodeClass = 'selection-target';
      else if (connectedNodeIds.has(node.id)) nodeClass = 'selection-connected';
      else nodeClass = 'selection-dimmed';
    }

    if (node.class === nodeClass) return node;
    return { ...node, class: nodeClass };
  });

  const updatedEdges = edges.value.map((edge) => {
    let edgeClass: string | undefined;
    if (hasSelection) {
      edgeClass = connectedEdgeIds.has(edge.id) ? 'edge-selection-highlighted' : 'edge-selection-dimmed';
    }
    if (edge.class === edgeClass) return edge;
    return { ...edge, class: edgeClass };
  });

  graphStore['setNodes'](updatedNodes);
  graphStore['setEdges'](updatedEdges);
};

const setSelectedNode = (node: DependencyNode | null) => {
  graphStore['setSelectedNode'](node);
  interaction.setSelectionNodeId(node?.id ?? null);
  if (!node) {
    interaction.setCameraMode('free');
  }
  applySelectionHighlight(node);
};

const measureLayoutInsets = (layoutedNodes: DependencyNode[]): { nodes: DependencyNode[]; hasChanges: boolean } => {
  const measurableNodes = layoutedNodes.filter(
    (node) => node.type === 'module' || node.type === 'package' || node.type === 'group' || node.data?.isContainer === true
  );
  if (measurableNodes.length === 0) {
    return { nodes: layoutedNodes, hasChanges: false };
  }

  // Batch only container-node measurements (much smaller set than all graph nodes).
  const measurements = new Map<string, { width: number; height: number; headerH: number; bodyH: number; subnodesH: number }>();
  measurableNodes.forEach((node) => {
    const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(node.id) : node.id;
    const element = document.querySelector<HTMLElement>(`.vue-flow__node[data-id="${escapedId}"]`);
    if (!element) {
      return;
    }

    measurements.set(node.id, {
      width: element.offsetWidth,
      height: element.offsetHeight,
      headerH: element.querySelector<HTMLElement>('.base-node-header')?.offsetHeight ?? 0,
      bodyH: element.querySelector<HTMLElement>('.base-node-body')?.offsetHeight ?? 0,
      subnodesH: element.querySelector<HTMLElement>('.base-node-subnodes')?.offsetHeight ?? 0,
    });
  });

  let hasChanges = false;
  const measuredNodes = layoutedNodes.map((node) => {
    const shouldMeasure = node.type === 'module' || node.type === 'package' || node.type === 'group' || node.data?.isContainer === true;
    if (!shouldMeasure) {
      return node;
    }

    const m = measurements.get(node.id);
    if (!m) {
      return node;
    }

    // Reserve full visible top content so nested children never overlap card sections.
    const measuredTopInset = Math.max(96, Math.round(m.headerH + m.bodyH + m.subnodesH + 12));

    const currentTopInset = (node.data?.layoutInsets as { top?: number } | undefined)?.top ?? 0;
    const currentMeasured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
    const widthDelta = Math.abs((currentMeasured?.width ?? 0) - m.width);
    const heightDelta = Math.abs((currentMeasured?.height ?? 0) - m.height);
    const insetDelta = Math.abs(currentTopInset - measuredTopInset);
    const cached = nodeMeasurementCache.get(node.id);
    const cacheDeltaWidth = Math.abs((cached?.width ?? 0) - m.width);
    const cacheDeltaHeight = Math.abs((cached?.height ?? 0) - m.height);
    const cacheDeltaInset = Math.abs((cached?.topInset ?? 0) - measuredTopInset);
    const changed = widthDelta > 1 || heightDelta > 1 || insetDelta > 1 || cacheDeltaWidth > 1 || cacheDeltaHeight > 1 || cacheDeltaInset > 1;

    if (!changed) {
      return node;
    }

    hasChanges = true;
    nodeMeasurementCache.set(node.id, { width: m.width, height: m.height, topInset: measuredTopInset });
    return {
      ...node,
      data: {
        ...node.data,
        layoutInsets: {
          top: measuredTopInset,
        },
      },
      measured: {
        width: m.width,
        height: m.height,
      },
    } as DependencyNode;
  });

  return {
    nodes: measuredNodes,
    hasChanges,
  };
};

const toDimensionValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const collectNodesNeedingInternalsUpdate = (previous: DependencyNode[], next: DependencyNode[]): string[] => {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  const changedIds: string[] = [];

  next.forEach((node) => {
    const prev = previousById.get(node.id);
    if (!prev) {
      changedIds.push(node.id);
      return;
    }

    if (prev.sourcePosition !== node.sourcePosition || prev.targetPosition !== node.targetPosition || prev.parentNode !== node.parentNode) {
      changedIds.push(node.id);
      return;
    }

    const prevMeasured = (prev as { measured?: { width?: number; height?: number } }).measured;
    const nextMeasured = (node as { measured?: { width?: number; height?: number } }).measured;
    const prevStyle = typeof prev.style === 'object' ? (prev.style as Record<string, unknown>) : {};
    const nextStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};

    const prevWidth = prevMeasured?.width ?? toDimensionValue(prevStyle['width']) ?? prev.width ?? 0;
    const prevHeight = prevMeasured?.height ?? toDimensionValue(prevStyle['height']) ?? prev.height ?? 0;
    const nextWidth = nextMeasured?.width ?? toDimensionValue(nextStyle['width']) ?? node.width ?? 0;
    const nextHeight = nextMeasured?.height ?? toDimensionValue(nextStyle['height']) ?? node.height ?? 0;

    if (Math.abs(prevWidth - nextWidth) > 1 || Math.abs(prevHeight - nextHeight) > 1) {
      changedIds.push(node.id);
    }
  });

  return changedIds;
};

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
    edges: resultEdges,
  };
};

const processGraphLayout = async (
  graphData: { nodes: DependencyNode[]; edges: GraphEdge[] },
  options: LayoutProcessOptions = {}
) => {
  if (!layoutProcessor) {
    return null;
  }

  const requestVersion = ++layoutRequestVersion;
  const fitViewToResult = options.fitViewToResult ?? true;
  const fitPadding = options.fitPadding ?? 0.1;
  const twoPassMeasure = options.twoPassMeasure ?? true;

  isLayoutPending.value = true;

  // Suspend cache writes during layout passes to prevent expensive JSON.stringify
  // on intermediate state (first-pass nodes that will be replaced by second-pass)
  graphStore.suspendCacheWrites();

  try {
    performance.mark('layout-start');

    // Check layout cache to avoid expensive ELK re-computation
    const cacheKey = computeLayoutCacheKey(graphData.nodes, graphData.edges as GraphEdge[], layoutConfig);
    const cached = layoutCache.get(cacheKey);
    if (cached) {
      const previousNodes = graphStore['nodes'];
      graphStore['setNodes'](cached.nodes);
      graphStore['setEdges'](cached.edges);
      await nextTick();
      const changedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, cached.nodes);
      if (changedNodeIds.length > 0) {
        updateNodeInternals(changedNodeIds);
      }

      if (fitViewToResult) {
        await fitView({
          duration: 180,
          padding: fitPadding,
          ...(options.fitNodes?.length ? { nodes: options.fitNodes } : {}),
        });
      }

      performance.mark('layout-end');
      measurePerformance('graph-layout', 'layout-start', 'layout-end');
      return cached;
    }

    const firstPassResult = await layoutProcessor.processLayout(graphData);
    if (requestVersion !== layoutRequestVersion) {
      return null;
    }

    let normalized = normalizeLayoutResult(
      firstPassResult.nodes as unknown as DependencyNode[],
      firstPassResult.edges as unknown as GraphEdge[]
    );

    // First pass commit - needed to render DOM for measurement
    const previousNodes = graphStore['nodes'];
    graphStore['setNodes'](normalized.nodes);
    graphStore['setEdges'](normalized.edges);

    await nextTick();
    const firstPassChangedNodeIds = collectNodesNeedingInternalsUpdate(previousNodes, normalized.nodes);
    if (firstPassChangedNodeIds.length > 0) {
      updateNodeInternals(firstPassChangedNodeIds);
    }

    if (twoPassMeasure) {
      const measured = measureLayoutInsets(normalized.nodes);
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

        // Single final commit replaces the first-pass data
        graphStore['setNodes'](normalized.nodes);
        graphStore['setEdges'](normalized.edges);
        await nextTick();
        const secondPassChangedNodeIds = collectNodesNeedingInternalsUpdate(firstPassNodes, normalized.nodes);
        if (secondPassChangedNodeIds.length > 0) {
          updateNodeInternals(secondPassChangedNodeIds);
        }
      }
    }

    if (fitViewToResult) {
      if (options.fitNodes && options.fitNodes.length > 0) {
        await fitView({
          duration: 180,
          padding: fitPadding,
          nodes: options.fitNodes,
        });
      } else {
        await fitView({
          duration: 180,
          padding: fitPadding,
        });
      }
    }

    // Cache the result for future identical graph+config combinations
    if (layoutCache.size >= MAX_LAYOUT_CACHE_ENTRIES) {
      // Evict oldest entry (first inserted)
      const firstKey = layoutCache.keys().next().value;
      if (firstKey !== undefined) layoutCache.delete(firstKey);
    }
    layoutCache.set(cacheKey, { nodes: normalized.nodes, edges: normalized.edges });

    performance.mark('layout-end');
    measurePerformance('graph-layout', 'layout-start', 'layout-end');

    return normalized;
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error during layout processing');
    graphLogger.error('Layout processing failed:', error);
    return null;
  } finally {
    // Resume cache writes so the final state gets persisted
    graphStore.resumeCacheWrites();
    if (requestVersion === layoutRequestVersion) {
      isLayoutPending.value = false;
    }
  }
};

const initializeGraph = async () => {
  performance.mark('graph-init-start');
  resetSearchHighlightState();
  interaction.resetInteraction();
  graphStore.setViewMode('overview');
  initializeLayoutProcessor();

  const overviewGraph = buildOverviewGraph({
    data: props.data,
    enabledNodeTypes: getEnabledNodeTypes(),
    enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
    direction: layoutConfig.direction,
    clusterByFolder: graphSettings.clusterByFolder,
    collapseScc: graphSettings.collapseScc,
    hideTestFiles: graphSettings.hideTestFiles,
    memberNodeMode: graphSettings.memberNodeMode,
    highlightOrphanGlobal: graphSettings.highlightOrphanGlobal,
  });

  const layoutResult = await processGraphLayout(overviewGraph, {
    fitViewToResult: true,
    fitPadding: 0.1,
    twoPassMeasure: true,
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

watch(
  () => props.data,
  () => {
    void requestGraphInitialization();
  },
  { immediate: true }
);

const onNodeClick = ({ node }: { node: unknown }): void => {
  const clickedNode = node as DependencyNode;
  setSelectedNode(clickedNode);
};

const handleFocusNode = async (nodeId: string): Promise<void> => {
  const targetNode = nodes.value.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }

  setSelectedNode(targetNode);
  interaction.setCameraMode('fitSelection');

  await fitView({
    nodes: [nodeId],
    duration: 180,
    padding: 0.4,
  });
};

const isolateNeighborhood = async (nodeId: string): Promise<void> => {
  const snapshot = graphStore.overviewSnapshot;
  const sourceNodes = snapshot?.nodes ?? nodes.value;
  const sourceEdges = snapshot?.edges ?? edges.value;
  const targetNode = sourceNodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }

  const connectedNodeIds = new Set<string>([nodeId]);
  sourceEdges.forEach((edge) => {
    if (edge.source === nodeId) {
      connectedNodeIds.add(edge.target);
    } else if (edge.target === nodeId) {
      connectedNodeIds.add(edge.source);
    }
  });

  const isolatedNodes = sourceNodes
    .filter((node) => connectedNodeIds.has(node.id))
    .map((node) => ({
      ...node,
      class: undefined,
      style: mergeNodeInteractionStyle(node, {
        opacity: node.id === nodeId ? 1 : 0.9,
        borderColor: node.id === nodeId ? '#22d3ee' : undefined,
        borderWidth: node.id === nodeId ? '2px' : undefined,
      }),
    }));

  const isolatedEdges = applyEdgeVisibility(
    sourceEdges
      .filter((edge) => connectedNodeIds.has(edge.source) && connectedNodeIds.has(edge.target))
      .map((edge) => ({
        ...edge,
        style: {
          ...getEdgeStyle(toDependencyEdgeKind(edge.data?.type)),
          opacity: 0.9,
          strokeWidth: edge.source === nodeId || edge.target === nodeId ? 3 : 2,
        },
        zIndex: edge.source === nodeId || edge.target === nodeId ? 5 : 1,
      })),
    graphSettings.activeRelationshipTypes
  );

  graphStore['setNodes'](isolatedNodes);
  graphStore['setEdges'](isolatedEdges);
  graphStore.setViewMode('isolate');
  interaction.setScopeMode('isolate');
  setSelectedNode(targetNode);

  await fitView({
    duration: 200,
    padding: 0.35,
    nodes: Array.from(connectedNodeIds),
  });
};

// Provide node actions to child nodes via injection (replaces global CustomEvent)
provide(NODE_ACTIONS_KEY, {
  focusNode: (nodeId: string) => void handleFocusNode(nodeId),
  isolateNeighborhood: (nodeId: string) => void isolateNeighborhood(nodeId),
});

const handleOpenSymbolUsageGraph = async (nodeId: string): Promise<void> => {
  const targetNode = nodes.value.find((node) => node.id === nodeId) ?? selectedNode.value;
  if (!targetNode) {
    return;
  }

  setSelectedNode(targetNode);
  graphStore.setViewMode('symbolDrilldown');
  interaction.setScopeMode('symbolDrilldown');

  const symbolGraph = buildSymbolDrilldownGraph({
    data: props.data,
    selectedNode: targetNode,
    direction: layoutConfig.direction,
    enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
  });

  await processGraphLayout(symbolGraph, {
    fitViewToResult: true,
    fitPadding: 0.2,
    twoPassMeasure: true,
  });
};

const onPaneClick = (): void => {
  setSelectedNode(null);
};

const handleWheel = (event: WheelEvent): void => {
  if (!isMac.value) return;

  const intent = classifyWheelIntent(event);
  const target = event.target as HTMLElement;

  // Pinch-to-zoom: prevent browser page zoom everywhere, handle graph zoom ourselves
  if (intent === 'pinch') {
    event.preventDefault();
    const vp = getViewport();
    const factor = event.deltaY > 0 ? 0.95 : 1.05;
    const newZoom = Math.max(0.1, Math.min(2, vp.zoom * factor));
    if (cachedFlowContainer && cachedContainerRect) {
      const cursorX = event.clientX - cachedContainerRect.left;
      const cursorY = event.clientY - cachedContainerRect.top;
      const scale = newZoom / vp.zoom;
      void setViewport(
        { x: cursorX - (cursorX - vp.x) * scale, y: cursorY - (cursorY - vp.y) * scale, zoom: newZoom },
        { duration: 0 }
      );
    } else {
      void zoomTo(newZoom, { duration: 50 });
    }
    return;
  }

  // Allow normal scrolling inside scrollable overlay panels (e.g. NodeDetails)
  if (target.closest('[data-graph-overlay-scrollable]')) return;

  event.preventDefault();

  if (intent === 'trackpadScroll') {
    panBy({ x: -event.deltaX, y: -event.deltaY });
  } else {
    const currentZoom = getViewport().zoom;
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    void zoomTo(Math.max(0.1, Math.min(2, currentZoom * factor)), { duration: 50 });
  }
};

const handleReturnToOverview = async (): Promise<void> => {
  interaction.setScopeMode('overview');
  graphStore.setViewMode('overview');
  setSelectedNode(null);

  if (graphStore.restoreOverviewSnapshot()) {
    await fitView({ duration: 180, padding: 0.1 });
    return;
  }

  await requestGraphInitialization();
};

const handleResetLayout = async (): Promise<void> => {
  layoutConfig.algorithm = defaultLayoutConfig.algorithm;
  layoutConfig.direction = defaultLayoutConfig.direction;
  layoutConfig.nodeSpacing = defaultLayoutConfig.nodeSpacing;
  layoutConfig.rankSpacing = defaultLayoutConfig.rankSpacing;
  layoutConfig.edgeSpacing = defaultLayoutConfig.edgeSpacing;

  await requestGraphInitialization();
};

const handleResetView = async (): Promise<void> => {
  interaction.setCameraMode('free');
  setSelectedNode(null);
};

const handleRelationshipFilterChange = async (types: string[]) => {
  graphSettings.setEnabledRelationshipTypes(types);
  await requestGraphInitialization();
};

const handleNodeTypeFilterChange = async (types: string[]) => {
  graphSettings.setEnabledNodeTypes(types);
  setSelectedNode(null);
  await requestGraphInitialization();
};

const handleCollapseSccToggle = async (value: boolean) => {
  if (graphSettings.clusterByFolder && value) {
    graphSettings.setCollapseScc(false);
    return;
  }
  graphSettings.setCollapseScc(value);
  await requestGraphInitialization();
};

const handleClusterByFolderToggle = async (value: boolean) => {
  if (value && graphSettings.collapseScc) {
    graphSettings.setCollapseScc(false);
  }
  graphSettings.setClusterByFolder(value);
  await requestGraphInitialization();
};

const handleHideTestFilesToggle = async (value: boolean) => {
  graphSettings.setHideTestFiles(value);
  await requestGraphInitialization();
};

const handleMemberNodeModeChange = async (value: 'compact' | 'graph') => {
  graphSettings.setMemberNodeMode(value);
  await requestGraphInitialization();
};

const handleOrphanGlobalToggle = async (value: boolean) => {
  graphSettings.setHighlightOrphanGlobal(value);
  await requestGraphInitialization();
};

const handleNodesChange = (changes: NodeChange[]) => {
  if (!changes.length) return;

  const filteredChanges = filterNodeChangesForFolderMode(changes, nodes.value, graphSettings.clusterByFolder);
  if (!filteredChanges.length) return;

  const updatedNodes = applyNodeChanges(
    filteredChanges,
    nodes.value as unknown as never[]
  ) as unknown as DependencyNode[];
  graphStore['setNodes'](updatedNodes);
};

const handleLayoutChange = async (config: {
  algorithm?: string;
  direction?: string;
  nodeSpacing?: number;
  rankSpacing?: number;
}) => {
  if (config.algorithm) {
    layoutConfig.algorithm = config.algorithm as 'layered' | 'radial' | 'force' | 'stress';
  }
  if (config.direction) {
    layoutConfig.direction = config.direction as 'LR' | 'RL' | 'TB' | 'BT';
  }
  if (config.nodeSpacing !== undefined) {
    layoutConfig.nodeSpacing = config.nodeSpacing;
  }
  if (config.rankSpacing !== undefined) {
    layoutConfig.rankSpacing = config.rankSpacing;
  }

  await requestGraphInitialization();
};

const handleSearchResult = (result: SearchResult) => {
  const matchingNodeIds = new Set(result.nodes.map((n) => n.id));
  const pathNodeIds = new Set(result.path?.map((n) => n.id) ?? []);
  const matchingEdgeIds = new Set(result.edges.map((e) => e.id));
  const hasResults = matchingNodeIds.size > 0;
  const hasPath = pathNodeIds.size > 0;

  const shouldRefreshAllNodes =
    hasResults !== searchHighlightState.hasResults || (hasResults && searchHighlightState.hasResults && hasPath !== searchHighlightState.hasPath);
  const shouldRefreshAllEdges = hasResults !== searchHighlightState.hasResults;

  const nodeIdsToUpdate = new Set<string>();
  if (shouldRefreshAllNodes) {
    nodes.value.forEach((node) => nodeIdsToUpdate.add(node.id));
  } else {
    addSetDiff(nodeIdsToUpdate, searchHighlightState.matchingNodeIds, matchingNodeIds);
    addSetDiff(nodeIdsToUpdate, searchHighlightState.pathNodeIds, pathNodeIds);
  }

  const edgeIdsToUpdate = new Set<string>();
  if (shouldRefreshAllEdges) {
    edges.value.forEach((edge) => edgeIdsToUpdate.add(edge.id));
  } else {
    addSetDiff(edgeIdsToUpdate, searchHighlightState.matchingEdgeIds, matchingEdgeIds);
  }

  let nodesChanged = false;
  let searchedNodes = nodes.value;
  const nodeIndexById = new Map(nodes.value.map((node, index) => [node.id, index]));

  nodeIdsToUpdate.forEach((nodeId) => {
    const nodeIndex = nodeIndexById.get(nodeId);
    if (nodeIndex === undefined) {
      return;
    }

    const node = searchedNodes[nodeIndex];
    if (!node) {
      return;
    }

    const isMatch = matchingNodeIds.has(node.id);
    const isOnPath = hasPath && pathNodeIds.has(node.id);
    const opacity = !hasResults ? 1 : hasPath ? (isOnPath ? 1 : 0.2) : isMatch ? 1 : 0.2;
    const borderWidth =
      hasPath && isOnPath ? graphTheme.edges.sizes.width.selected : hasPath ? graphTheme.edges.sizes.width.default : undefined;
    const currentStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
    const currentOpacity = toDimensionValue(currentStyle['opacity']) ?? 1;
    const currentBorderWidth = currentStyle['borderWidth'];

    const selectionChanged = Boolean(node.selected) !== isMatch;
    const opacityChanged = Math.abs(currentOpacity - opacity) > 0.001;
    const borderWidthChanged = String(currentBorderWidth ?? '') !== String(borderWidth ?? '');
    const classChanged = node.class !== undefined;

    if (!selectionChanged && !opacityChanged && !borderWidthChanged && !classChanged) {
      return;
    }

    if (!nodesChanged) {
      searchedNodes = [...searchedNodes];
      nodesChanged = true;
    }

    searchedNodes[nodeIndex] = {
      ...node,
      class: undefined,
      selected: isMatch,
      style: mergeNodeInteractionStyle(node, {
        opacity,
        borderWidth,
      }),
    };
  });

  if (nodesChanged) {
    graphStore['setNodes'](searchedNodes);
  }

  let edgesChanged = false;
  let searchedEdges = edges.value;
  const edgeIndexById = new Map(edges.value.map((edge, index) => [edge.id, index]));

  edgeIdsToUpdate.forEach((edgeId) => {
    const edgeIndex = edgeIndexById.get(edgeId);
    if (edgeIndex === undefined) {
      return;
    }

    const edge = searchedEdges[edgeIndex];
    if (!edge) {
      return;
    }

    const isMatch = matchingEdgeIds.has(edge.id);
    const opacity = !hasResults ? 1 : isMatch ? 1 : 0.2;
    const currentStyle = typeof edge.style === 'object' ? (edge.style as Record<string, unknown>) : {};
    const currentOpacity = toDimensionValue(currentStyle['opacity']) ?? 1;
    const selectionChanged = Boolean(edge.selected) !== isMatch;
    const opacityChanged = Math.abs(currentOpacity - opacity) > 0.001;
    const classChanged = edge.class !== undefined;

    if (!selectionChanged && !opacityChanged && !classChanged) {
      return;
    }

    if (!edgesChanged) {
      searchedEdges = [...searchedEdges];
      edgesChanged = true;
    }

    searchedEdges[edgeIndex] = {
      ...edge,
      class: undefined,
      selected: isMatch,
      style: {
        ...getEdgeStyle(toDependencyEdgeKind(edge.data?.type)),
        opacity,
      },
    };
  });

  if (edgesChanged) {
    graphStore['setEdges'](applyEdgeVisibility(searchedEdges, graphSettings.activeRelationshipTypes));
  }

  searchHighlightState.hasResults = hasResults;
  searchHighlightState.hasPath = hasPath;
  searchHighlightState.matchingNodeIds = new Set(matchingNodeIds);
  searchHighlightState.pathNodeIds = new Set(pathNodeIds);
  searchHighlightState.matchingEdgeIds = new Set(matchingEdgeIds);
};

const handleKeyDown = (event: KeyboardEvent) => {
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
          void fitView({
            nodes: [nextNode.id],
            duration: 150,
            padding: 0.5,
          });
        }
      }
    }
  }
};

// --- Hover z-index elevation (direct DOM for performance) ---
let hoveredNodeId: string | null = null;
const HOVER_Z = '9999';

const elevateNodeAndChildren = (nodeId: string): void => {
  const root = graphRootRef.value;
  if (!root) return;

  const el = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (el) {
    el.dataset['prevZ'] = el.style.zIndex;
    el.style.zIndex = HOVER_Z;
  }
  for (const n of nodes.value) {
    if (n.parentNode === nodeId) {
      const child = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`);
      if (child) {
        child.dataset['prevZ'] = child.style.zIndex;
        child.style.zIndex = HOVER_Z;
      }
    }
  }
};

const restoreHoverZIndex = (nodeId: string): void => {
  const root = graphRootRef.value;
  if (!root) return;

  const el = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (el?.dataset['prevZ'] !== undefined) {
    el.style.zIndex = el.dataset['prevZ'];
    delete el.dataset['prevZ'];
  }
  for (const n of nodes.value) {
    if (n.parentNode === nodeId) {
      const child = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`);
      if (child?.dataset['prevZ'] !== undefined) {
        child.style.zIndex = child.dataset['prevZ'];
        delete child.dataset['prevZ'];
      }
    }
  }
};

const onNodeMouseEnter = ({ node }: { node: unknown }): void => {
  const entered = node as DependencyNode;
  if (hoveredNodeId && hoveredNodeId !== entered.id) {
    restoreHoverZIndex(hoveredNodeId);
  }
  hoveredNodeId = entered.id;
  elevateNodeAndChildren(entered.id);
};

const onNodeMouseLeave = ({ node }: { node: unknown }): void => {
  const left = node as DependencyNode;
  if (hoveredNodeId === left.id) {
    restoreHoverZIndex(left.id);
    hoveredNodeId = null;
  }
};

onMounted(() => {
  graphRootRef.value?.addEventListener('wheel', handleWheel, { passive: false });

  // Cache the .vue-flow container element and its rect to avoid DOM queries in handleWheel
  const flowContainer = graphRootRef.value?.querySelector('.vue-flow') as HTMLElement | null;
  if (flowContainer) {
    cachedFlowContainer = flowContainer;
    cachedContainerRect = flowContainer.getBoundingClientRect();
    resizeObserver = new ResizeObserver(() => {
      cachedContainerRect = cachedFlowContainer?.getBoundingClientRect() ?? null;
    });
    resizeObserver.observe(flowContainer);
  }
});

onUnmounted(() => {
  graphRootRef.value?.removeEventListener('wheel', handleWheel);
  resizeObserver?.disconnect();
  resizeObserver = null;
  cachedFlowContainer = null;
  cachedContainerRect = null;
  if (hoveredNodeId) {
    restoreHoverZIndex(hoveredNodeId);
    hoveredNodeId = null;
  }
  if (layoutProcessor) {
    layoutProcessor.dispose();
    layoutProcessor = null;
  }
});
</script>

<template>
  <div
    ref="graphRootRef"
    class="dependency-graph-root relative h-full w-full"
    role="application"
    aria-label="TypeScript dependency graph visualization"
    tabindex="0"
    @keydown="handleKeyDown"
  >
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes as any"
      :fit-view-on-init="false"
      :min-zoom="0.1"
      :max-zoom="2"
      :default-viewport="DEFAULT_VIEWPORT"
      :snap-to-grid="true"
      :snap-grid="[15, 15]"
      :pan-on-scroll="false"
      :zoom-on-scroll="!isMac"
      :zoom-on-pinch="!isMac"
      :prevent-scrolling="true"
      :zoom-on-double-click="false"
      :elevate-edges-on-select="true"
      :default-edge-options="{
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
        zIndex: 2,
        type: 'smoothstep',
      }"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
      @nodes-change="handleNodesChange"
      @node-mouse-enter="onNodeMouseEnter"
      @node-mouse-leave="onNodeMouseLeave"
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
      />
      <GraphSearch @search-result="handleSearchResult" :nodes="nodes" :edges="edges" />
      <MiniMap
        v-if="useBuiltinMinimap"
        position="bottom-right"
        :pannable="true"
        :zoomable="true"
        :node-color="minimapNodeColor"
        :node-stroke-color="minimapNodeStrokeColor"
        :node-stroke-width="1.5"
        :mask-color="'rgba(7, 10, 18, 0.85)'"
        :mask-stroke-color="'rgba(34, 211, 238, 0.6)'"
        :mask-stroke-width="1.5"
        aria-label="Graph minimap"
        @node-click="handleMinimapNodeClick"
      />
      <GraphMiniMap v-else :nodes="nodes" :edges="edges" :selected-node-id="selectedNode?.id ?? null" />
      <Controls position="bottom-right" :show-interactive="false" />

      <Panel v-if="isLayoutPending" position="top-center">
        <div class="layout-loading-indicator">Updating graph layout...</div>
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
    </VueFlow>
    <NodeDetails
      v-if="selectedNode"
      :node="selectedNode"
      :data="props.data"
      :nodes="nodes"
      :edges="edges"
      @open-symbol-usage="handleOpenSymbolUsageGraph"
    />
  </div>
</template>

<style scoped>
.dependency-graph-root :deep(.vue-flow__node) {
  transition:
    transform 180ms ease-out,
    opacity 180ms ease-out;
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
  box-shadow:
    0 0 0 2px rgba(34, 211, 238, 0.3),
    0 0 20px rgba(34, 211, 238, 0.25),
    0 4px 12px rgba(0, 0, 0, 0.2) !important;
}

/* Nodes connected to the selection */
.dependency-graph-root :deep(.vue-flow__node.selection-connected) {
  z-index: 10 !important;
}

.dependency-graph-root :deep(.vue-flow__node.selection-connected .base-node-container) {
  border-color: rgba(34, 211, 238, 0.5) !important;
  box-shadow:
    0 0 12px rgba(34, 211, 238, 0.15),
    0 4px 12px rgba(0, 0, 0, 0.15) !important;
}

/* Dimmed non-connected nodes */
.dependency-graph-root :deep(.vue-flow__node.selection-dimmed) {
  opacity: 0.25 !important;
  transition: opacity 180ms ease-out !important;
}

/* Connected edges — pulse glow via filter: drop-shadow using currentColor
   so each edge type (import=cyan, extends=green, implements=orange) gets
   a matching glow automatically. */
.dependency-graph-root :deep(.vue-flow__edge.edge-selection-highlighted .vue-flow__edge-path) {
  stroke-width: 2.5px !important;
  filter: drop-shadow(0 0 4px currentColor);
  animation: edge-pulse 2s ease-in-out infinite !important;
}

/* Dimmed non-connected edges */
.dependency-graph-root :deep(.vue-flow__edge.edge-selection-dimmed .vue-flow__edge-path) {
  opacity: 0.1 !important;
}

@keyframes edge-pulse {
  0%,
  100% {
    filter: drop-shadow(0 0 3px currentColor);
  }
  50% {
    filter: drop-shadow(0 0 8px currentColor);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dependency-graph-root :deep(.vue-flow__edge.edge-selection-highlighted .vue-flow__edge-path) {
    animation: none !important;
    filter: drop-shadow(0 0 4px currentColor);
  }
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
</style>
